import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "./demo.js";
import {
	DEFAULT_READINESS_RULES,
	type Project,
	type PullRequest,
	projectReadinessRules,
	pullProgress,
	pullReadiness,
	readinessColor,
	readinessPriority,
	readinessRulesSchema,
} from "./workbench.js";

const workspace = demoWorkspace(1_789_632_000);
const project = workspace.projects[0]!;
const ready = workspace.pullRequests.find(
	(pull) =>
		pull.projectId === project.id &&
		pullReadiness(pull, project).kind === "ready",
)!;
const policy = {
	id: "gate",
	name: "Proof Of Presence",
	state: "failed" as const,
	required: true,
	detail: "Complete the provider check",
	owner: "Maya Chen",
};
const configured: Project = {
	...project,
	readinessRules: [
		DEFAULT_READINESS_RULES[0]!,
		{ policy: policy.name, label: "Presence check", color: "yellow" },
		...DEFAULT_READINESS_RULES.slice(1),
	],
};

describe("project readiness rules", () => {
	test("respects configured priority when a single build has multiple unresolved stage states", () => {
		const build = ready.builds[0]!;
		const pull = {
			...ready,
			builds: [
				{
					...build,
					state: "failed" as const,
					stages: [
						{
							...build.stages[0]!,
							id: "failure",
							state: "failed" as const,
							required: true,
						},
						{
							...build.stages[0]!,
							id: "approval",
							state: "waiting" as const,
							required: true,
						},
					],
				},
			],
		};
		expect(pullReadiness(pull, project).kind).toBe("blocked");
		const approvalLast = {
			...project,
			readinessRules: [
				...DEFAULT_READINESS_RULES.filter(
					(rule) => !("kind" in rule && rule.kind === "approval"),
				),
				{ kind: "approval" as const, color: "yellow" as const },
			],
		};
		expect(pullReadiness(pull, approvalLast).kind).toBe("approval");
		expect(
			pullReadiness(pull, approvalLast).issues.map((issue) => issue.kind),
		).toEqual(["approval", "blocked"]);
	});
	test("defaults to most ready first without any policy name exceptions", () => {
		expect(projectReadinessRules(project)).toEqual(DEFAULT_READINESS_RULES);
		expect(projectReadinessRules({ ...project, readinessRules: [] })).toEqual(
			DEFAULT_READINESS_RULES,
		);
		expect(DEFAULT_READINESS_RULES[0]).toMatchObject({
			kind: "ready",
			color: "green",
		});
		for (const [state, kind] of [
			["failed", "blocked"],
			["queued", "running"],
			["waiting", "approval"],
			["unknown", "unknown"],
			["passed", "ready"],
		] as const) {
			const result = pullReadiness(
				{ ...ready, policies: [{ ...policy, state }] },
				project,
			);
			expect(result.kind).toBe(kind);
			expect(result.label).not.toBe("PoP");
		}
	});

	test("applies explicit policy order, label, and color only in the owning project", () => {
		const pull = { ...ready, policies: [policy] };
		const before = structuredClone(pull);
		const result = pullReadiness(pull, configured);
		expect(result).toMatchObject({
			kind: "blocked",
			label: "Presence check",
			action: policy.detail,
			policy: policy.name,
		});
		expect(readinessColor(result, configured)).toBe("yellow");
		expect(readinessPriority(result, configured)).toBe(1);
		expect(pullReadiness(pull, project).label).toBe("Policy failed");
		expect(readinessColor(pullReadiness(pull, project), project)).toBe("red");
		expect(pull).toEqual(before);
		expect(pullProgress(pull).checksPassed).toBeLessThan(
			pullProgress(pull).checksTotal,
		);
	});

	test("shows the least ready unresolved issue before a near-ready policy", () => {
		const extras: Partial<PullRequest>[] = [
			{ mergeable: "conflicts" },
			{ builds: [{ ...ready.builds[0]!, state: "running" }] },
			{ builds: [{ ...ready.builds[0]!, state: "waiting" }] },
			{
				policies: [
					policy,
					{ ...policy, id: "ci", name: "CI", state: "unknown" },
				],
			},
			{ requiredApprovals: ready.reviewers.length + 1 },
			{ checksObservedAt: null },
		];
		for (const extra of extras) {
			const result = pullReadiness(
				{ ...ready, policies: [policy], ...extra },
				configured,
			);
			expect(result.label).not.toBe("Presence check");
			expect(result.issues.at(-1)?.label).toBe("Presence check");
		}
		const reversed = {
			...configured,
			readinessRules: [...configured.readinessRules!].reverse(),
		};
		expect(
			pullReadiness(
				{ ...ready, policies: [policy], mergeable: "conflicts" },
				reversed,
			).label,
		).toBe("Presence check");
	});

	test("matches complete policy names consistently across providers, ignoring case and whitespace", () => {
		for (const provider of ["ado", "github"] as const) {
			const result = pullReadiness(
				{ ...ready, policies: [{ ...policy, name: " proof of presence " }] },
				{ ...configured, provider },
			);
			expect(result.label).toBe("Presence check");
			expect(readinessColor(result, configured)).toBe("yellow");
		}
		expect(
			pullReadiness(
				{ ...ready, policies: [{ ...policy, name: "Proof Of Presence CI" }] },
				configured,
			).label,
		).toBe("Policy failed");
	});

	test("does not create issues for passed/advisory policies or override terminal and draft facts", () => {
		for (const override of [
			{ state: "passed" as const },
			{ required: false },
		]) {
			expect(
				pullReadiness(
					{ ...ready, policies: [{ ...policy, ...override }] },
					configured,
				).kind,
			).toBe("ready");
		}
		for (const state of ["merged", "closed"] as const) {
			expect(
				pullReadiness({ ...ready, state, policies: [policy] }, configured).kind,
			).toBe(state);
		}
		expect(
			pullReadiness({ ...ready, draft: true, policies: [policy] }, configured)
				.kind,
		).toBe("draft");
	});

	test("accepts complete reordered rules and a reset, rejects incomplete or ambiguous configuration", () => {
		expect(readinessRulesSchema.parse(configured.readinessRules)).toEqual(
			configured.readinessRules!,
		);
		expect(readinessRulesSchema.parse([])).toEqual([]);
		for (const invalid of [
			DEFAULT_READINESS_RULES.slice(1),
			[...DEFAULT_READINESS_RULES, DEFAULT_READINESS_RULES[0]],
			[
				...configured.readinessRules!,
				{ policy: " proof of presence ", label: "Duplicate", color: "red" },
			],
			[
				...DEFAULT_READINESS_RULES,
				{ policy: " ", label: "Empty", color: "red" },
			],
			[...DEFAULT_READINESS_RULES, { policy: "CI", label: " ", color: "red" }],
			DEFAULT_READINESS_RULES.map((rule) => ({
				...rule,
				color: "url(javascript:evil)",
			})),
			[
				...DEFAULT_READINESS_RULES,
				{ kind: "ready", policy: "CI", label: "Ambiguous", color: "red" },
			],
		])
			expect(readinessRulesSchema.safeParse(invalid).success).toBe(false);
	});
});
