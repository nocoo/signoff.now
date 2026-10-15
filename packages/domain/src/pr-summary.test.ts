import { expect, test } from "bun:test";
import { presentReadiness } from "./ai-readiness.js";
import { demoWorkspace } from "./demo.js";
import { inspectionSchema } from "./inspection.js";
import { summarizeInspection, summarizePull } from "./pr-summary.js";
import { pullQuerySchema } from "./query.js";
import type { Policy, PullRequest } from "./workbench.js";

const now = 1800000000;
const iso = new Date(now * 1000).toISOString();
const demo = demoWorkspace(now);
const project = demo.projects[0]!;
const pull = demo.pullRequests[0]!;
function item(changes: Partial<PullRequest> = {}) {
	const snapshot = {
		...pull,
		state: "open",
		draft: false,
		policies: [],
		builds: [],
		...changes,
	};
	return pullQuerySchema.parse({
		...snapshot,
		createdAt: iso,
		updatedAt: iso,
		mergedAt: null,
		publishedAt: iso,
		provider: "ado",
		organization: { key: "org", url: "https://dev.azure.com/org" },
		project: {
			...project,
			source: "live",
			createdAt: iso,
			updatedAt: iso,
			lastScannedAt: null,
			key: project.projectKey,
			url: "https://dev.azure.com/org/project",
		},
		repository: {
			...pull.repository,
			url: "https://dev.azure.com/org/project/_git/repo",
		},
		url: "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
		author: { ...pull.author, key: "actor" },
		activity: [],
		observation: null,
		freshness: {
			listObservedAt: iso,
			checksObservedAt: iso,
			checksValidity: "valid",
			ageSeconds: { list: 0, checks: 0 },
			clockSkew: false,
		},
		readiness: presentReadiness("not_watched"),
		checks: {
			checksPassed: 0,
			checksTotal: 0,
			stagesPassed: 0,
			stagesTotal: 0,
			optionalFailures: 0,
		},
		requirements: [],
		content: { state: "complete", missing: [] },
	});
}
const policy = (
	name: string,
	state: Policy["state"],
	kind: Policy["kind"] = "policy",
	extra: Partial<Policy> = {},
): Policy => ({
	id: name,
	name,
	state,
	kind,
	required: true,
	owner: "Owner",
	detail: "",
	...extra,
});

test("bot summary groups and deduplicates policies without making a readiness choice", () => {
	const summary = summarizePull(
		item({
			policies: [
				policy("Minimum number of reviewers", "queued", "review"),
				policy("Minimum number of reviewers", "failed", "review"),
				policy("Proof Of Presence", "failed"),
				policy("Code Review Compliance Policy", "running", "status"),
				policy("CI queue", "queued"),
				policy("CI running", "running"),
				policy("Comments", "failed"),
				policy("Optional", "failed", "policy", { required: false }),
				policy("Done", "passed"),
				policy("Not applicable", "skipped"),
			],
		}),
	);
	expect(summary.readiness.kind).toBe("unknown");
	expect(summary.blockers.map((b) => b.group)).toEqual([
		"attention",
		"running",
		"waiting",
		"review",
		"review",
		"pop",
	]);
	expect(
		summary.blockers.find((b) => b.name === "Minimum number of reviewers")
			?.states,
	).toEqual(["failed", "queued"]);
	expect(summary.pop).toEqual({ state: "unsatisfied", deferred: true });
	expect(summary.updatedAt).toBe(iso);
});

test("approvals exclude ineligible author and group votes and preserve thresholds", () => {
	const summary = summarizePull(
		item({
			policies: [
				policy("Minimum number of reviewers", "queued", "review", {
					evidence: {
						typeId: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						status: "queued",
						minimumApproverCount: 2,
						creatorVoteCounts: false,
					},
				}),
			],
			reviewers: [
				{ ...pull.author, vote: "approved", required: false },
				{
					id: "group",
					name: "Group",
					isGroup: true,
					vote: "approved",
					required: true,
				},
				{ id: "reviewer", name: "Reviewer", vote: "approved", required: false },
			],
		}),
	);
	expect(summary.approvals).toEqual({
		approved: 1,
		required: 2,
		remaining: 1,
		requiredReviewersPending: false,
	});
});

