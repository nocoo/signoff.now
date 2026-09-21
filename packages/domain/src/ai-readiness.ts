import { POLICY_CODES } from "./policy-codes.js";

export * from "./policy-codes.js";

import { COMMON_RULES, defaultProjectRules } from "./ai-rules.js";

export * from "./ai-rules.js";

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
export const JEV_RUBRIC = "signoff-developer-v4";
export const CLASSIFICATION = {
	attention:
		"A person must inspect or act now. Build failure or explicit expiry needing intervention belongs here. Do not decide rerun versus repair.",
	warning:
		"A known issue deserves observation and has evidence it may resolve automatically; no human action now.",
	running:
		"Automatic work is progressing, or there is not enough signal to require action. Includes queued policies and ordinary waits other than external review.",
	ready:
		"Builds succeeded and remain valid, PR is mergeable, all applicable policies passed; a configured PoP-only final-step exception may apply. Provider merge requirements remain authoritative.",
	waiting:
		"Only waiting for external reviewers, after successful unexpired builds. Never author changes, queued builds or PoP.",
} as const;
export const aiKindSchema = z.enum([
	"conflict",
	"attention",
	"warning",
	"running",
	"ready",
	"waiting",
	"unknown",
	"error",
]);
export {
	type PolicyContext,
	policyContextSchema,
	policyInstructionSchema,
	policyInstructionsSchema,
} from "./workbench.js";
export const NEXT_ACTIONS = {
	conflict: "Resolve the merge conflict.",
	attention: "Human inspection is needed. Review the PR evidence.",
	warning: "Observe the issue for automatic recovery.",
	running: "Wait for ongoing work or more evidence.",
	ready:
		"Complete any final PoP step, then confirm provider requirements before merging.",
	waiting: "Wait for external reviewer input.",
	unknown: "Waiting for a current evaluation.",
	error: "Check AI Settings and retry the evaluation.",
} as const;
const probability = z.number().finite().min(0).max(1);
export const jevResultSchema = z.object({
	kind: z.enum(["attention", "warning", "running", "ready", "waiting"]),
	model: z.string(),
	rubric: z.string(),
	fingerprint: z.string(),
	evaluatedAt: z.iso.datetime(),
	observations: z
		.object({ summaryAt: z.number(), checksAt: z.number().nullable() })
		.optional(),
	probabilities: z.record(z.string(), probability),
	confidence: probability,
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
	conflict: "Conflict",
	attention: "Attention",
	warning: "Warning",
	running: "Running",
	ready: "Ready",
	waiting: "Waiting",
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
					? "Pending"
					: status === "running"
						? "Evaluating"
						: AI_LABELS[kind],
		nextAction:
			status === "not_watched"
				? "Watch this PR to request classification."
				: NEXT_ACTIONS[kind],
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
	rules = { common: COMMON_RULES, project: defaultProjectRules(project.id) },
) {
	const pull = interpretPull(snapshot);
	const instructions = policyInstructions(project, pull.repository.id);
	const gates = policyCatalog(project, [pull]);
	const scopes = [
		...new Map(
			[
				...gates.flatMap((g) => g.scope ?? []),
				...pull.policies.flatMap((p) => p.evidence?.scope ?? []),
			].map((scope) => [canonicalJson(scope), scope] as const),
		).entries(),
	]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, scope]) => scope);
	const scopeKeys = scopes.map(canonicalJson);
	const scopeRefs = (scope: typeof scopes | undefined) =>
		scope?.map((entry) => scopeKeys.indexOf(canonicalJson(entry)));
	const catalog = gates.map(({ detail, scope, ...gate }) => ({
		...gate,
		scopeRefs: scopeRefs(scope),
	}));
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
		rules,
		project: {
			id: project.id,
			name: project.name,
			repository: pull.repository,
		},
		priorityMeaning:
			"Highest priority first; consider all policies and conflicts. Order is not a blocker rule. Empty descriptions imply no business meaning.",
		scopeMeaning:
			"scopeRefs lists zero-based indices into scopes; omitted means uncollected, [] means explicitly empty.",
		scopes,
		stageRequiredMeaning:
			"All stage required flags derive from build policy and stage status, not provider guarantees.",
		policiesInPriorityOrder: ordered.map((i) => ({
			...i.gate,
			id: i.gateId,
			...(i.description ? { description: i.description } : {}),
			code: POLICY_CODES[i.gate?.name ?? ""] ?? i.gateId,
		})),
		pr: {
			id: pull.id,
			number: pull.number,
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
			.map(({ detail, owner, evidence, ...p }) => {
				const {
					scope,
					evaluationId,
					typeId,
					startedAt,
					completedAt,
					...facts
				} = evidence ?? {};
				return {
					...p,
					applicable: evidence?.status?.toLowerCase() !== "notapplicable",
					evidence: { ...facts, scopeRefs: scopeRefs(scope) },
				};
			})
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
				stages: b.stages.map(({ detail, owner, durationSeconds, ...s }) => s),
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

export const aiCooldownSchema = z.number().int().min(60).max(3600);
export const aiPresenceSchema = z
	.object({
		id: z.uuid(),
		sequence: z.number().int().nonnegative(),
		source: z.enum(["cli", "demo"]),
		visible: z.boolean(),
	})
	.strict();
export const aiTickSchema = aiPresenceSchema.omit({ visible: true });
export type AiTick = z.infer<typeof aiTickSchema>;
export const aiScheduleSchema = z.object({
	revision: z.number().int(),
	cooldownSeconds: aiCooldownSchema,
	foreground: z.boolean(),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			lastStartedAt: z.number().nullable(),
			lastCompletedAt: z.number().nullable(),
			nextEligibleAt: z.number().nullable(),
			lastBatchSize: z.number(),
			inputTokens: z.number().nullable(),
			outputTokens: z.number().nullable(),
		}),
	),
});
export type DecisionState = ReturnType<typeof decisionState>;
export function batchDecisionState(states: DecisionState[]) {
	const definitions: Record<string, { name: string; kind?: string }> = {};
	const policyFacts: unknown[] = [];
	const stageFacts: unknown[] = [],
		reviewerFacts: unknown[] = [];
	const reference = (facts: unknown[], fact: unknown) => {
		const key = canonicalJson(fact),
			index = facts.findIndex((item) => canonicalJson(item) === key);
		if (index >= 0) return index;
		facts.push(fact);
		return facts.length - 1;
	};
	const policyFactIds = new Map<string, number>();
	const internPolicy = (fact: unknown) => {
		const key = canonicalJson(fact);
		let ref = policyFactIds.get(key);
		if (ref === undefined) {
			ref = policyFacts.length;
			policyFactIds.set(key, ref);
			policyFacts.push(fact);
		}
		return ref;
	};
	const scopes: DecisionState["scopes"] = [];
	const ruleSets: DecisionState["rules"][] = [];
	const instructionFacts: Omit<
		DecisionState["policiesInPriorityOrder"][number],
		"id" | "name" | "sourceIds"
	>[] = [];
	const contexts: {
		project: DecisionState["project"];
		ruleRef: number;
		policiesInPriorityOrder: number[];
	}[] = [];
	const ids = new Map<string, number>();
	const prs = states.map((state) => {
		const {
			pr,
			collection,
			reviews,
			policies,
			builds,
			policiesInPriorityOrder,
			...common
		} = state;
		const gates = policiesInPriorityOrder.filter(
			(g) => g.id !== "merge-conflicts",
		);
		for (const gate of gates)
			definitions[gate.code] ??= {
				name: gate.name ?? gate.id,
				kind: gate.kind,
			};
		const codeFor = (p: (typeof policies)[number]) =>
			gates.find(
				(g) =>
					g.sourceIds?.includes(p.id) ||
					g.id === p.id ||
					(p.definitionId && g.definitionId === p.definitionId) ||
					g.name === p.name,
			)?.code ?? p.id;

		const scopeRefs = (refs: number[] | undefined) =>
			refs?.map((ref) => reference(scopes, state.scopes[ref]));
		const context = {
			project: common.project,
			ruleRef: reference(ruleSets, common.rules),
			policiesInPriorityOrder: gates.map(
				({ id, name, code, sourceIds, ...gate }) =>
					reference(instructionFacts, {
						...gate,
						code,
						scopeRefs: scopeRefs(gate.scopeRefs),
					}),
			),
		};
		const key = canonicalJson(context);
		let contextRef = ids.get(key);
		if (contextRef === undefined) {
			contextRef = contexts.length;
			ids.set(key, contextRef);
			contexts.push(context);
		}
		return {
			contextRef,
			pr,
			collection,
			reviews: {
				...reviews,
				reviewers: reviews.reviewers.map((reviewer) =>
					reference(reviewerFacts, reviewer),
				),
			},
			policyStates: Object.fromEntries(
				[...new Set(policies.map((p) => p.state))]
					.sort()
					.map((status) => [
						status,
						[
							...new Set(
								policies.filter((p) => p.state === status).map(codeFor),
							),
						],
					]),
			),
			policies: policies.map(({ name, id, ...p }) =>
				internPolicy({
					...p,
					code: codeFor({ ...p, id, name }),
					evidence: {
						...p.evidence,
						scopeRefs: scopeRefs(p.evidence.scopeRefs),
					},
				}),
			),
			builds: builds.map(({ name, policyIds, stages, ...b }) => ({
				...b,
				stages: stages.map(({ id, evidence, ...stage }) => {
					const { startedAt, completedAt, ...facts } = evidence ?? {};
					return reference(stageFacts, { ...stage, evidence: facts });
				}),
				...(policyIds.length ? {} : { name }),
				policies: policyIds.map((id) => {
					const p = policies.find((item) => item.id === id);
					return p ? codeFor(p) : id;
				}),
			})),
		};
	});
	return {
		definitions,
		policyFacts,
		stageFacts,
		reviewerFacts,
		scopes,
		ruleSets,
		policyInstructions: instructionFacts,
		contextMeaning:
			"Each PR uses contexts[contextRef]; ruleRef indexes ruleSets and policiesInPriorityOrder indexes policyInstructions (highest first, not a blocker rule). Policy codes reference definitions once; policyStates groups outcomes only, policies lists indices into policyFacts, retaining each underlying evaluation and scope. Duplicate references remain separate evaluations. Build stages index stageFacts; reviewers index reviewerFacts. Event IDs/times are provenance, not decision signals; expiry/freshness/attempts remain explicit. scopeRefs index shared scopes; missing means uncollected, [] explicitly empty. Stage required flags are derived, not provider guarantees. Judge only the named PR.",
		contexts,
		prs,
	};
}
