import { readinessEvidence } from "./readiness-evidence.js";

export * from "./policy-codes.js";
export {
	policyCatalog,
	policyInstructions,
	readinessEvidence,
} from "./readiness-evidence.js";

import { COMMON_RULES, defaultProjectRules } from "./ai-rules.js";

export * from "./ai-rules.js";

import { z } from "zod";

import type { Project, PullRequest } from "./workbench.js";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_RUBRIC = "signoff-evidence-v8";
export const CLASSIFICATION = {
	attention:
		"Human inspection is needed now: a failed or explicitly expired build, requested code changes, or another actionable blocker. Missing reviews and PoP deferred until builds/reviews finish are not Attention. Do not decide rerun versus repair.",
	review_needed:
		"Builds passed and remain unexpired, with no more serious blocker; only project review requirements remain unsatisfied (minimum non-author approvals, required/path reviewers or review compliance). Includes awaiting reviewers already assigned and rejected review-compliance evaluations without explicit evidence of requested code changes. A rejected review policy is not a reviewer rejection. PoP follows review and does not block this category. Explicit requested code changes are Attention.",
	warning:
		"A known issue deserves observation and has evidence it may resolve automatically; no human action now.",
	running:
		"Automatic work is executing, or evidence is insufficient to identify an actionable blocker. Pending reviews and deferred PoP do not override a running build. Queued work is Waiting; review-only deficits after valid successful builds are Review Needed.",
	ready:
		"Builds succeeded and remain valid, PR is mergeable, all applicable policies passed; a configured PoP-only final-step exception may apply. Provider merge requirements remain authoritative.",
	waiting:
		"Waiting for non-review processes, such as a queued build or an automatic prerequisite, with no human intervention needed. Active execution is Running. Never use for external review, failed/expired builds needing intervention, or author changes.",
} as const;
export const aiKindSchema = z.enum([
	"skipped",
	"conflict",
	"attention",
	"review_needed",
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
	skipped: "Non-main target branch; Jev evaluation skipped.",
	conflict: "Resolve the merge conflict.",
	attention: "Human inspection is needed. Review the PR evidence.",
	review_needed: "Request or follow up on the required reviews.",
	warning: "Observe the issue for automatic recovery.",
	running: "Wait for ongoing work or more evidence.",
	ready:
		"Complete any final PoP step, then confirm provider requirements before merging.",
	waiting: "Wait for queued work or automatic prerequisites.",
	unknown: "Waiting for a current evaluation.",
	error: "Check AI Settings and retry the evaluation.",
} as const;
const probability = z.number().finite().min(0).max(1);
export const jevResultSchema = z.object({
	kind: z.enum([
		"attention",
		"review_needed",
		"warning",
		"running",
		"ready",
		"waiting",
	]),
	model: z.string(),
	rubric: z.string(),
	fingerprint: z.string(),
	evaluatedAt: z.iso.datetime(),
	reusedAt: z.iso.datetime().nullable().default(null),
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
	skipped: "Skipped",
	conflict: "Conflict",
	attention: "Attention",
	review_needed: "Review Needed",
	warning: "Warning",
	running: "Running",
	ready: "Ready",
	waiting: "Waiting",
	unknown: "Unknown",
	error: "Error",
} as const;
export function isMainTarget(pull: Pick<PullRequest, "targetBranch">): boolean {
	return /^(?:refs\/heads\/)?(?:main|master)$/.test(pull.targetBranch);
}
export function readinessShortcut(
	pull: Pick<PullRequest, "targetBranch" | "mergeable"> | undefined,
	active: boolean,
) {
	if (pull && !isMainTarget(pull)) return "skipped";
	if (active && pull?.mergeable === "conflicts") return "conflict";
	return null;
}
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
				: NEXT_ACTIONS[
						status !== "complete" && previous ? previous.kind : kind
					],
		error,
		current: status === "complete" ? result : null,
		previous: status === "complete" ? null : previous,
	};
}
export function readinessBadge(readiness: AiReadiness): AiReadiness {
	return ["pending", "running", "error"].includes(readiness.status) &&
		readiness.previous
		? presentReadiness("complete", readiness.previous)
		: readiness;
}
export function decisionState(
	snapshot: PullRequest,
	project: Project,
	rules = { common: COMMON_RULES, project: defaultProjectRules(project.id) },
	codes: ReadonlyMap<string, string> = new Map(),
) {
	return {
		rules,
		priority:
			"Policies are highest priority first. Consider all conclusions; priority is context, not an automatic override. Missing evidence is unknown. Do not assume auto-reruns or auto-merge.",
		evidence: readinessEvidence(snapshot, project, codes),
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
export const aiTickSchema = z
	.object({ source: z.enum(["cli", "demo"]) })
	.strict();
export const aiScheduleSchema = z.object({
	revision: z.number().int(),
	cooldownSeconds: aiCooldownSchema,
	pulls: z.array(
		z.object({ id: z.string(), nextEligibleAt: z.number().nullable() }),
	),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			lastStartedAt: z.number().nullable(),
			lastCompletedAt: z.number().nullable(),
			requestCount: z.number(),
			inputTokens: z.number().nullable(),
			outputTokens: z.number().nullable(),
		}),
	),
});
export type DecisionState = ReturnType<typeof decisionState>;
