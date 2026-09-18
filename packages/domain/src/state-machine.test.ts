import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "./demo";
import {
	defaultStateMachine,
	effectiveStateMachine,
	evaluatePull,
	interpretPull,
	providerCheckState,
} from "./state-machine";
import { type PullRequest, stateMachineSchema } from "./workbench";

const workspace = demoWorkspace(1_800_000_000);
const project = workspace.projects[0]!;
const pull: PullRequest = {
	...workspace.pullRequests[0]!,
	projectId: project.id,
	state: "open",
	draft: false,
	mergeable: "clear",
	coverage: "complete",
	policies: [],
	builds: [],
	reviewers: [],
	requiredApprovals: 0,
};

describe("replayable PR state machines", () => {
	test("saving the initial machine or editing state labels preserves automatic blocker priority", () => {
		const facts = workspace.pullRequests[0]!;
		const automatic = { ...project, readinessRules: [] };
		const before = evaluatePull(facts, automatic).readiness;
		const config = defaultStateMachine(automatic, [facts]);
		const saved = {
			...automatic,
			stateMachine: { default: config, repositories: {} },
		};
		expect(evaluatePull(facts, saved).readiness).toEqual(before);
		config.states.find((s) => s.id === before.kind)!.label = "Needs action";
		expect(evaluatePull(facts, saved).readiness).toMatchObject({
			kind: before.kind,
			gateId: before.gateId,
			label: "Needs action",
		});
		config.priority = "gate";
		expect(evaluatePull(facts, saved).readiness.kind).toBe("running");
		delete config.priority;
		expect(evaluatePull(facts, saved).readiness.kind).toBe("running");
		expect(
			defaultStateMachine({ ...automatic, readinessRules: [config.gates[0]!] })
				.priority,
		).toBe("gate");
	});
	test("independent gates remain concurrent while every typed condition is explainable", () => {
		const facts: PullRequest = {
			...pull,
			policies: [
				{
					id: "p",
					name: "CI",
					kind: "build",
					definitionId: "42",
					required: true,
					state: "passed",
					detail: "CI",
					owner: "CI",
					evidence: {
						status: "approved",
						isExpired: false,
						buildIsNotCurrent: true,
					},
				},
			],
		};
		const config = defaultStateMachine(project, [facts]);
		config.mappings.unshift({
			id: "currency",
			name: "Current accepted build",
			stateId: "approval",
			enabled: true,
			match: "all",
			conditions: [
				{ fact: "draft", equals: false },
				{ fact: "mergeable", oneOf: ["clear"] },
				{ fact: "coverage", oneOf: ["complete"] },
				{ fact: "checksValidity", oneOf: ["valid"] },
				{ fact: "gate", gateId: "build:42", oneOf: ["passed"] },
				{ fact: "buildExpired", gateId: "p", equals: false },
				{ fact: "buildNotCurrent", gateId: "build:42", equals: true },
			],
		});
		const configured = {
			...project,
			stateMachine: { default: config, repositories: {} },
		};
		expect(evaluatePull(facts, configured).readiness.kind).toBe("approval");
		expect(
			evaluatePull(facts, configured).requirements.find(
				(g) => g.id === "build:42",
			)?.state,
		).toBe("passed");
		config.mappings[0]!.conditions = [
			{ fact: "policyStatus", gateId: "missing", oneOf: ["approved"] },
		];
		expect(evaluatePull(facts, configured).trace[0]?.matched).toBe(false);
		config.mappings[0]!.enabled = false;
		expect(evaluatePull(facts, configured).readiness.kind).toBe("ready");
		config.mappings = [];
		expect(evaluatePull(facts, configured).readiness.stateId).toBe("ready");
	});
	test("raw reviewer eligibility and build attempts are interpreted in the domain", () => {
		const facts: PullRequest = {
			...pull,
			policies: [
				{
					id: "r",
					name: "Minimum reviewers",
					kind: "review",
					state: "passed",
					required: true,
					detail: "Review",
					owner: "Reviewers",
					evidence: {
						typeId: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
						status: "approved",
						isBlocking: true,
						minimumApproverCount: 2,
						creatorVoteCounts: false,
						allowDownvotes: true,
					},
				},
			],
			reviewers: [10, -10, 0].map((vote, index) => ({
				id: index ? String(index) : pull.author.id,
				name: `Reviewer ${index}`,
				required: false,
				vote: "pending",
				providerVote: vote,
			})),
			builds: [
				{
					id: "7",
					number: 7,
					name: "CI",
					state: "failed",
					required: true,
					evidence: { status: "completed", result: "succeeded" },
					stages: [
						{
							id: "stage",
							name: "CI",
							state: "failed",
							required: true,
							detail: "CI",
							owner: "CI",
							durationSeconds: null,
							evidence: {
								status: "completed",
								result: "succeeded",
								attempt: 2,
							},
						},
					],
				},
			],
		};
		const interpreted = interpretPull(facts);
		expect(interpreted.requiredApprovals).toBe(2);
		expect(interpreted.reviewers.map((r) => r.vote)).toEqual([
			"approved",
			"changes_requested",
			"pending",
		]);
		expect(interpreted.reviewers[0]?.countsTowardApproval).toBe(false);
		expect(evaluatePull(facts, project).readiness.kind).toBe("review");
		expect(interpreted.builds[0]?.stages[0]?.state).toBe("passed");
		facts.builds[0]!.stages[0]!.evidence = { status: "pending" };
		expect(interpretPull(facts).builds[0]?.stages[0]?.state).toBe("queued");
		facts.policies[0]!.id = "status-1";
		facts.policies[0]!.evidence = { status: "pending" };
		expect(interpretPull(facts).policies[0]?.state).toBe("running");
		expect(
			evaluatePull(
				{ ...pull, evidence: { status: "new-provider-state" } },
				project,
			).readiness.kind,
		).toBe("unknown");
	});
	test("provider vocabulary remains explicit, including unsupported values", () => {
		for (const [state, words] of Object.entries({
			passed: ["approved", "succeeded", "success"],
			failed: [
				"failed",
				"failure",
				"error",
				"rejected",
				"broken",
				"partiallySucceeded",
			],
			skipped: ["notApplicable", "skipped"],
			running: ["running", "inProgress", "cancelling"],
			queued: ["queued", "notStarted"],
			waiting: ["waiting", "pending"],
			canceled: ["canceled", "cancelled"],
			unknown: ["completed", ""],
		}))
			for (const word of words)
				expect(providerCheckState(word) === state).toBe(true);
		expect(providerCheckState(undefined)).toBe("unknown");
	});
	test("repository catalogs use policy scope and merge newly discovered gates without losing customization", () => {
		const config = defaultStateMachine(project);
		const scoped = {
			...project,
			stateMachine: { default: config, repositories: {} },
			mergeRequirements: [
				{
					id: "a",
					name: "Repo A",
					kind: "policy" as const,
					scope: [{ repositoryId: "a" }],
				},
				{
					id: "b",
					name: "Repo B",
					kind: "policy" as const,
					scope: [{ repositoryId: "b" }],
				},
			],
		};
		expect(
			effectiveStateMachine(scoped, "a").config.gates.some(
				(g) => g.label === "Repo B",
			),
		).toBe(false);
		expect(
			effectiveStateMachine(scoped, "a").config.gates.some(
				(g) => g.label === "Repo A",
			),
		).toBe(true);
	});
	test("project defaults, repo overrides and fallback share one deterministic evaluator", () => {
		const defaults = defaultStateMachine(project, [pull]);
		const repo = structuredClone(defaults);
		repo.states.find((state) => state.id === "ready")!.label = "Ship it";
		const configured = {
			...project,
			stateMachineRevision: 3,
			stateMachine: {
				default: defaults,
				repositories: { [pull.repository.id]: repo },
			},
		};
		expect(
			effectiveStateMachine(configured, pull.repository.id).inherited,
		).toBe(false);
		expect(evaluatePull(pull, configured).readiness).toMatchObject({
			kind: "ready",
			label: "Ship it",
			machineRevision: 3,
		});
		expect(
			evaluatePull(
				{ ...pull, repository: { ...pull.repository, id: "another" } },
				configured,
			).readiness.label,
		).toBe("Ready to merge");
		expect(evaluatePull(pull, project).readiness.kind).toBe("ready");
	});
	test("AND/OR mappings explain every match, preserve blockers and never modify evidence", () => {
		const facts = {
			...pull,
			policies: [
				{
					id: "p",
					name: "Compliance",
					kind: "policy" as const,
					state: "failed" as const,
					required: true,
					detail: "Fix compliance",
					owner: "Maintainers",
					evidence: { status: "rejected" },
				},
			],
		};
		const config = defaultStateMachine(project, [facts]);
		config.states.push({
			id: "compliance",
			label: "Compliance review",
			kind: "review",
			color: "orange",
			group: "Compliance",
		});
		config.mappings.unshift({
			id: "compliance-review",
			name: "Compliance needs review",
			stateId: "compliance",
			enabled: true,
			match: "all",
			conditions: [
				{ fact: "lifecycle", oneOf: ["open"] },
				{
					fact: "policyStatus",
					gateId: "policy:compliance",
					oneOf: ["rejected"],
				},
			],
		});
		const original = JSON.stringify(facts);
		const result = evaluatePull(facts, {
			...project,
			stateMachine: { default: config, repositories: {} },
		});
		expect(result.readiness).toMatchObject({
			stateId: "compliance",
			kind: "review",
			label: "Compliance review",
			matchedRuleId: "compliance-review",
		});
		expect(result.readiness.issues).toHaveLength(1);
		expect(result.trace[0]).toMatchObject({
			matched: true,
			selected: true,
			results: [true, true],
		});
		expect(JSON.stringify(facts)).toBe(original);
		config.mappings[0]!.match = "any";
		config.mappings[0]!.conditions[0] = {
			fact: "lifecycle",
			oneOf: ["closed"],
		};
		expect(
			evaluatePull(facts, {
				...project,
				stateMachine: { default: config, repositories: {} },
			}).readiness.stateId,
		).toBe("compliance");
	});
	test("custom mappings cannot manufacture readiness, terminal states or valid checks", () => {
		const config = defaultStateMachine(project, [pull]);
		config.mappings.unshift({
			id: "unsafe",
			name: "Always ready",
			stateId: "ready",
			enabled: true,
			match: "all",
			conditions: [{ fact: "lifecycle", oneOf: ["open", "merged", "closed"] }],
		});
		const configured = {
			...project,
			stateMachine: { default: config, repositories: {} },
		};
		for (const patch of [
			{ checksInvalidated: true },
			{ checksObservedAt: null },
			{ coverage: "partial" as const },
			{ mergeable: "unknown" as const },
			{ mergeable: "conflicts" as const },
			{ draft: true },
			{ state: "merged" as const },
			{ state: "closed" as const },
		]) {
			const evaluated = evaluatePull({ ...pull, ...patch }, configured);
			expect(evaluated.readiness.kind).not.toBe("ready");
			expect(evaluated.trace[0]?.guard).toBeTruthy();
		}
		config.mappings[0]!.stateId = "merged";
		expect(evaluatePull(pull, configured).readiness.kind).toBe("ready");
	});
	test("raw evidence can be replayed to correct stale interpretations, including target currency", () => {
		const facts = {
			...pull,
			policies: [
				{
					id: "p",
					name: "CI",
					kind: "build" as const,
					definitionId: "653",
					expired: true,
					state: "failed" as const,
					required: true,
					detail: "Old interpretation",
					owner: "CI",
					evidence: {
						status: "approved",
						isExpired: false,
						buildIsNotCurrent: true,
					},
				},
			],
		};
		expect(evaluatePull(facts, project).readiness.kind).toBe("ready");
		facts.policies[0]!.evidence.isExpired = true;
		expect(evaluatePull(facts, project).readiness.issues[0]?.reason).toBe(
			"build_expired",
		);
	});
	test("validates unique states and referenced mappings without executable conditions", () => {
		const config = defaultStateMachine(project, [pull]);
		expect(stateMachineSchema.safeParse(config).success).toBe(true);
		expect(
			stateMachineSchema.safeParse({
				...config,
				states: config.states.slice(1),
			}).success,
		).toBe(false);
		config.mappings[0]!.stateId = "missing";
		expect(stateMachineSchema.safeParse(config).success).toBe(false);
		expect(
			stateMachineSchema.safeParse({ ...config, script: "return true" })
				.success,
		).toBe(false);
		config.states.push(config.states[0]!);
		expect(stateMachineSchema.safeParse(config).success).toBe(false);
	});
});
