import { describe, expect, test } from "bun:test";
import {
	adoPullId,
	collectionBatchSchema,
	collectionFinishSchema,
	collectionViewSchema,
	collectorClaimSchema,
	parseAdoRepositoryUrl,
	refreshSettingsSchema,
} from "./collection.js";
import { demoWorkspace } from "./demo.js";
import { makeWatchRef } from "./monitoring.js";
import {
	projectWriteSchema,
	pullRequestSchema,
	type RefreshQueue,
	refreshQueuePhase,
} from "./workbench.js";

describe("live collection contract", () => {
	test("observed claims keep the complete reference and optional cached snapshot in the same scope", () => {
		const data = demoWorkspace(1_789_632_000);
		const project = data.projects[0]!;
		const pull = data.pullRequests[0]!;
		const observation = {
			id: "watch-1",
			source: project.source,
			active: true,
			generation: 1,
			ref: makeWatchRef(project, pull.repository, pull.number),
			pullId: pull.id,
			addedAt: 1,
			stoppedAt: null,
			stopReason: null,
		};
		const claim = {
			project,
			observation,
			targets: [pull],
			leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
			job: {
				id: "job",
				projectId: project.id,
				revision: project.revision,
				state: "running",
				kind: "details",
				pullIds: [pull.id],
				requestedAt: 1,
				startedAt: 1,
				updatedAt: 1,
				completedAt: null,
				completedPulls: 0,
				totalPulls: 1,
				message: "Collecting watched PR",
			},
		};
		expect(collectorClaimSchema.safeParse(claim).success).toBe(true);
		expect(
			collectorClaimSchema.safeParse({
				...claim,
				targets: [],
				observation: { ...observation, pullId: null },
			}).success,
		).toBe(true);
		for (const patch of [
			{ observation: { ...observation, active: false } },
			{
				observation: {
					...observation,
					ref: { ...observation.ref, projectId: "elsewhere" },
				},
			},
			{ targets: undefined },
			{ targets: [pull, pull] },
			{ targets: [{ ...pull, id: "another" }] },
			{ targets: [{ ...pull, projectId: "another-project" }] },
			{
				targets: [
					{ ...pull, repository: { ...pull.repository, id: "another-repo" } },
				],
			},
			{ targets: [{ ...pull, number: pull.number + 1 }] },
		])
			expect(
				collectorClaimSchema.safeParse({ ...claim, ...patch }).success,
			).toBe(false);
	});
	test("validates independent cooldown settings and bounded, sequenced current-page updates", () => {
		expect(
			refreshSettingsSchema.parse({
				listCooldownSeconds: 120,
				detailCooldownSeconds: 300,
			}),
		).toEqual({ listCooldownSeconds: 120, detailCooldownSeconds: 300 });
		for (const invalid of [
			{},
			{ listCooldownSeconds: 30 },
			{ detailCooldownSeconds: -1 },
			{ interval: 120 },
		])
			expect(refreshSettingsSchema.safeParse(invalid).success).toBe(false);
		const view = {
			viewId: "52c3e5a2-2261-45a1-95a2-6f6fb9be9a0d",
			sequence: 1,
			visible: true,
			pageKey: "page",
			pullIds: ["pr-1", "pr-2"],
		};
		expect(collectionViewSchema.parse(view).refresh).toBe(false);
		for (const invalid of [
			{ ...view, sequence: -1 },
			{ ...view, pullIds: ["pr-1", "pr-1"] },
			{ ...view, pullIds: Array.from({ length: 21 }, (_, i) => `pr-${i}`) },
		])
			expect(collectionViewSchema.safeParse(invalid).success).toBe(false);
	});
	test("reports queue phases from whole-round completion, foreground leases, and explicit refresh requests", () => {
		const queue: RefreshQueue = {
			kind: "list",
			cooldownSeconds: 120,
			lastCompletedAt: 1000,
			roundId: null,
			requested: false,
			foregroundUntil: 0,
			totalJobs: 0,
			completedJobs: 0,
		};
		expect(refreshQueuePhase(queue, 1119)).toBe("cooldown");
		expect(refreshQueuePhase(queue, 1120)).toBe("due");
		expect(refreshQueuePhase({ ...queue, lastCompletedAt: null }, 1000)).toBe(
			"due",
		);
		expect(refreshQueuePhase({ ...queue, requested: true }, 1000)).toBe("due");
		expect(refreshQueuePhase({ ...queue, roundId: "long-running" }, 5000)).toBe(
			"running",
		);
		expect(
			refreshQueuePhase(
				{ ...queue, kind: "details", roundId: "paused", foregroundUntil: 1119 },
				1119,
			),
		).toBe("paused");
		expect(
			refreshQueuePhase(
				{
					...queue,
					kind: "details",
					roundId: "resumed",
					foregroundUntil: 1120,
				},
				1119,
			),
		).toBe("running");
		expect(refreshQueuePhase({ ...queue, cooldownSeconds: 0 }, 5000)).toBe(
			"off",
		);
	});
	test("rejects claims that could widen or change the selected collection scope", () => {
		const data = demoWorkspace(1_789_632_000);
		const project = data.projects[0]!;
		const [first, second] = data.pullRequests;
		const job = {
			id: "job",
			projectId: project.id,
			revision: project.revision,
			state: "running",
			requestedAt: 1,
			startedAt: 1,
			updatedAt: 1,
			completedAt: null,
			completedPulls: 0,
			totalPulls: null,
			message: "Collecting",
		};
		const claim = {
			project,
			job,
			leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
		};
		for (const [pullIds, targets] of [
			[undefined, undefined],
			[[], []],
			[
				[first!.id, second!.id],
				[second, first],
			],
		] as const) {
			expect(
				collectorClaimSchema.safeParse({
					...claim,
					job: { ...job, pullIds },
					targets,
				}).success,
			).toBe(true);
		}
		for (const [pullIds, targets] of [
			[[], undefined],
			[undefined, []],
			[[first!.id], [second]],
			[
				[first!.id, second!.id],
				[first, first],
			],
			[[first!.id], [{ ...first, projectId: "other" }]],
		] as const) {
			expect(
				collectorClaimSchema.safeParse({
					...claim,
					job: { ...job, pullIds },
					targets,
				}).success,
			).toBe(false);
		}
	});
	test("parses repository scope without accepting other hosts or executable paths", () => {
		expect(
			parseAdoRepositoryUrl(
				"https://dev.azure.com/intentional/intent/_git/whiteboard-app",
			),
		).toEqual({
			organization: "intentional",
			projectKey: "intent",
			repository: "whiteboard-app",
		});
		expect(
			parseAdoRepositoryUrl(
				"https://dev.azure.com/msdata/Vienna/_git/online-meetings/",
			),
		).toEqual({
			organization: "msdata",
			projectKey: "Vienna",
			repository: "online-meetings",
		});
		expect(
			parseAdoRepositoryUrl(
				"https://dev.azure.com/acme/Shared%20Project/_git/my%20repo",
			).projectKey,
		).toBe("Shared Project");
		for (const url of [
			"http://dev.azure.com/a/b/_git/c",
			"https://dev.azure.com.evil.test/a/b/_git/c",
			"https://user:secret@dev.azure.com/a/b/_git/c",
			"https://dev.azure.com/a/b/_git/x%2Fy",
			"https://dev.azure.com/a/b/_git/c/pullrequest/1",
			"https://dev.azure.com/a/b/_git/%00",
			"not a URL",
		]) {
			expect(() => parseAdoRepositoryUrl(url)).toThrow();
		}
	});
	test("validates named repository scopes and keeps unknown statistics unknown", () => {
		const project = demoWorkspace(1_789_632_000).projects[0]!;
		const write = {
			provider: "ado",
			name: project.name,
			organization: project.organization,
			projectKey: project.projectKey,
			description: "",
			owner: "Maintainers",
			enabled: true,
			repositories: ["whiteboard-app"],
		};
		expect(projectWriteSchema.parse(write).repositories).toEqual([
			"whiteboard-app",
		]);
		expect(
			projectWriteSchema.safeParse({ ...write, repositories: ["a/b"] }).success,
		).toBe(false);
		expect(
			projectWriteSchema.safeParse({ ...write, repositories: ["Repo", "repo"] })
				.success,
		).toBe(false);
		const pull = demoWorkspace(1_789_632_000).pullRequests[0]!;
		expect(
			pullRequestSchema.parse({
				...pull,
				filesChanged: null,
				additions: null,
				deletions: null,
				comments: null,
			}).filesChanged,
		).toBeNull();
	});
	test("bounds uploads and requires explicit complete snapshot counts", () => {
		const pull = demoWorkspace(1_789_632_000).pullRequests[0]!;
		const leaseToken = "6135303f-09e3-4d29-b7aa-9f09a958c8a8";
		expect(adoPullId("project", "repo", "12")).toBe("ado:project:repo:12");
		expect(
			collectionBatchSchema.safeParse({ leaseToken, pulls: [pull] }).success,
		).toBe(true);
		expect(
			collectionBatchSchema.safeParse({
				leaseToken,
				pulls: Array(21).fill(pull),
			}).success,
		).toBe(false);
		expect(
			collectionBatchSchema.safeParse({ leaseToken: "", pulls: [pull] })
				.success,
		).toBe(false);
		expect(
			collectionFinishSchema.safeParse({
				leaseToken,
				state: "complete",
				pullRequestCount: 0,
				message: "No active PRs",
			}).success,
		).toBe(true);
		expect(
			collectionFinishSchema.safeParse({
				leaseToken,
				state: "complete",
				message: "Missing count",
			}).success,
		).toBe(false);
	});
});
