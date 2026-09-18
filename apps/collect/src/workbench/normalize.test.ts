import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "@signoff/domain/demo";
import { pullReadiness } from "@signoff/domain/workbench";
import {
	deduplicateLatestStatuses,
	extractRequiredApprovals,
	mapCheckState,
	mapMergeable,
	mapReviewerVote,
	normalizeBuild,
	normalizeBuildStages,
	normalizePolicy,
	normalizePullRequest,
	normalizeStatusPolicy,
	parseSeconds,
} from "./normalize.js";

describe("workbench normalizer", () => {
	test.each([
		{ isExpired: true },
		{ isExpired: true, buildIsNotCurrent: false },
		{ isExpired: true, buildIsNotCurrent: true },
	])("expired build evaluations remain blocking even after a successful run: %j", (context) => {
		const policy = normalizePolicy({
			status: "approved",
			configuration: {
				id: 18,
				type: {
					id: "0609b952-1397-4640-95ec-e00a01b2c241",
					displayName: "Build",
				},
				settings: { buildDefinitionId: 42 },
			},
			context: { buildId: 100, ...context },
		});
		expect(policy).toMatchObject({
			kind: "build",
			state: "failed",
			expired: true,
		});
		expect(policy.detail).toMatch(/expired/i);
		expect(policy.detail).toMatch(/queue|rerun/i);
	});
	test.each([
		false,
		undefined,
	])("an approved build behind the target remains valid until ADO expires it (%s)", (isExpired) => {
		const policy = normalizePolicy({
			status: "approved",
			configuration: {
				id: 896,
				type: { id: "0609b952-1397-4640-95ec-e00a01b2c241" },
				settings: { buildDefinitionId: 653, validDuration: 1440 },
			},
			context: { buildId: 753506, buildIsNotCurrent: true, isExpired },
		});
		expect(policy.state).toBe("passed");
		expect(policy.expired).toBe(isExpired);
		expect(policy.detail).not.toMatch(/expired|queue|rerun/i);
	});
	test("expiry is explicit build evidence, not a guess from pending or arbitrary policy context", () => {
		for (const context of [
			{},
			{ isExpired: false, buildIsNotCurrent: false },
			{ isExpired: "true", buildIsNotCurrent: "false" },
		]) {
			const policy = normalizePolicy({
				status: "queued",
				configuration: {
					id: 18,
					type: {
						id: "0609b952-1397-4640-95ec-e00a01b2c241",
						displayName: "Build",
					},
				},
				context,
			});
			expect(policy.state).toBe("queued");
			expect(policy.expired).toBe(
				"isExpired" in context && context.isExpired === false
					? false
					: undefined,
			);
		}
		const review = normalizePolicy({
			status: "approved",
			configuration: {
				id: 1,
				type: { id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" },
			},
			context: { isExpired: true },
		});
		expect(review.state).toBe("passed");
		expect(review.expired).toBeUndefined();
	});
	test("reapplies minimum-reviewer downvote rules to fresh optional rejections", () => {
		const workspace = demoWorkspace(1_789_632_000);
		for (const allowDownvotes of [false, true, undefined]) {
			for (const vote of [-10, -5]) {
				const pull = normalizePullRequest({
					projectId: workspace.projects[0]!.id,
					rawPr: {
						pullRequestId: 1,
						status: "active",
						title: "Review eligibility",
						sourceRefName: "refs/heads/change",
						targetRefName: "refs/heads/main",
						repository: { id: "repo", name: "app" },
						mergeStatus: "succeeded",
						reviewers: [
							{ id: "one", displayName: "One", vote: 10 },
							{ id: "two", displayName: "Two", vote: 10 },
							{ id: "three", displayName: "Three", vote },
						],
					},
					evaluations: [
						{
							status: "approved",
							configuration: {
								id: 1,
								type: {
									id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
									displayName: "Minimum number of reviewers",
								},
								settings: { minimumApproverCount: 2, allowDownvotes },
							},
						},
					],
					now: 1_789_632_000,
				});
				expect(pullReadiness(pull, workspace.projects[0]!).kind).toBe(
					allowDownvotes === true ? "ready" : "blocked",
				);
			}
		}
	});
	test("known ADO policy types take precedence over reviewer words in display names", () => {
		for (const [typeId, kind] of [
			["0609b952-1397-4640-95ec-e00a01b2c241", "build"],
			["cbdc66da-9728-4af8-aada-9a5a32e4a226", "status"],
			["other-policy-type", "policy"],
			[undefined, "review"],
		] as const) {
			const policy = normalizePolicy({
				status: "rejected",
				configuration: {
					id: 42,
					type: { id: typeId, displayName: "Reviewer validation" },
					settings: { buildDefinitionId: 42 },
				},
			});
			expect(policy.kind).toBe(kind);
			if (kind !== "review")
				expect(policy.detail).not.toContain("reviewer approvals");
			if (kind === "build") expect(policy.definitionId).toBe("42");
		}
	});
	test("retains reviewer policy semantics for queued and rejected evaluations", () => {
		for (const status of ["queued", "rejected", "running"] as const) {
			const policy = normalizePolicy({
				status,
				configuration: {
					id: 17,
					type: {
						id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						displayName: "Minimum number of reviewers",
					},
					isEnabled: true,
					isBlocking: true,
					settings: { minimumApproverCount: 2, creatorVoteCounts: false },
				},
			});
			expect(policy).toMatchObject({
				id: "policy-17",
				kind: "review",
				state: mapCheckState(status),
				required: true,
			});
			expect(policy.detail).toMatch(/reviewer approvals/);
		}
	});
	test("links build policies to pipeline definitions instead of build runs", () => {
		const policy = normalizePolicy({
			status: "running",
			configuration: {
				id: 18,
				type: {
					id: "0609b952-1397-4640-95ec-e00a01b2c241",
					displayName: "Build",
				},
				settings: { buildDefinitionId: 42 },
			},
			context: { buildDefinitionName: "PR validation", buildId: 100 },
		});
		expect(policy).toMatchObject({
			kind: "build",
			definitionId: "42",
			name: "PR validation",
		});
		expect(
			normalizeBuild({
				build: { id: 101, definition: { id: 42, name: "PR validation" } },
				stages: [],
			}),
		).toMatchObject({ definitionId: "42" });
	});
	test("conditional skipped stages do not block a successful required build", () => {
		const stages = normalizeBuildStages([
			{ id: "test", name: "Tests", type: "Stage", result: "succeeded" },
			{ id: "release", name: "Release", type: "Stage", result: "skipped" },
			{ id: "task", name: "Task", type: "Task", result: "failed" },
		]);
		const build = normalizeBuild({
			build: { id: 8, result: "succeeded" },
			stages,
			required: true,
		});
		const fixture = demoWorkspace(1_789_632_000);
		const ready = fixture.pullRequests.find(
			(pull) =>
				pullReadiness(
					pull,
					fixture.projects.find((project) => project.id === pull.projectId)!,
				).kind === "ready",
		)!;
		expect(stages.find((stage) => stage.id === "release")?.required).toBe(
			false,
		);
		expect(
			pullReadiness(
				{ ...ready, builds: [build] },
				fixture.projects.find((project) => project.id === ready.projectId)!,
			).kind,
		).toBe("ready");
	});
	test("pending timeline records represent queued execution and retries replace old attempts", () => {
		const stages = normalizeBuildStages([
			{
				id: "one",
				identifier: "Tests",
				attempt: 1,
				name: "Tests",
				type: "Stage",
				result: "failed",
			},
			{
				id: "two",
				identifier: "Tests",
				attempt: 2,
				name: "Tests",
				type: "Stage",
				state: "pending",
				result: null,
			},
		]);
		expect(stages).toHaveLength(1);
		expect(stages[0]?.state).toBe("queued");
		expect(stages[0]?.id).toBe("two");
	});
	test("updated status reports supersede larger but older status IDs", () => {
		const latest = deduplicateLatestStatuses([
			{
				id: 8,
				context: { name: "ci" },
				state: "failed",
				updatedDate: "2026-09-17T00:00:00Z",
			},
			{
				id: 7,
				context: { name: "ci" },
				state: "succeeded",
				updatedDate: "2026-09-17T01:00:00Z",
			},
		]);
		expect(latest[0]?.state).toBe("succeeded");
	});
	test("respects creatorVoteCounts and provides actionable policy detail", () => {
		const rawPr = {
			pullRequestId: 1,
			status: "active",
			title: "Change",
			sourceRefName: "refs/heads/change",
			targetRefName: "refs/heads/main",
			mergeStatus: "succeeded",
			createdBy: { id: "author", displayName: "Author" },
			repository: { id: "repo", name: "api" },
			reviewers: [{ id: "author", displayName: "Author", vote: 10 }],
		};
		const evaluation = {
			status: "approved",
			configuration: {
				id: 1,
				type: {
					id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
					displayName: "Minimum reviewers",
				},
				settings: { minimumApproverCount: 1, creatorVoteCounts: false },
			},
		};
		const pull = normalizePullRequest({
			projectId: "p",
			rawPr,
			evaluations: [evaluation],
			now: 1_789_632_000,
		});
		expect(pull.reviewers[0]?.countsTowardApproval).toBe(false);
		expect(pull.authorCountsTowardApproval).toBe(false);
		expect(
			normalizePullRequest({
				projectId: "p",
				rawPr: { ...rawPr, reviewers: [] },
				evaluations: [evaluation],
				now: 1_789_632_000,
			}).authorCountsTowardApproval,
		).toBe(false);
		expect(
			normalizePullRequest({
				projectId: "p",
				rawPr,
				evaluations: [],
				now: 1_789_632_000,
			}).authorCountsTowardApproval,
		).toBe(true);
		expect(
			normalizePullRequest({
				projectId: "p",
				rawPr,
				now: 1_789_632_000,
			}).authorCountsTowardApproval,
		).toBeUndefined();
		expect(
			pullReadiness(pull, demoWorkspace(1_789_632_000).projects[0]!).kind,
		).toBe("review");
		const rejected = normalizePolicy({ ...evaluation, status: "rejected" });
		expect(rejected.detail).toMatch(/approval/i);
		expect(rejected.detail).not.toBe("rejected");
	});
	test("maps check state correctly", () => {
		expect(mapCheckState("approved")).toBe("passed");
		expect(mapCheckState("succeeded")).toBe("passed");
		expect(mapCheckState("partiallySucceeded")).toBe("failed");
		expect(mapCheckState("failed")).toBe("failed");
		expect(mapCheckState("rejected")).toBe("failed");
		expect(mapCheckState("running")).toBe("running");
		expect(mapCheckState("inProgress")).toBe("running");
		expect(mapCheckState("queued")).toBe("queued");
		expect(mapCheckState("notStarted")).toBe("queued");
		expect(mapCheckState("waiting")).toBe("waiting");
		expect(mapCheckState("canceled")).toBe("canceled");
		expect(mapCheckState("skipped")).toBe("skipped");
		expect(mapCheckState("notApplicable")).toBe("skipped");
		expect(mapCheckState("unknownState")).toBe("unknown");
		expect(mapCheckState(null)).toBe("unknown");
	});

	test("maps reviewer votes correctly", () => {
		expect(mapReviewerVote(10)).toBe("approved");
		expect(mapReviewerVote(5)).toBe("approved"); // approved with suggestions
		expect(mapReviewerVote(0)).toBe("pending");
		expect(mapReviewerVote(-5)).toBe("changes_requested"); // waiting for author
		expect(mapReviewerVote(-10)).toBe("changes_requested"); // rejected
	});

	test("maps mergeStatus correctly without treating generic failure as conflict", () => {
		expect(mapMergeable("succeeded")).toBe("clear");
		expect(mapMergeable("conflicts")).toBe("conflicts");
		expect(mapMergeable("failure")).toBe("unknown");
		expect(mapMergeable(undefined)).toBe("unknown");
	});

	test("parseSeconds handles null, invalid and valid dates", () => {
		expect(parseSeconds(null)).toBeNull();
		expect(parseSeconds("invalid")).toBeNull();
		expect(parseSeconds("2026-09-17T01:00:00Z")).toBe(1789606800);
	});

	test("normalizePolicy makes notApplicable nonrequired", () => {
		const ev = {
			status: "notApplicable",
			configuration: {
				id: 99,
				type: { displayName: "Optional Gate" },
				isBlocking: true,
				isEnabled: true,
			},
		};
		const p = normalizePolicy(ev);
		expect(p.state).toBe("skipped");
		expect(p.required).toBe(false);
	});

	test("normalizeStatusPolicy handles genre and pending status as running", () => {
		const st = {
			id: 5,
			state: "pending",
			context: { genre: "ci", name: "build" },
			description: "running check",
		};
		const p = normalizeStatusPolicy(st, true);
		expect(p.state).toBe("running");
		expect(p.required).toBe(true);
		expect(p.name).toBe("ci/build");
	});

	test("normalizeBuildStages handles job fallback and duration", () => {
		const records = [
			{
				id: "j2",
				type: "Job",
				name: "Test",
				state: "completed",
				result: "succeeded",
				order: 2,
				startTime: "2026-09-17T01:00:00Z",
				finishTime: "2026-09-17T01:02:00Z",
			},
			{
				id: "j1",
				type: "Job",
				name: "Build",
				state: "completed",
				result: "succeeded",
				order: 1,
				startTime: "2026-09-17T01:00:00Z",
				finishTime: "2026-09-17T01:01:00Z",
			},
		];
		const stages = normalizeBuildStages(records);
		expect(stages).toHaveLength(2);
		expect(stages[0]?.name).toBe("Build");
		expect(stages[0]?.durationSeconds).toBe(60);
		expect(stages[1]?.name).toBe("Test");
		expect(stages[1]?.durationSeconds).toBe(120);
	});

	test("extracts requiredApprovals from policy settings over individual count", () => {
		const evals = [
			{
				configuration: {
					id: 1,
					type: {
						id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						displayName: "Minimum number of reviewers",
					},
					isBlocking: true,
					isEnabled: true,
					settings: { minimumApproverCount: 2 },
				},
			},
			{
				configuration: {
					id: 2,
					type: {
						id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						displayName: "Minimum number of reviewers",
					},
					isBlocking: true,
					isEnabled: true,
					settings: { minimumApproverCount: 1 },
				},
			},
		];
		expect(extractRequiredApprovals(evals)).toBe(2);
	});

	test("deduplicates historical statuses by genre/name keeping highest id", () => {
		const statuses = [
			{ id: 1, context: { genre: "cg", name: "check" }, state: "pending" },
			{ id: 2, context: { genre: "cg", name: "check" }, state: "succeeded" },
			{ id: 3, context: { genre: "lint", name: "code" }, state: "succeeded" },
		];
		const deduped = deduplicateLatestStatuses(statuses);
		expect(deduped).toHaveLength(2);
		expect(deduped.find((s) => s.context?.name === "check")?.id).toBe(2);
	});

	test("normalizes a complete ADO PR to domain PullRequest with UNIX SECONDS now", () => {
		const rawPr = {
			pullRequestId: 1234,
			status: "active",
			title: "feat: add support for widgets",
			description: "Implements widget support",
			sourceRefName: "refs/heads/feature/widgets",
			targetRefName: "refs/heads/main",
			mergeStatus: "succeeded",
			isDraft: false,
			creationDate: "2026-09-17T01:00:00Z",
			createdBy: {
				id: "user-1",
				displayName: "Alice Dev",
				uniqueName: "alice@example.com",
				imageUrl: "https://example.com/alice.png",
			},
			repository: {
				id: "repo-guid-1",
				name: "my-repo",
				project: {
					id: "proj-guid-1",
					name: "MyProject",
				},
			},
			reviewers: [
				{
					id: "rev-1",
					displayName: "Bob Reviewer",
					uniqueName: "bob@example.com",
					vote: 10,
					isRequired: true,
				},
				{
					id: "group-1",
					displayName: "GateKeepers",
					uniqueName: "vstfs:///Classification/TeamProject/GateKeepers",
					vote: 0,
					isRequired: true,
					isContainer: true,
				},
			],
			labels: [{ name: "needs-review" }],
		};

		const policies = [
			{
				evaluationId: "eval-1",
				status: "approved",
				configuration: {
					id: 101,
					type: {
						id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						displayName: "Minimum number of reviewers",
					},
					isBlocking: true,
					isEnabled: true,
					settings: { minimumApproverCount: 2 },
				},
			},
			{
				evaluationId: "eval-2",
				status: "running",
				configuration: {
					id: 102,
					type: {
						id: "cbdc66da-9728-4af8-aada-9a5a32e4a226",
						displayName: "Status check",
					},
					isBlocking: true,
					isEnabled: true,
					settings: {
						statusGenre: "cg",
						statusName: "ComponentGovernance",
					},
				},
			},
		];

		const statuses = [
			{
				id: 1,
				context: { genre: "cg", name: "ComponentGovernance" },
				state: "pending",
			},
			{
				id: 2,
				context: { genre: "extra", name: "advisory" },
				state: "succeeded",
			},
		];

		const builds = [
			{
				build: {
					id: 999,
					buildNumber: "Build 999",
					status: "completed",
					result: "succeeded",
					definition: { id: 42, name: "CI Pipeline" },
				},
				stages: [
					{
						id: "stage-1",
						name: "Build",
						state: "passed" as const,
						required: true,
						detail: "Build succeeded",
						owner: "CI Pipeline",
						durationSeconds: 120,
					},
				],
			},
		];

		const normalized = normalizePullRequest({
			projectId: "proj-local-id",
			rawPr,
			evaluations: policies,
			statuses,
			builds,
			now: 1_789_632_000, // Unix seconds
		});

		expect(normalized.id).toBe("ado:proj-local-id:repo-guid-1:1234");
		expect(normalized.observedAt).toBe(1_789_632_000);
		expect(normalized.number).toBe(1234);
		expect(normalized.title).toBe("feat: add support for widgets");
		expect(normalized.state).toBe("open");
		expect(normalized.draft).toBe(false);
		expect(normalized.mergeable).toBe("clear");
		expect(normalized.author.name).toBe("Alice Dev");
		expect(normalized.author.handle).toBe("alice@example.com");
		expect(normalized.author.avatarUrl).toBe("https://example.com/alice.png");
		expect(normalized.requiredApprovals).toBe(2);
		expect(normalized.reviewers).toHaveLength(2);
		expect(normalized.reviewers[0]?.vote).toBe("approved");
		expect(normalized.reviewers[1]?.isGroup).toBe(true);
		expect(normalized.policies.length).toBeGreaterThanOrEqual(2);
		expect(normalized.builds).toHaveLength(1);
		expect(normalized.builds[0]?.state).toBe("passed");
		expect(normalized.filesChanged).toBeNull();
		expect(normalized.additions).toBeNull();
	});

	test("preserves unknown stats as null and handles collection issues", () => {
		const rawPr = {
			pullRequestId: 5678,
			status: "completed",
			title: "PR with issues",
			sourceRefName: "refs/heads/foo",
			targetRefName: "refs/heads/main",
			repository: { id: "repo-1", name: "r1" },
		};

		const normalized = normalizePullRequest({
			projectId: "proj-1",
			rawPr,
			evaluations: [],
			statuses: [],
			builds: [],
			now: 1_789_632_000,
			collectionIssues: ["Failed to fetch build timeline for build 100"],
		});

		expect(normalized.state).toBe("merged");
		expect(normalized.filesChanged).toBeNull();
		expect(normalized.additions).toBeNull();
		expect(normalized.deletions).toBeNull();
		expect(normalized.comments).toBeNull();
		expect(normalized.coverage).toBe("partial");
		expect(normalized.collectionIssues).toEqual([
			"Failed to fetch build timeline for build 100",
		]);
	});
});