test("partial execution remains distinguishable from failure and expiry", () => {
	const build = {
		id: "ci",
		name: "CI",
		number: 1,
		required: true,
		state: "failed" as const,
		evidence: { result: "partiallySucceeded" },
		stages: [
			{
				id: "verify",
				name: "Verification",
				state: "unknown" as const,
				required: true,
				owner: "CI",
				detail: "",
				durationSeconds: null,
				evidence: { result: "succeededWithIssues" },
			},
		],
	};
	expect(summarizePull(item({ builds: [build] })).ci).toMatchObject({
		status: "partial",
		builds: [
			{
				status: "partial",
				stages: [{ name: "Verification", status: "partial" }],
			},
		],
	});
	expect(
		summarizePull(
			item({ builds: [{ ...build, evidence: { result: "failed" } }] }),
		).ci.status,
	).toBe("failed");
	expect(
		summarizePull(
			item({
				builds: [build],
				policies: [
					policy("CI", "passed", "build", {
						evidence: { status: "approved", isExpired: true },
					}),
				],
			}),
		).ci.status,
	).toBe("expired");
	for (const result of ["succeeded", "inProgress", "queued"] as const) {
		const summary = summarizePull(
			item({ builds: [{ ...build, evidence: { result }, stages: [] }] }),
		);
		expect(summary.ci.status).toBe(
			{ succeeded: "passed", inProgress: "running", queued: "queued" }[result],
		);
	}
});

test("PoP and lifecycle expose applicability, completion and historical judgments", () => {
	for (const [state, expected] of [
		["passed", "satisfied"],
		["queued", "queued"],
		["running", "running"],
		["unknown", "unknown"],
	] as const) {
		expect(
			summarizePull(item({ policies: [policy("Proof Of Presence", state)] }))
				.pop.state,
		).toBe(expected);
	}
	expect(
		summarizePull(
			item({
				policies: [
					policy("Proof Of Presence", "failed", "policy", { required: false }),
				],
			}),
		).pop.state,
	).toBe("not_required");
	expect(summarizePull(item()).pop.state).toBe("not_applicable");
	const current = item({ state: "merged", mergeable: "conflicts" });
	const judgment = {
		kind: "pop_needed" as const,
		model: "test",
		rubric: "test",
		fingerprint: "f",
		evaluatedAt: iso,
		probabilities: { pop_needed: 1 },
		confidence: 1,
		reusedAt: null,
	};
	current.readiness = presentReadiness("pending", null, null, judgment);
	expect(summarizePull(current)).toMatchObject({
		lifecycle: "merged",
		conflict: true,
		readiness: { kind: "pop_needed", label: "PoP Needed", isCurrent: false },
	});
	current.state = "draft";
	expect(summarizePull(current).lifecycle).toBe("draft");
});

