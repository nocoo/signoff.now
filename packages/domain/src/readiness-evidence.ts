import { z } from "zod";
import { POLICY_CODES } from "./policy-codes.js";
import { checksValidity, interpretPull } from "./state-machine.js";
import {
	approvalCount,
	type Build,
	type Project,
	type PullRequest,
	type policyInstructionsSchema,
	projectMergeRequirements,
} from "./workbench.js";

const factSchema = z.object({
	source: z.enum(["policy", "build"]),
	state: z.string(),
	required: z.boolean(),
	enabled: z.boolean().nullable().optional(),
	applicable: z.boolean().nullable().optional(),
	isExpired: z.boolean().nullable().optional(),
	buildIsNotCurrent: z.boolean().nullable().optional(),
	commitMatch: z.enum(["unknown", "match", "mismatch"]).optional(),
	minimumApprovals: z.number().optional(),
	authorVoteCounts: z.boolean().nullable().optional(),
});
export const readinessEvidenceSchema = z.object({
	pr: z.object({
		lifecycle: z.enum(["open", "merged", "closed"]),
		draft: z.boolean(),
		mergeable: z.enum(["clear", "conflicts", "unknown"]),
	}),
	collection: z.object({
		coverage: z.enum(["complete", "partial"]),
		checksValidity: z.enum(["valid", "invalidated", "missing"]),
	}),
	reviews: z.object({
		approvals: z.number(),
		remaining: z.number(),
		changesRequested: z.boolean(),
		requiredReviewersPending: z.boolean(),
	}),
	requirements: z.array(
		z.object({
			code: z.string(),
			name: z.string(),
			kind: z.string(),
			instructions: z.string().optional(),
			facts: z.array(factSchema),
		}),
	),
});
export type ReadinessEvidence = z.infer<typeof readinessEvidenceSchema>;
function distinct<T>(values: T[]): T[] {
	return [
		...new Map(values.map((value) => [JSON.stringify(value), value])).entries(),
	]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => value);
}
function buildFact(
	build: Build,
	pull: PullRequest,
): z.infer<typeof factSchema> {
	const source = build.evidence?.sourceSha;
	return {
		source: "build",
		state: build.state,
		required: build.required,
		commitMatch:
			!source || (!pull.headSha && !pull.evidence?.mergeSha)
				? "unknown"
				: source === pull.headSha || source === pull.evidence?.mergeSha
					? "match"
					: "mismatch",
	};
}
export function policyInstructions(
	project: Project,
	repositoryId?: string,
): z.infer<typeof policyInstructionsSchema> {
	const context = project.policyContext;
	return (
		(repositoryId && context?.repositories[repositoryId]) ||
		context?.default ||
		[]
	);
}
export function policyCatalog(project: Project, pulls: PullRequest[] = []) {
	const all = pulls.map((p) => ({
		...p,
		builds: p.builds.map((build) => ({ ...build, required: true })),
		policies: p.policies.map((policy) => ({ ...policy, required: true })),
	}));
	return projectMergeRequirements(project, all);
}
export function readinessEvidence(
	snapshot: PullRequest,
	project: Project,
	codes: ReadonlyMap<string, string> = new Map(),
): ReadinessEvidence {
	const pull = interpretPull(snapshot);
	const instructions = policyInstructions(project, pull.repository.id);
	const gates = policyCatalog(project, [pull]).filter(
		(g) => g.kind !== "conflict",
	);
	const instruction = (gate: (typeof gates)[number]) =>
		instructions.find(
			(i) => i.gateId === gate.id || gate.sourceIds?.includes(i.gateId),
		);
	gates.sort((a, b) => {
		const first = instruction(a),
			second = instruction(b);
		return (
			(first ? instructions.indexOf(first) : instructions.length) -
				(second ? instructions.indexOf(second) : instructions.length) ||
			a.id.localeCompare(b.id)
		);
	});
	const requirements = gates.flatMap((gate) => {
		const policies = pull.policies.filter(
			(p) =>
				p.id === gate.id ||
				gate.sourceIds?.includes(p.id) ||
				Boolean(gate.definitionId && p.definitionId === gate.definitionId),
		);
		const builds = pull.builds.filter(
			(b) =>
				(gate.kind === "build" &&
					gate.definitionId &&
					b.definitionId === gate.definitionId) ||
				policies.some((p) => p.evidence?.buildId === b.id) ||
				(gate.kind === "build" && !gate.definitionId && b.name === gate.name),
		);
		if (!policies.length && !builds.length && gate.id !== "review-approvals")
			return [];
		const description = instruction(gate)?.description;
		return [
			{
				code: codes.get(gate.id) ?? POLICY_CODES[gate.name] ?? gate.name,
				name: gate.name,
				kind: gate.kind,
				...(description ? { instructions: description } : {}),
				facts: distinct([
					...policies.map((p) => ({
						source: "policy" as const,
						state: p.state,
						required: p.required,
						enabled: p.evidence?.isEnabled ?? null,
						applicable: p.evidence?.status
							? p.evidence.status.toLowerCase() !== "notapplicable"
							: null,
						isExpired: p.evidence?.isExpired ?? p.expired ?? null,
						buildIsNotCurrent: p.evidence?.buildIsNotCurrent ?? null,
						...(p.evidence?.minimumApproverCount !== undefined
							? {
									minimumApprovals: p.evidence.minimumApproverCount,
									authorVoteCounts: p.evidence.creatorVoteCounts ?? null,
								}
							: {}),
					})),
					...builds.map((b) => buildFact(b, pull)),
				]),
			},
		];
	});
	const approvals = approvalCount(pull);
	return {
		pr: { lifecycle: pull.state, draft: pull.draft, mergeable: pull.mergeable },
		collection: {
			coverage: pull.coverage,
			checksValidity: checksValidity(pull),
		},
		reviews: {
			approvals,
			remaining: Math.max(0, pull.requiredApprovals - approvals),
			changesRequested: pull.reviewers.some(
				(r) => r.vote === "changes_requested",
			),
			requiredReviewersPending: pull.reviewers.some(
				(r) => r.required && r.vote !== "approved",
			),
		},
		requirements,
	};
}
