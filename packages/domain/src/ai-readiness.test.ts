import { expect, test } from "bun:test";
import {
	canonicalJson,
	decisionFingerprint,
	decisionState,
	isMainTarget,
	JEV_MODEL,
	JEV_RUBRIC,
	jevResultSchema,
	policyCatalog,
	policyInstructions,
	presentReadiness,
	readinessBadge,
	readinessShortcut,
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
	kind: "running",
	model: JEV_MODEL,
	rubric: JEV_RUBRIC,
	fingerprint: "test",
	evaluatedAt: new Date(now * 1000).toISOString(),
	probabilities: { running: 1, attention: 0, unknown: 0 },
	confidence: 1,
});
test("operational states cannot masquerade as a current model judgment", () => {
	expect(readinessBadge(presentReadiness("complete", result))).toMatchObject({
		kind: "running",
		current: result,
		previous: null,
	});
	expect(
		presentReadiness("complete", {
			...result,
			kind: "attention",
		}).nextAction,
	).toContain("inspection");
	expect(
		presentReadiness("complete", { ...result, kind: "waiting" }).kind,
	).toBe("waiting");
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
		expect(readinessBadge(value).kind).toBe(
			status === "not_watched" ? "unknown" : result.kind,
		);
		if (status !== "not_watched")
			expect(value.nextAction).toBe("Wait for ongoing work or more evidence.");
		const empty = presentReadiness(status);
		expect(readinessBadge(empty)).toBe(empty);
	}
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

test("only exact main/master target names are eligible for Jev", () => {
	for (const targetBranch of [
		"main",
		"master",
		"refs/heads/main",
		"refs/heads/master",
	])
		expect(isMainTarget({ targetBranch })).toBe(true);
	for (const targetBranch of [
		"release/main",
		"MAIN",
		"master/feature",
		"refs/heads/mainline",
		"users/topic",
		"",
	])
		expect(isMainTarget({ targetBranch })).toBe(false);
});

test("concise evidence retains conflicting conclusions and scoped instructions without operational detail", async () => {
	const snapshot = {
		...pull,
		headSha: "head",
		policies: [
			policy,
			{
				...policy,
				id: "other-evaluation",
				state: "failed" as const,
				evidence: { ...policy.evidence, isExpired: true },
			},
		],
		builds: [
			{
				id: "b",
				name: "CI",
				number: 1,
				definitionId: "42",
				state: "passed" as const,
				required: true,
				evidence: { sourceSha: "head", result: "succeeded" },
				stages: [],
			},
		],
	};
	const config = {
		...project,
		policyContext: {
			default: [
				{ gateId: "build:42", description: "Inspect expiry; otherwise wait." },
			],
			repositories: {},
		},
	};
	const state = decisionState(snapshot, config);
	expect(
		structuredClone(
			state.evidence.requirements.find((r) => r.kind === "build"),
		),
	).toMatchObject({
		instructions: "Inspect expiry; otherwise wait.",
		facts: expect.arrayContaining([
			{
				source: "build",
				state: "passed",
				required: true,
				commitMatch: "match",
			},
			expect.objectContaining({
				source: "policy",
				isExpired: true,
				state: "failed",
			}),
		]),
	});
	const serialized = JSON.stringify(state);
	for (const omitted of [
		"headSha",
		"stages",
		"durationSeconds",
		"Resolve X",
		"other-evaluation",
	])
		expect(serialized).not.toContain(omitted);
	const later = {
		...snapshot,
		id: "different-pr",
		title: "Different title",
		number: 999,
		observedAt: now + 5000,
		updatedAt: now + 5000,
		policies: [...snapshot.policies].reverse(),
		builds: snapshot.builds.map((b) => ({
			...b,
			id: "new-build-id",
			number: 22,
			stages: [
				{
					id: "x",
					name: "Test",
					state: "failed" as const,
					required: true,
					owner: "someone",
					detail: "Private error",
					durationSeconds: 5,
				},
			],
		})),
	};
	expect(await decisionFingerprint(state)).toBe(
		await decisionFingerprint(decisionState(later, config)),
	);
	expect(await decisionFingerprint(state)).not.toBe(
		await decisionFingerprint(
			decisionState({ ...snapshot, checksInvalidated: true }, config),
		),
	);
	expect(await decisionFingerprint(state)).not.toBe(
		await decisionFingerprint(
			decisionState(
				{
					...snapshot,
					policies: [
						{ ...policy, evidence: { ...policy.evidence, isExpired: false } },
					],
				},
				config,
			),
		),
	);
	const scoped = {
		...config,
		policyContext: {
			...config.policyContext,
			repositories: {
				[pull.repository.id]: [
					{ gateId: "build:42", description: "Repository-specific meaning" },
				],
			},
		},
	};
	expect(JSON.stringify(decisionState(snapshot, scoped))).toContain(
		"Repository-specific meaning",
	);
	expect(
		JSON.stringify(
			decisionState(snapshot, {
				...config,
				policyContext: { default: [], repositories: {} },
			}),
		),
	).not.toContain("Inspect expiry");
	expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});

test("shortcuts and repository-scoped policy context are independent of model judgments", () => {
	expect(
		readinessShortcut({ ...pull, targetBranch: "feature/new" }, true),
	).toBe("skipped");
	expect(
		readinessShortcut(
			{ ...pull, targetBranch: "main", mergeable: "conflicts" },
			true,
		),
	).toBe("conflict");
	expect(
		readinessShortcut(
			{ ...pull, targetBranch: "main", mergeable: "conflicts" },
			false,
		),
	).toBeNull();
	expect(readinessShortcut(undefined, true)).toBeNull();
	const config = {
		...project,
		policyContext: {
			default: [{ gateId: "default", description: "Default" }],
			repositories: { [pull.repository.id]: [] },
		},
	};
	expect(policyInstructions(config)).toHaveLength(1);
	expect(policyInstructions(config, pull.repository.id)).toEqual([]);
	expect(policyInstructions({ ...project, policyContext: undefined })).toEqual(
		[],
	);
	const evidence = decisionState(
		{
			...pull,
			policies: [
				{
					...policy,
					kind: "review",
					evidence: {
						status: "rejected",
						minimumApproverCount: 2,
						creatorVoteCounts: false,
					},
				},
			],
		},
		project,
	).evidence;
	expect(evidence.requirements.flatMap((r) => r.facts)).toContainEqual(
		expect.objectContaining({
			source: "policy",
			minimumApprovals: 2,
			authorVoteCounts: false,
		}),
	);
});
