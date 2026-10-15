import { AI_LABELS, type AiReadiness, readinessBadge } from "./ai-readiness.js";
import type { Inspection } from "./inspection.js";
import { POLICY_CODES } from "./policy-codes.js";
import type { PullQueryItem } from "./query.js";
import { interpretPull } from "./state-machine.js";
import {
	approvalCount,
	type CheckState,
	type PullRequest,
} from "./workbench.js";

type PolicyFact = {
	name: string;
	kind: string | null;
	code: string | null;
	state: CheckState;
	required: boolean | null;
	enabled: boolean | null;
	applicable: boolean | null;
	expired: boolean | null;
	minimumApprovals: number | null;
	authorVoteCounts: boolean | null;
};
type Execution = {
	name: string;
	state: CheckState;
	providerResult: string | null;
};
type SummaryInput = {
	readiness: {
		kind: AiReadiness["kind"];
		label: string;
		nextAction: string | null;
		isCurrent: boolean;
	};
	policies: PolicyFact[];
	builds: (Execution & { required: boolean; stages: Execution[] })[];
	approvals: {
		approved: number | null;
		required: number | null;
		remaining: number | null;
		requiredReviewersPending: boolean | null;
	};
	mergeable: "clear" | "conflicts" | "unknown";
	lifecycle: "open" | "merged" | "closed" | "draft" | null;
	updatedAt: string | null;
	checksValidity: "valid" | "invalidated" | "missing";
};
type Group = "attention" | "running" | "waiting" | "review" | "pop";
const groups: Group[] = ["attention", "running", "waiting", "review", "pop"];
const isApplicable = (p: PolicyFact) =>
	p.required === true && p.enabled !== false && p.applicable !== false;
const isReview = (p: PolicyFact) =>
	p.kind === "review" || ["C2", "C3", "W4", "W10", "V5"].includes(p.code ?? "");
const isPop = (p: PolicyFact) => p.code === "C11";
function group(p: PolicyFact): Group {
	if (isPop(p)) return "pop";
	if (isReview(p)) return "review";
	if (p.expired || p.state === "failed" || p.state === "canceled")
		return "attention";
	return p.state === "queued" || p.state === "waiting" ? "waiting" : "running";
}
function executionStatus(execution: Execution) {
	if (
		execution.providerResult?.toLowerCase() === "partiallysucceeded" ||
		execution.providerResult?.toLowerCase() === "succeededwithissues"
	)
		return "partial" as const;
	return execution.state;
}
function summarize(input: SummaryInput) {
	const policies = input.policies.filter(isApplicable);
	const builds = input.builds
		.filter((b) => b.required)
		.map((b) => ({
			name: b.name,
			status: executionStatus(b),
			providerResult: b.providerResult,
			stages: b.stages.map((s) => ({
				name: s.name,
				status: executionStatus(s),
				providerResult: s.providerResult,
			})),
		}));
	const ciStatus = policies.some((p) => p.kind === "build" && p.expired)
		? "expired"
		: ((
				[
					"failed",
					"canceled",
					"partial",
					"running",
					"queued",
					"waiting",
					"unknown",
					"passed",
				] as const
			).find((s) => builds.some((b) => b.status === s)) ?? "unknown");
	const deferred =
		ciStatus !== "passed" ||
		input.approvals.remaining !== 0 ||
		input.approvals.requiredReviewersPending !== false ||
		policies.some((p) => !isPop(p) && !["passed", "skipped"].includes(p.state));
	const unique = new Map<
		string,
		{ name: string; group: Group; states: CheckState[]; deferred: boolean }
	>();
	for (const policy of policies.filter(
		(p) => !["passed", "skipped"].includes(p.state),
	)) {
		const existing = unique.get(policy.name);
		const category = group(policy);
		unique.set(policy.name, {
			name: policy.name,
			group:
				existing && groups.indexOf(existing.group) < groups.indexOf(category)
					? existing.group
					: category,
			states: [...new Set([...(existing?.states ?? []), policy.state])].sort(),
			deferred: isPop(policy) && deferred,
		});
	}
	const pop = input.policies.filter(isPop);
	const requiredPop = pop.filter(isApplicable);
	const popStates = requiredPop.map((p) => p.state);
	const popState =
		input.checksValidity !== "valid"
			? "unknown"
			: !pop.length
				? "not_applicable"
				: !requiredPop.length
					? "not_required"
					: popStates.every((s) => s === "passed" || s === "skipped")
						? "satisfied"
						: popStates.includes("failed")
							? "unsatisfied"
							: popStates.includes("running")
								? "running"
								: popStates.some((s) => s === "queued" || s === "waiting")
									? "queued"
									: "unknown";
	return {
		readiness: input.readiness,
		blockers: [...unique.values()].sort(
			(a, b) =>
				groups.indexOf(a.group) - groups.indexOf(b.group) ||
				a.name.localeCompare(b.name),
		),
		approvals: input.approvals,
		ci: { status: ciStatus, builds },
		mergeable: input.mergeable,
		conflict: input.mergeable === "conflicts",
		pop: {
			state: popState,
			deferred: requiredPop.length > 0 && popState !== "satisfied" && deferred,
		},
		lifecycle: input.lifecycle,
		updatedAt: input.updatedAt,
		checksValidity: input.checksValidity,
	};
}
export type PrSummary = ReturnType<typeof summarize>;

