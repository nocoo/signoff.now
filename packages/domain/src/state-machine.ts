import {
	basePullRequirements,
	type CheckState,
	type Project,
	type PullRequest,
	policyKind,
	pullProgress,
} from "./workbench.js";
/** Provider vocabulary translation, not a readiness decision. */
export function providerCheckState(raw: string | null | undefined): CheckState {
	switch (raw?.toLowerCase()) {
		case "approved":
		case "succeeded":
		case "success":
			return "passed";
		case "notapplicable":
		case "skipped":
			return "skipped";
		case "failed":
		case "failure":
		case "error":
		case "rejected":
		case "broken":
		case "partiallysucceeded":
			return "failed";
		case "running":
		case "inprogress":
		case "cancelling":
			return "running";
		case "queued":
		case "notstarted":
			return "queued";
		case "waiting":
		case "pending":
			return "waiting";
		case "canceled":
		case "cancelled":
			return "canceled";
		default:
			return "unknown";
	}
}

/** Interpret retained evidence without mutating the provider snapshot. Old snapshots remain readable. */
export function interpretPull(pr: PullRequest): PullRequest {
	const policies = pr.policies.map((policy) => {
		const evidence = policy.evidence;
		if (!evidence) return policy;
		const expired =
			policyKind(policy) === "build" ? evidence.isExpired : undefined;
		const state = expired
			? "failed"
			: policy.id.startsWith("status-") &&
					evidence.status?.toLowerCase() === "pending"
				? "running"
				: providerCheckState(evidence.status);
		return {
			...policy,
			state,
			expired,
			required:
				evidence.isBlocking === undefined && evidence.isEnabled === undefined
					? policy.required
					: evidence.isBlocking !== false &&
						evidence.isEnabled !== false &&
						evidence.status?.toLowerCase() !== "notapplicable",
			detail: expired
				? `${policy.name} has expired. Queue a new build for the current PR and target branch.`
				: policy.detail,
		};
	});
	const reviewPolicies = policies.filter(
		(p) =>
			p.required &&
			p.evidence?.typeId?.toLowerCase() ===
				"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
	);
	const authorCountsTowardApproval = reviewPolicies.length
		? !reviewPolicies.some((p) => p.evidence?.creatorVoteCounts === false)
		: pr.authorCountsTowardApproval;
	return {
		...pr,
		policies,
		authorCountsTowardApproval,
		requiredApprovals: reviewPolicies.length
			? Math.max(
					0,
					...reviewPolicies.map((p) => p.evidence?.minimumApproverCount ?? 0),
				)
			: pr.requiredApprovals,
		allowDownvotes: reviewPolicies.length
			? reviewPolicies.every((p) => p.evidence?.allowDownvotes === true)
			: pr.allowDownvotes,
		reviewers: pr.reviewers.map((r) => ({
			...r,
			vote:
				r.providerVote === undefined
					? r.vote
					: r.providerVote >= 5
						? "approved"
						: r.providerVote < 0
							? "changes_requested"
							: "pending",
			countsTowardApproval: reviewPolicies.length
				? !r.isGroup &&
					(r.id !== pr.author.id || authorCountsTowardApproval !== false)
				: r.countsTowardApproval,
		})),
		builds: pr.builds.map((b) => ({
			...b,
			state: b.evidence
				? providerCheckState(b.evidence.result || b.evidence.status)
				: b.state,
			stages: b.stages.map((s) => ({
				...s,
				state: s.evidence
					? (s.evidence.result || s.evidence.status)?.toLowerCase() ===
						"pending"
						? "queued"
						: providerCheckState(s.evidence.result || s.evidence.status)
					: s.state,
			})),
		})),
	};
}

export function checksValidity(pull: PullRequest) {
	return pull.checksInvalidated
		? "invalidated"
		: pull.checksObservedAt === null
			? "missing"
			: "valid";
}

export function evaluatePull(snapshot: PullRequest, project: Project) {
	const pull = interpretPull(snapshot);
	return {
		pull,
		requirements: basePullRequirements(pull, project),
		progress: pullProgress(pull),
	};
}
export const evaluateRequirements = (pull: PullRequest, project: Project) =>
	evaluatePull(pull, project).requirements;