test("uncollected inspection preserves unknowns rather than inventing satisfied requirements", () => {
	const quality = {
		observedAt: null,
		coverage: "not_collected",
		missing: [],
		lastAttempt: null,
	};
	const inspection = inspectionSchema.parse({
		watch: {
			id: "watch",
			generation: 1,
			active: true,
			addedAt: iso,
			stoppedAt: null,
			stopReason: null,
		},
		pr: {
			id: null,
			number: 1,
			title: null,
			url: "https://example.com/pr/1",
			provider: "ado",
			organization: "org",
			project: { signoffId: "project", providerId: null, name: "Project" },
			repository: { id: "repo", name: "Repo" },
			author: null,
			lifecycle: null,
			draft: null,
			providerStatus: null,
			providerMergeStatus: null,
			sourceBranch: null,
			targetBranch: null,
			headSha: null,
			targetSha: null,
			targetShaSource: "unknown",
			mergeSha: null,
			mergeability: "unknown",
			createdAt: null,
			updatedAt: null,
			collection: quality,
		},
		readiness: {
			state: null,
			source: null,
			evaluatedAt: null,
			isCurrent: false,
			phase: "collecting",
			fingerprint: null,
			model: null,
			rubric: null,
			reusedAt: null,
			update: {
				state: "blocked",
				reason: "awaiting_collection",
				notBefore: null,
				error: null,
			},
		},
		nextAction: null,
		checks: { ...quality, validity: "missing", items: [] },
		builds: [],
		reviews: {
			observedAt: null,
			individualApproved: 0,
			groupApproved: 0,
			unclassifiedApproved: 0,
			requirementsSource: "checks",
			reviewers: [],
		},
	});
	expect(summarizeInspection(inspection)).toMatchObject({
		approvals: { approved: null, required: null, remaining: null },
		checksValidity: "missing",
		ci: { status: "unknown" },
		lifecycle: null,
	});
	inspection.reviews.observedAt = iso;
	inspection.reviews.reviewers = [
		{
			id: "r",
			name: "Reviewer",
			isGroup: false,
			required: false,
			vote: "approved",
			providerVote: 10,
			hasDeclined: false,
			countsTowardApproval: true,
			approvalRevision: null,
		},
	];
	inspection.pr.lifecycle = "open";
	inspection.pr.draft = true;
	expect(summarizeInspection(inspection)).toMatchObject({
		approvals: { approved: 1 },
		lifecycle: "draft",
	});
	inspection.pr.author = { id: "author", name: "Author" };
	inspection.pr.updatedAt = iso;
	inspection.reviews.reviewers.push(
		{ ...inspection.reviews.reviewers[0]!, id: "author" },
		{ ...inspection.reviews.reviewers[0]!, id: "group", isGroup: true },
	);
	inspection.checks.items = [
		{
			ref: "checks/review",
			id: "review",
			code: "C2",
			name: "Minimum number of reviewers",
			kind: "review",
			state: "queued",
			providerStatus: "queued",
			required: true,
			enabled: true,
			applicable: true,
			isExpired: false,
			buildIsNotCurrent: null,
			evaluationId: null,
			configurationId: null,
			configurationRevision: null,
			buildId: null,
			definitionId: null,
			message: null,
			url: "https://example.com/policy",
			updatedAt: null,
			startedAt: null,
			completedAt: null,
			validDurationMinutes: null,
			scope: null,
			reviewRule: {
				minimumApproverCount: 2,
				creatorVoteCounts: false,
				allowDownvotes: false,
				requiredReviewerIds: null,
				filenamePatterns: null,
			},
		},
	];
	const execution = {
		state: "failed" as const,
		providerStatus: "completed",
		providerResult: "partiallySucceeded",
		message: null,
		updatedAt: null,
		startedAt: null,
		completedAt: null,
	};
	inspection.builds = [
		{
			...execution,
			id: "ci",
			name: "CI",
			ref: "builds/ci",
			definitionId: null,
			number: 1,
			required: true,
			sourceSha: null,
			sourceBranch: null,
			url: "https://example.com/build/1",
			headMatch: { actualSha: null, expectedSha: null, status: "unknown" },
			mergeMatch: { actualSha: null, expectedSha: null, status: "unknown" },
			checkRefs: [],
			observedAt: iso,
			queuedAt: null,
			stages: [
				{
					...execution,
					id: "verify",
					name: "Verification",
					ref: "stages/verify",
					identifier: null,
					recordType: "Stage",
					attempt: 1,
					required: true,
					requiredSource: "derived",
					providerResult: "succeededWithIssues",
				},
			],
		},
	];
	expect(summarizeInspection(inspection)).toMatchObject({
		approvals: { approved: 1, required: 2, remaining: 1 },
		ci: {
			status: "partial",
			builds: [{ stages: [{ name: "Verification", status: "partial" }] }],
		},
		updatedAt: iso,
		blockers: [{ name: "Minimum number of reviewers", group: "review" }],
	});
});
