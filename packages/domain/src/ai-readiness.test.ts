import { expect, test } from "bun:test";
import {
	canonicalJson,
	decisionFingerprint,
	decisionState,
	JEV_MODEL,
	JEV_RUBRIC,
	jevResultSchema,
	policyCatalog,
	policyInstructions,
	presentReadiness,
} from "./ai-readiness.js";
import { demoWorkspace } from "./demo.js";
import {
	checksValidity,
	evaluatePull,
	interpretPull,
	providerCheckState,
} from "./state-machine.js";
import {
	approvalCount,
	type Policy,
	projectMergeRequirements,
	pullRequirements,
} from "./workbench.js";

const now = 1800000000;
const demo = demoWorkspace(now),
	project = demo.projects[0]!;
const pull = {
	...demo.pullRequests[0]!,
	projectId: project.id,
	state: "open" as const,
	draft: false,
};
const policy: Policy = {
	id: "policy-1",
	name: "Policy",
	kind: "build",
	definitionId: "42",
	state: "running",
	required: true,
	detail: "Resolve X, then rerun",
	owner: "Owner",
	evidence: {
		status: "running",
		isBlocking: true,
		isEnabled: true,
		buildId: "1",
	},
};
const result = jevResultSchema.parse({
	kind: "on_track",
	action: null,
	model: JEV_MODEL,
	rubric: JEV_RUBRIC,
	fingerprint: "test",
	evaluatedAt: new Date(now * 1000).toISOString(),
	probabilities: { on_track: 1, attention: 0, unknown: 0 },
	confidence: 1,
	actionProbabilities: null,
	actionConfidence: null,
});
test("operational states cannot masquerade as a current model judgment", () => {
	expect(presentReadiness("complete", result)).toMatchObject({
		kind: "on_track",
		current: result,
		previous: null,
	});
	expect(
		presentReadiness("complete", {
			...result,
			kind: "attention",
			action: "approve",
		}).nextAction,
	).toContain("approval");
	expect(
		presentReadiness("complete", { ...result, kind: "unknown" }).kind,
	).toBe("unknown");
	for (const status of [
		"pending",
		"running",
		"error",
		"not_watched",
	] as const) {
		const value = presentReadiness(
			status,
			null,
			status === "error" ? "failed" : null,
			result,
		);
		expect(value.current).toBeNull();
		expect(value.kind).toBe(status === "error" ? "error" : "unknown");
	}
});
test("all policies and exact review facts enter context without generated action summaries", async () => {
	const snapshot = {
		...pull,
		policies: [
			policy,
			{
				...policy,
				id: "advisory",
				required: false,
				evidence: {
					...policy.evidence,
					isBlocking: false,
					isExpired: true,
					buildIsNotCurrent: false,
				},
			},
		],
		headSha: "head",
		evidence: { status: "active", mergeSha: "merge" },
		builds: [
			{
				id: "1",
				name: "CI",
				number: 1,
				definitionId: "42",
				required: true,
				state: "running" as const,
				evidence: { sourceSha: "head", status: "inProgress" },
				stages: [
					{
						...policy,
						id: "stage",
						evidence: { status: "pending", attempt: 2 },
						durationSeconds: 10,
					},
				],
			},
		],
		reviewers: [
			{ id: "a", name: "Approver", vote: "approved" as const, required: true },
			{
				id: "group",
				name: "Group",
				isGroup: true,
				vote: "approved" as const,
				required: true,
			},
		],
		requiredApprovals: 2,
	};
	const config = {
		...project,
		policyContext: {
			default: [
				{
					gateId: "build:42",
					description: "Expected wait; a human acts only for explicit expiry.",
				},
				{ gateId: "removed", description: "Retained instruction" },
			],
			repositories: {},
		},
	};
	const state = decisionState(snapshot, config, now);
	expect(state.policies).toHaveLength(2);
	expect(state.policiesInPriorityOrder[0]?.description).toContain(
		"Expected wait",
	);
	expect(state.reviews).toMatchObject({
		approvalCount: 1,
		remainingApprovals: 1,
	});
	expect(approvalCount(snapshot)).toBe(1);
	expect(state.builds[0]).toMatchObject({
		headMatchesSource: true,
		mergeMatchesSource: false,
		policyIds: ["advisory", "policy-1"],
	});
	expect(state.builds[0]?.stages[0]?.requiredProvenance).toContain(
		"not a provider guarantee",
	);
	expect(JSON.stringify(state)).not.toContain("Resolve X");
	expect(state.policies[0]?.evidence).toMatchObject({
		isExpired: true,
		buildIsNotCurrent: false,
	});
	const later = decisionState(
		{
			...snapshot,
			observedAt: now + 1,
			updatedAt: now + 1,
			reviewers: [...snapshot.reviewers].reverse(),
			policies: [...snapshot.policies].reverse(),
			builds: snapshot.builds.map((b) => ({
				...b,
				stages: b.stages.map((s) => ({ ...s, durationSeconds: 11 })),
			})),
		},
		config,
		now + 1,
	);
	expect(await decisionFingerprint(state)).toBe(
		await decisionFingerprint(later),
	);
	expect(await decisionFingerprint(state)).not.toBe(
		await decisionFingerprint(
			decisionState({ ...snapshot, checksInvalidated: true }, config, now),
		),
	);
	expect(
		policyInstructions(
			{
				...config,
				policyContext: {
					...config.policyContext,
					repositories: { [pull.repository.id]: [] },
				},
			},
			pull.repository.id,
		),
	).toEqual([]);
	expect(canonicalJson({ b: 1, a: null, c: undefined })).toBe(
		'{"a":null,"b":1}',
	);
});
test("provider vocabulary, expiry and review semantics remain raw evidence separate from Jev", () => {
	const states = {
		approved: "passed",
		succeeded: "passed",
		success: "passed",
		notApplicable: "skipped",
		skipped: "skipped",
		failed: "failed",
		failure: "failed",
		error: "failed",
		rejected: "failed",
		broken: "failed",
		partiallySucceeded: "failed",
		running: "running",
		inProgress: "running",
		cancelling: "running",
		queued: "queued",
		notStarted: "queued",
		waiting: "waiting",
		pending: "waiting",
		canceled: "canceled",
		cancelled: "canceled",
		newState: "unknown",
	} as const;
	for (const [raw, state] of Object.entries(states))
		expect(providerCheckState(raw)).toBe(state);
	const interpreted = interpretPull({
		...pull,
		policies: [
			{ ...policy, evidence: { status: "approved", isExpired: true } },
			{ ...policy, id: "status-check", evidence: { status: "pending" } },
			{
				...policy,
				id: "review",
				kind: "review",
				evidence: {
					typeId: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
					status: "queued",
					minimumApproverCount: 3,
					creatorVoteCounts: false,
					allowDownvotes: true,
				},
			},
		],
		reviewers: [
			...[-10, -5, 0, 5, 10].map((vote, i) => ({
				id: String(i),
				name: "Reviewer",
				vote: "pending" as const,
				providerVote: vote,
				required: true,
			})),
			{ ...pull.author, vote: "approved" as const, required: true },
		],
	});
	expect(interpreted.policies[0]).toMatchObject({
		expired: true,
		state: "failed",
	});
	expect(interpreted.policies[1]?.state).toBe("running");
	expect(interpreted.requiredApprovals).toBe(3);
	expect(approvalCount(interpreted)).toBe(2);
	expect(checksValidity({ ...pull, checksObservedAt: null })).toBe("missing");
	expect(checksValidity({ ...pull, checksInvalidated: true })).toBe(
		"invalidated",
	);
	expect(evaluatePull(interpreted, project)).not.toHaveProperty("readiness");
	expect(pullRequirements(interpreted, project).length).toBeGreaterThan(0);
});
test("logical catalogs retain source scopes and distinct pipeline definitions including advisory policies", () => {
	const snapshot = {
		...pull,
		policies: [
			policy,
			{
				...policy,
				id: "policy-2",
				evidence: {
					scope: [{ repositoryId: "other", refName: "refs/heads/main" }],
				},
			},
			{
				...policy,
				id: "optional",
				name: "Advisory",
				kind: "policy" as const,
				required: false,
			},
		],
		builds: [
			{
				id: "unlinked",
				name: "Second CI",
				number: 1,
				definitionId: "43",
				state: "unknown" as const,
				required: true,
				stages: [],
			},
		],
	};
	const catalog = policyCatalog(project, [snapshot]);
	expect(catalog.find((g) => g.id === "build:42")?.sourceIds).toEqual([
		"policy-1",
		"policy-2",
	]);
	expect(catalog.some((g) => g.name === "Advisory")).toBe(true);
	expect(catalog.some((g) => g.definitionId === "43")).toBe(true);
	const repeated = projectMergeRequirements(
		{ ...project, mergeRequirements: catalog },
		[snapshot],
	);
	expect(repeated.find((g) => g.definitionId === "42")?.sourceIds).toContain(
		"policy-2",
	);
	for (const mergeable of ["clear", "conflicts", "unknown"] as const)
		expect(
			pullRequirements({ ...snapshot, mergeable }, project).find(
				(g) => g.kind === "conflict",
			)?.state,
		).toBe(
			({ clear: "passed", conflicts: "failed", unknown: "unknown" } as const)[
				mergeable
			],
		);
});
test("renaming a discovered policy retains its stable instruction identity", () => {
	const original = {
		...pull,
		policies: [{ ...policy, kind: "policy" as const, definitionId: undefined }],
		builds: [],
	};
	const catalog = policyCatalog(project, [original]);
	const gate = catalog.find((g) => g.sourceIds?.includes(policy.id))!;
	const renamed = policyCatalog({ ...project, mergeRequirements: catalog }, [
		{
			...original,
			policies: original.policies.map((p) => ({
				...p,
				name: "Renamed policy",
			})),
		},
	]);
	expect(renamed.find((g) => g.id === gate.id)?.name).toBe("Renamed policy");
});
