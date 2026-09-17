import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "./demo.js";
import {
	type Policy,
	type Project,
	type PullRequest,
	projectMergeRequirements,
	projectReadinessRules,
	pullReadiness,
	readinessColor,
	readinessPriority,
	readinessRulesSchema,
} from "./workbench.js";

const workspace = demoWorkspace(1_789_632_000);
const project = workspace.projects[0]!;
const ready: PullRequest = {
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
const review: Policy = {
	id: "policy-1",
	name: "Minimum number of reviewers",
	kind: "review",
	state: "queued",
	required: true,
	detail: "One more eligible reviewer must approve.",
	owner: "Reviewers",
};
const ci: Policy = {
	...review,
	id: "policy-2",
	name: "PR validation",
	kind: "build",
	definitionId: "pipeline-1",
	state: "running",
	detail: "Wait for PR validation to finish.",
};
const presence: Policy = {
	...review,
	id: "policy-3",
	name: "Proof Of Presence",
	kind: "policy",
	detail: "Complete the presence check.",
};
const configured: Project = {
	...project,
	mergeRequirements: [review, ci, presence].map(({ id, name, kind }) => ({
		id,
		name,
		kind: kind!,
	})),
	readinessRules: [
		{ gateId: ci.id, label: "CI", color: "blue" },
		{ gateId: review.id, label: "Review", color: "orange" },
		{ gateId: presence.id, label: "PoP", color: "yellow" },
	],
};

const REVIEW_ID = "review:minimum number of reviewers";
const CI_ID = "build:pipeline-1";
const POP_ID = "policy:proof of presence";

describe("actual project merge requirements", () => {
	test("groups same-named source policies, preserves saved preferences, and requires every member to pass", () => {
		const policies: Policy[] = [
			{ ...review, state: "passed" },
			{ ...review, id: "policy-4", state: "passed" },
			{ ...review, id: "policy-5", state: "queued" },
			{
				...review,
				id: "policy-6",
				name: "Minimum  number of reviewers",
				state: "passed",
			},
		];
		const catalog = {
			...project,
			mergeRequirements: policies.map((policy) => ({
				...policy,
				kind: "review" as const,
			})),
		};
		const pull = { ...ready, policies };
		const gates = projectMergeRequirements(catalog, [
			pull,
			{ ...ready, id: "uncollected", requiredApprovals: 2 },
		]);
		const reviews = gates.filter((gate) => gate.kind === "review");
		expect(reviews).toHaveLength(1);
		expect(reviews[0]).toMatchObject({
			id: "review:minimum number of reviewers",
			sourceIds: ["policy-1", "policy-4", "policy-5", "policy-6"],
		});
		const saved: Project = {
			...catalog,
			readinessRules: [
				{ gateId: "policy-5", label: "Review", color: "orange" },
				{ gateId: "policy-1", label: "Duplicate", color: "red" },
			],
		};
		expect(
			projectReadinessRules(saved, [pull]).filter((rule) =>
				rule.gateId.startsWith("review:"),
			),
		).toEqual([
			{
				gateId: "review:minimum number of reviewers",
				label: "Review",
				color: "orange",
			},
		]);
		expect(pullReadiness(pull, saved)).toMatchObject({
			kind: "review",
			label: "Review",
			gateId: reviews[0]!.id,
		});
		expect(pullReadiness(pull, saved).issues).toHaveLength(1);
		expect(
			pullReadiness(
				{
					...pull,
					policies: policies.map((policy) => ({ ...policy, state: "passed" })),
				},
				saved,
			).kind,
		).toBe("ready");
		expect(
			pullReadiness({ ...ready, requiredApprovals: 2 }, saved).gateId,
		).toBe(reviews[0]!.id);
	});
	test("keeps different pipeline definitions separate even when their names match", () => {
		const gates = projectMergeRequirements(project, [
			{
				...ready,
				policies: [ci, { ...ci, id: "other-ci", definitionId: "pipeline-2" }],
			},
		]);
		expect(
			gates.filter((gate) => gate.kind === "build").map((gate) => gate.id),
		).toEqual(["build:pipeline-1", "build:pipeline-2"]);
	});
	test("discovers passed and pending required policies grouped across source configurations", () => {
		const other = {
			...ready,
			projectId: "other",
			policies: [{ ...ci, id: "other" }],
		};
		const pull = {
			...ready,
			policies: [
				review,
				{ ...review, id: "policy-4", state: "passed" as const },
				{ ...ci, required: false },
				presence,
			],
		};
		const gates = projectMergeRequirements(project, [pull, pull, other]);
		expect(
			gates
				.filter((gate) => gate.kind !== "conflict")
				.map((gate) => gate.id)
				.sort((a, b) => a.localeCompare(b)),
		).toEqual([POP_ID, REVIEW_ID]);
		expect(
			projectReadinessRules(project, [pull]).every(
				(rule) => "gateId" in rule && !("kind" in rule),
			),
		).toBe(true);
	});
	test("uses pipeline definitions across runs and does not duplicate policy-backed CI", () => {
		const build = {
			id: "run-1",
			name: "CI",
			number: 1,
			definitionId: "pipeline-1",
			state: "running" as const,
			required: true,
			stages: [],
		};
		const pulls = [
			{ ...ready, policies: [ci], builds: [build] },
			{ ...ready, builds: [{ ...build, id: "run-2", number: 2 }] },
		];
		expect(
			projectMergeRequirements(project, pulls)
				.filter((gate) => gate.kind === "build")
				.map((gate) => gate.id),
		).toEqual([CI_ID]);
		expect(
			projectMergeRequirements(
				project,
				pulls.map((pull) => ({ ...pull, policies: [] })),
			).filter((gate) => gate.kind === "build"),
		).toHaveLength(1);
	});
	test("keeps configured labels/colors and includes new requirements before final steps", () => {
		const pull = {
			...ready,
			policies: [
				review,
				ci,
				presence,
				{ ...presence, id: "new", name: "New requirement" },
			],
		};
		const rules = projectReadinessRules(configured, [pull]);
		expect(rules.find((rule) => rule.gateId === POP_ID)).toEqual({
			...configured.readinessRules![2]!,
			gateId: POP_ID,
		});
		expect(
			rules.findIndex((rule) => rule.gateId === "policy:new requirement"),
		).toBeLessThan(rules.findIndex((rule) => rule.gateId === POP_ID));
	});
	test("first unmet requirement determines the next action; later remaining requirements sort closer to ready", () => {
		const pull = { ...ready, policies: [presence, review, ci] };
		const before = structuredClone(pull);
		const first = pullReadiness(pull, configured);
		expect(first).toMatchObject({
			gateId: CI_ID,
			label: "CI",
			kind: "running",
		});
		expect(readinessColor(first, configured)).toBe("blue");
		const afterCi = pullReadiness(
			{ ...pull, policies: [presence, review, { ...ci, state: "passed" }] },
			configured,
		);
		expect(afterCi).toMatchObject({
			gateId: REVIEW_ID,
			label: "Review",
			kind: "review",
		});
		const finalGate = pullReadiness(
			{
				...pull,
				policies: [
					presence,
					{ ...review, state: "passed" },
					{ ...ci, state: "passed" },
				],
			},
			configured,
		);
		expect(finalGate).toMatchObject({ gateId: POP_ID, label: "PoP" });
		expect(readinessColor(finalGate, configured)).toBe("yellow");
		expect(readinessPriority(finalGate, configured)).toBeLessThan(
			readinessPriority(afterCi, configured),
		);
		expect(readinessPriority(afterCi, configured)).toBeLessThan(
			readinessPriority(first, configured),
		);
		expect(
			readinessPriority(pullReadiness(ready, configured), configured),
		).toBe(0);
		expect(pull).toEqual(before);
		expect(
			pullReadiness(pull, {
				...configured,
				readinessRules: [...configured.readinessRules!].reverse(),
			}).gateId,
		).toBe(POP_ID);
	});
	test("queued, rejected, or running reviewer policies require review, without duplicate count gates", () => {
		for (const state of ["queued", "failed", "running", "waiting"] as const) {
			const result = pullReadiness(
				{
					...ready,
					policies: [{ ...review, state }],
					requiredApprovals: 2,
					reviewers: [
						{
							id: "author",
							name: "Author",
							vote: "approved",
							required: false,
							countsTowardApproval: false,
						},
						{
							id: "group",
							name: "Review group",
							vote: "approved",
							required: true,
							isGroup: true,
						},
						{
							id: "reviewer",
							name: "Reviewer",
							vote: "approved",
							required: false,
						},
					],
				},
				project,
			);
			expect(result).toMatchObject({ kind: "review", gateId: REVIEW_ID });
			expect(
				result.issues.filter((issue) => issue.kind === "review"),
			).toHaveLength(1);
		}
	});
	test("a failed stage and its running pipeline share the CI requirement and show the failure", () => {
		const result = pullReadiness(
			{
				...ready,
				policies: [ci, presence],
				builds: [
					{
						id: "run",
						name: "CI",
						number: 1,
						definitionId: "pipeline-1",
						required: true,
						state: "running",
						stages: [
							{
								...review,
								id: "tests",
								name: "Tests",
								state: "failed",
								detail: "Fix the failed tests",
								durationSeconds: 20,
							},
						],
					},
				],
			},
			configured,
		);
		expect(result).toMatchObject({
			kind: "blocked",
			gateId: CI_ID,
			action: "Fix the failed tests",
		});
		expect(
			result.issues.filter((issue) => issue.gateId === CI_ID),
		).toHaveLength(1);
	});
	test("does not create advisory blockers, hide missing data, or override lifecycle facts", () => {
		expect(
			pullReadiness(
				{ ...ready, policies: [{ ...presence, required: false }] },
				configured,
			).kind,
		).toBe("ready");
		expect(
			pullReadiness({ ...ready, checksObservedAt: null }, configured).kind,
		).toBe("unknown");
		expect(
			pullReadiness({ ...ready, mergeable: "conflicts" }, configured).kind,
		).toBe("blocked");
		for (const state of ["merged", "closed"] as const)
			expect(
				pullReadiness({ ...ready, state, policies: [presence] }, configured)
					.kind,
			).toBe(state);
		expect(
			pullReadiness({ ...ready, draft: true, policies: [presence] }, configured)
				.kind,
		).toBe("draft");
		expect(
			readinessColor(
				pullReadiness({ ...ready, policies: [presence] }, project),
				project,
			),
		).not.toBe("yellow");
	});
	test("accepts requirement IDs and rejects duplicate IDs, unsafe colors, and generic states", () => {
		expect(readinessRulesSchema.parse(configured.readinessRules)).toEqual(
			configured.readinessRules!,
		);
		expect(readinessRulesSchema.parse([])).toEqual([]);
		for (const rules of [
			[{ kind: "ready", color: "green" }],
			[configured.readinessRules![0], configured.readinessRules![0]],
			[{ gateId: "", label: "CI", color: "blue" }],
			[{ gateId: "ci", label: "", color: "blue" }],
			[{ gateId: "ci", label: "CI", color: "url(javascript:evil)" }],
		])
			expect(readinessRulesSchema.safeParse(rules).success).toBe(false);
	});
});
