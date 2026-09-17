import { describe, expect, test } from "bun:test";
import {
	adoPullId,
	collectionBatchSchema,
	collectionFinishSchema,
	collectorClaimSchema,
	parseAdoRepositoryUrl,
} from "./collection.js";
import { demoWorkspace } from "./demo.js";
import { projectWriteSchema, pullRequestSchema } from "./workbench.js";

describe("live collection contract", () => {
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
