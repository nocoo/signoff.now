import { z } from "zod";
import { checksValidity, interpretPull } from "./state-machine.js";
import {
	approvalCount,
	type Project,
	type PullRequest,
	type policyInstructionsSchema,
	projectMergeRequirements,
} from "./workbench.js";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_RUBRIC = "signoff-intervention-v1";
export const aiKindSchema = z.enum([
	"on_track",
	"attention",
	"unknown",
	"error",
]);
export {
	type PolicyContext,
	policyContextSchema,
	policyInstructionSchema,
	policyInstructionsSchema,
} from "./workbench.js";
export const ACTIONS = {
	resolve_conflict: "Resolve the merge conflict.",
	fix_build: "Investigate and fix the failing build or stage.",
	rerun: "Initiate the required build or stage rerun.",
	review: "Address the requested review or obtain reviewer input.",
	approve: "Provide the required approval.",
	merge:
		"Review the provider requirements and complete the merge when appropriate.",
	follow_instructions:
		"Perform the action described in the project's policy instructions.",
	investigate:
		"Inspect the conflicting or incomplete policy evidence before acting.",
} as const;
export const actionSchema = z.enum(
	Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...(keyof typeof ACTIONS)[]],
);
const probability = z.number().finite().min(0).max(1);
export const jevResultSchema = z.object({
	kind: z.enum(["on_track", "attention", "unknown"]),
	action: actionSchema.nullable(),
	model: z.string(),
	rubric: z.string(),
	fingerprint: z.string(),
	evaluatedAt: z.iso.datetime(),
	observations: z
		.object({ summaryAt: z.number(), checksAt: z.number().nullable() })
		.optional(),
	probabilities: z.record(z.string(), probability),
	confidence: probability,
	actionProbabilities: z.record(z.string(), probability).nullable(),
	actionConfidence: probability.nullable(),
});
export const aiReadinessSchema = z.object({
	kind: aiKindSchema,
	label: z.string(),
	status: z.enum(["not_watched", "pending", "running", "complete", "error"]),
	nextAction: z.string(),
	error: z.string().nullable(),
	current: jevResultSchema.nullable(),
	previous: jevResultSchema.nullable(),
});
export type AiReadiness = z.infer<typeof aiReadinessSchema>;
export const aiSettingsSchema = z.object({
	configured: z.boolean(),
	storageReady: z.boolean(),
	revision: z.number(),
	testedAt: z.iso.datetime().nullable(),
	testState: z.enum(["untested", "valid", "error"]),
	testError: z.string().nullable(),
	model: z.string(),
	rubric: z.string(),
});
export const AI_LABELS = {
	on_track: "On Track",
	attention: "Attention",
	unknown: "Unknown",
	error: "Error",
} as const;
export function presentReadiness(
	status: AiReadiness["status"],
	result: z.infer<typeof jevResultSchema> | null = null,
	error: string | null = null,
	previous: z.infer<typeof jevResultSchema> | null = null,
): AiReadiness {
	const kind =
		status === "complete" && result
			? result.kind
			: status === "error"
				? "error"
				: "unknown";
	return {
		kind,
		status,
		label:
			status === "not_watched"
				? "Not evaluated"
				: status === "pending"
					? "Unknown · Pending"
					: status === "running"
						? "Unknown · Evaluating"
						: AI_LABELS[kind],
		nextAction:
			status === "not_watched"
				? "Watch this PR to request Jev classification."
				: status === "error"
					? "Check AI Settings and retry the evaluation."
					: status === "pending" || status === "running"
						? "Waiting for Jev to evaluate the current facts."
						: kind === "attention" && result?.action
							? ACTIONS[result.action]
							: kind === "on_track"
								? "No human action currently indicated. This is not permission to merge."
								: "Inspect the available evidence; Jev could not determine a useful next action.",
		error,
		current: status === "complete" ? result : null,
		previous: status === "complete" ? null : previous,
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
		policies: p.policies.map((policy) => ({ ...policy, required: true })),
	}));
	return projectMergeRequirements(project, all);
}
export function decisionState(
	snapshot: PullRequest,
	project: Project,
	now: number,
	cooldown = 300,
) {
	const pull = interpretPull(snapshot);
	const instructions = policyInstructions(project, pull.repository.id);
	const catalog = policyCatalog(project, [pull]).map(
		({ detail, ...gate }) => gate,
	);
	const ordered = [
		...instructions.map((i) => ({
			...i,
			gate:
				catalog.find(
					(g) => g.id === i.gateId || g.sourceIds?.includes(i.gateId),
				) ?? null,
		})),
		...catalog
			.filter(
				(g) =>
					!instructions.some(
						(i) => i.gateId === g.id || g.sourceIds?.includes(i.gateId),
					),
			)
			.map((g) => ({ gateId: g.id, description: "", gate: g })),
	];
	const { policies, builds, reviewers } = pull;
	const summaryAt = pull.summaryObservedAt ?? pull.observedAt;
	const checksAt =
		pull.checksObservedAt === undefined
			? pull.observedAt
			: pull.checksObservedAt;
	const staleAfter = Math.max(1200, cooldown * 3);
	return {
		version: JEV_RUBRIC,
		project: {
			id: project.id,
			name: project.name,
			repository: pull.repository,
		},
		priorityMeaning:
			"Policies are ordered by the user's priority, highest first. Consider every policy and conflicting evidence; ordering does not automatically select a blocker. Empty explanations do not establish business meaning.",
		policiesInPriorityOrder: ordered.map((i, index) => ({
			priority: index + 1,
			id: i.gateId,
			description: i.description,
			policy: i.gate,
		})),
		pr: {
			id: pull.id,
			number: pull.number,
			title: pull.title,
			description: pull.description,
			lifecycle: pull.state,
			draft: pull.draft,
			mergeable: pull.mergeable,
			provider: pull.evidence ?? null,
			headSha: pull.headSha ?? null,
			targetSha: pull.targetSha ?? null,
			sourceBranch: pull.sourceBranch,
			targetBranch: pull.targetBranch,
			autoComplete: "not collected; do not assume enabled",
		},
		collection: {
			coverage: pull.coverage,
			missing: [...(pull.collectionIssues ?? [])].sort(),
			checksValidity: checksValidity(pull),
			summaryStale: now - summaryAt > staleAfter,
			checksStale: checksAt === null || now - checksAt > staleAfter,
			staleAfterSeconds: staleAfter,
			targetIdentityMeaning:
				"ADO targetSha is lastMergeTargetCommit, not a fresh target ref lookup.",
		},
		reviews: {
			requiredApprovals: pull.requiredApprovals,
			approvalCount: approvalCount(pull),
			remainingApprovals: Math.max(
				0,
				pull.requiredApprovals - approvalCount(pull),
			),
			authorCountsTowardApproval: pull.authorCountsTowardApproval ?? null,
			allowDownvotes: pull.allowDownvotes ?? null,
			reviewers: reviewers
				.map(({ avatarUrl, handle, ...r }) => r)
				.sort((a, b) => a.id.localeCompare(b.id)),
		},
		policies: policies
			.map(({ detail, owner, ...p }) => ({
				...p,
				applicable: p.evidence?.status?.toLowerCase() !== "notapplicable",
				providerDescription: p.evidence?.description ?? null,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
		builds: builds
			.map((b) => ({
				...b,
				headMatchesSource:
					b.evidence?.sourceSha && pull.headSha
						? b.evidence.sourceSha === pull.headSha
						: null,
				mergeMatchesSource:
					b.evidence?.sourceSha && pull.evidence?.mergeSha
						? b.evidence.sourceSha === pull.evidence.mergeSha
						: null,
				policyIds: policies
					.filter(
						(p) =>
							p.evidence?.buildId === b.id ||
							(p.definitionId && p.definitionId === b.definitionId),
					)
					.map((p) => p.id)
					.sort(),
				stages: b.stages.map(({ detail, owner, durationSeconds, ...s }) => ({
					...s,
					requiredProvenance:
						"Derived by collector from build policy and stage status; not a provider guarantee",
					providerDescription: s.evidence?.description ?? null,
				})),
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
}
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export async function decisionFingerprint(state: unknown) {
	const data = new TextEncoder().encode(
		canonicalJson({ model: JEV_MODEL, rubric: JEV_RUBRIC, state }),
	);
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");
}