export function summarizePull(item: PullQueryItem): PrSummary {
	const pull = interpretPull({
		...item,
		projectId: item.project.id,
		state: item.state === "draft" ? "open" : item.state,
		createdAt: Date.parse(item.createdAt) / 1000,
		updatedAt: Date.parse(item.updatedAt) / 1000,
		mergedAt: item.mergedAt ? Date.parse(item.mergedAt) / 1000 : null,
		observedAt: 0,
		checksObservedAt: item.freshness.checksObservedAt
			? Date.parse(item.freshness.checksObservedAt) / 1000
			: null,
		activity: [],
	});
	const approved = approvalCount(pull);
	const badge = readinessBadge(item.readiness);
	return summarize({
		readiness: {
			kind: badge.kind,
			label: badge.label,
			nextAction: item.readiness.nextAction,
			isCurrent: item.readiness.status === "complete",
		},
		policies: pull.policies.map((p) => ({
			name: p.name,
			kind: p.kind ?? null,
			code: POLICY_CODES[p.name] ?? null,
			state: p.state,
			required: p.required,
			enabled: p.evidence?.isEnabled ?? null,
			applicable:
				p.evidence?.status?.toLowerCase() === "notapplicable" ? false : null,
			expired: p.expired ?? null,
			minimumApprovals: p.evidence?.minimumApproverCount ?? null,
			authorVoteCounts: p.evidence?.creatorVoteCounts ?? null,
		})),
		builds: pull.builds.map((b) => ({
			name: b.name,
			state: b.state,
			required: b.required,
			providerResult: b.evidence?.result ?? null,
			stages: b.stages.map((s) => ({
				name: s.name,
				state: s.state,
				providerResult: s.evidence?.result ?? null,
			})),
		})),
		approvals: {
			approved,
			required: pull.requiredApprovals,
			remaining: Math.max(0, pull.requiredApprovals - approved),
			requiredReviewersPending: pull.reviewers.some(
				(r) => r.required && r.vote !== "approved",
			),
		},
		mergeable: pull.mergeable,
		lifecycle: item.state,
		updatedAt: item.updatedAt,
		checksValidity: item.freshness.checksValidity,
	});
}

export function summarizeInspection(item: Inspection): PrSummary {
	const policies = item.checks.items.map(
		(p): PolicyFact => ({
			name: p.name,
			kind: p.kind,
			code: p.code ?? POLICY_CODES[p.name] ?? null,
			state: p.state,
			required: p.required,
			enabled: p.enabled,
			applicable: p.applicable,
			expired: p.isExpired,
			minimumApprovals: p.reviewRule?.minimumApproverCount ?? null,
			authorVoteCounts: p.reviewRule?.creatorVoteCounts ?? null,
		}),
	);
	const thresholds = policies
		.filter(
			(p) => isApplicable(p) && isReview(p) && p.minimumApprovals !== null,
		)
		.map((p) => p.minimumApprovals as number);
	const required = thresholds.length ? Math.max(...thresholds) : null;
	const reviewers: PullRequest["reviewers"] = item.reviews.reviewers.map(
		(r) => ({
			id: r.id,
			name: r.name,
			vote:
				r.vote === "approved"
					? "approved"
					: r.vote === "changes_requested"
						? "changes_requested"
						: "pending",
			required: r.required,
			isGroup: r.isGroup ?? undefined,
			countsTowardApproval: r.countsTowardApproval ?? undefined,
		}),
	);
	const approved = item.reviews.observedAt
		? approvalCount({
				author: item.pr.author ?? { id: "", name: "" },
				reviewers,
				authorCountsTowardApproval: !policies.some(
					(p) => isApplicable(p) && isReview(p) && p.authorVoteCounts === false,
				),
			})
		: null;
	const kind =
		item.readiness.state ??
		(item.readiness.phase === "error" ? "error" : "unknown");
	return summarize({
		readiness: {
			kind,
			label: AI_LABELS[kind],
			nextAction: item.nextAction?.text ?? null,
			isCurrent: item.readiness.isCurrent,
		},
		policies,
		builds: item.builds.map((b) => ({
			name: b.name,
			state: b.state,
			required: b.required,
			providerResult: b.providerResult,
			stages: b.stages.map((s) => ({
				name: s.name,
				state: s.state,
				providerResult: s.providerResult,
			})),
		})),
		approvals: {
			approved,
			required,
			remaining:
				required !== null && approved !== null
					? Math.max(0, required - approved)
					: null,
			requiredReviewersPending: item.reviews.observedAt
				? reviewers.some((r) => r.required && r.vote !== "approved")
				: null,
		},
		mergeable: item.pr.mergeability,
		lifecycle:
			item.pr.lifecycle === "open" && item.pr.draft
				? "draft"
				: item.pr.lifecycle,
		updatedAt: item.pr.updatedAt,
		checksValidity: item.checks.validity,
	});
}
