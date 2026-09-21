import { providerCheckState as mapCheckState } from "@signoff/domain/state-machine";

export { providerCheckState as mapCheckState } from "@signoff/domain/state-machine";

import { adoPullId } from "@signoff/domain/collection";
import type {
	Build,
	BuildStage,
	CheckState,
	Policy,
	PullRequest,
} from "@signoff/domain/workbench";
import { policyScopeSchema } from "@signoff/domain/workbench";
import type {
	AdoBuild,
	AdoEvaluation,
	AdoPullRequestSummary,
	AdoStatus,
	AdoTimelineRecord,
} from "./raw.js";

export function mapReviewerVote(
	vote: number,
): "approved" | "changes_requested" | "pending" | "commented" {
	if (vote >= 5) return "approved";
	if (vote < 0) return "changes_requested";
	return "pending";
}

export function mapMergeable(
	mergeStatus: string | undefined,
): "clear" | "conflicts" | "unknown" {
	if (!mergeStatus) return "unknown";
	const lower = mergeStatus.toLowerCase();
	if (lower === "succeeded") return "clear";
	if (lower === "conflicts") return "conflicts";
	return "unknown";
}

export function parseSeconds(isoStr: string | null | undefined): number | null {
	if (!isoStr) return null;
	const ms = Date.parse(isoStr);
	return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : null;
}

export function normalizePolicy(evaluation: AdoEvaluation): Policy {
	const cfg = evaluation.configuration;
	const configuredName =
		cfg.settings?.displayName ??
		cfg.settings?.statusName ??
		evaluation.context?.buildDefinitionName;
	const name =
		(typeof configuredName === "string" && configuredName.trim()) ||
		cfg.type?.displayName ||
		`Policy ${cfg.id}`;
	const rawStatus = (evaluation.status || "").toLowerCase();
	const isNotApplicable = rawStatus === "notapplicable";
	const required =
		cfg.isBlocking !== false && cfg.isEnabled !== false && !isNotApplicable;
	const typeId = cfg.type?.id?.toLowerCase();
	const review =
		typeId === "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" ||
		typeId === "fd2167ab-b0be-447a-8ec8-39368250530e" ||
		(!typeId && /reviewer/i.test(name));
	const build = typeId === "0609b952-1397-4640-95ec-e00a01b2c241";
	// A build behind the target can still satisfy the policy's validity period.
	// Only ADO's expiry flag establishes expiry; buildIsNotCurrent does not.
	const expiration = evaluation.context?.isExpired;
	const expired =
		build && typeof expiration === "boolean" ? expiration : undefined;
	const state = expired ? "failed" : mapCheckState(evaluation.status);
	const reviewAction = `Request the required reviewer approvals for ${name}.`;
	const details: Record<CheckState, string> = {
		passed: `${name} passed.`,
		failed: review
			? reviewAction
			: `Resolve ${name} in Azure DevOps, then rerun the check.`,
		running: review ? reviewAction : `Wait for ${name} to finish.`,
		queued: review ? reviewAction : `Wait for ${name} to start.`,
		waiting: review
			? reviewAction
			: `Review the pending approval for ${name} in Azure DevOps.`,
		skipped: `${name} does not apply to this PR.`,
		canceled: `Check why ${name} was canceled, then rerun it.`,
		unknown: `Rescan to verify ${name}.`,
	};
	return {
		id: `policy-${cfg.id}`,
		name,
		kind: review
			? "review"
			: build
				? "build"
				: typeId === "cbdc66da-9728-4af8-aada-9a5a32e4a226"
					? "status"
					: "policy",
		definitionId:
			build && typeof cfg.settings?.buildDefinitionId === "number"
				? String(cfg.settings.buildDefinitionId)
				: undefined,
		evidence: {
			status: evaluation.status,
			description: evaluation.description?.slice(0, 4000),
			evaluationId: evaluation.evaluationId,
			configurationId: String(cfg.id),
			requiredReviewerIds: Array.isArray(cfg.settings?.requiredReviewerIds)
				? cfg.settings.requiredReviewerIds.filter(
						(id): id is string => typeof id === "string",
					)
				: undefined,
			filenamePatterns: Array.isArray(cfg.settings?.filenamePatterns)
				? cfg.settings.filenamePatterns.filter(
						(pattern): pattern is string => typeof pattern === "string",
					)
				: undefined,
			typeId: cfg.type?.id,
			configurationRevision: evidenceNumber(cfg.revision),
			isBlocking: cfg.isBlocking,
			isEnabled: cfg.isEnabled,
			isExpired: evidenceBoolean(evaluation.context?.isExpired),
			buildIsNotCurrent: evidenceBoolean(evaluation.context?.buildIsNotCurrent),
			buildId:
				typeof evaluation.context?.buildId === "number" ||
				typeof evaluation.context?.buildId === "string"
					? String(evaluation.context.buildId)
					: undefined,
			validDurationMinutes: evidenceNumber(cfg.settings?.validDuration),
			minimumApproverCount: evidenceNumber(cfg.settings?.minimumApproverCount),
			creatorVoteCounts: evidenceBoolean(cfg.settings?.creatorVoteCounts),
			allowDownvotes: evidenceBoolean(cfg.settings?.allowDownvotes),
			scope: Array.isArray(cfg.settings?.scope)
				? cfg.settings.scope.slice(0, 1000).flatMap((scope) => {
						const parsed = policyScopeSchema.safeParse(scope);
						return parsed.success ? [parsed.data] : [];
					})
				: undefined,
			startedAt:
				evaluation.startedDate === undefined
					? undefined
					: parseSeconds(evaluation.startedDate),
			completedAt:
				evaluation.completedDate === undefined
					? undefined
					: parseSeconds(evaluation.completedDate),
		},
		expired,
		state,
		required,
		detail: expired
			? `${name} has expired. Queue a new build for the current PR and target branch.`
			: details[state],
		owner: review ? "Reviewers" : "Project maintainers",
	};
}

const evidenceBoolean = (value: unknown) =>
	typeof value === "boolean" ? value : undefined;
const evidenceNumber = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;

export function normalizeStatusPolicy(
	status: AdoStatus,
	required = false,
): Policy {
	const contextName = status.context?.name || "status";
	const genre = status.context?.genre ? `${status.context.genre}/` : "";
	const fullName = `${genre}${contextName}`;
	const rawState = status.state || "unknown";
	const state =
		rawState.toLowerCase() === "pending" ? "running" : mapCheckState(rawState);
	return {
		id: `status-${status.id ?? fullName}`,
		name: fullName,
		kind: "status",
		evidence: {
			status: status.state,
			updatedAt: parseSeconds(status.updatedDate),
			url:
				status.targetUrl &&
				URL.canParse(status.targetUrl) &&
				["http:", "https:"].includes(new URL(status.targetUrl).protocol)
					? status.targetUrl
					: undefined,
			description: status.description?.slice(0, 4000),
		},
		state,
		required,
		detail: status.description || rawState,
		owner: fullName,
	};
}

export function normalizeBuildStages(
	records: AdoTimelineRecord[],
): BuildStage[] {
	const stages = records.filter((r) => r.type?.toLowerCase() === "stage");
	const candidates =
		stages.length > 0
			? stages
			: records.filter((r) => r.type?.toLowerCase() === "job");
	const latest = new Map<string, AdoTimelineRecord>();
	for (const record of candidates) {
		const key = record.identifier || record.id;
		const previous = latest.get(key);
		if (!previous || (record.attempt ?? 1) >= (previous.attempt ?? 1))
			latest.set(key, record);
	}

	return [...latest.values()]
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map((r) => {
			const rawState = r.result || r.state;
			const state =
				rawState?.toLowerCase() === "pending"
					? "queued"
					: mapCheckState(rawState);
			const start = parseSeconds(r.startTime);
			const finish = parseSeconds(r.finishTime);
			const durationSeconds =
				start !== null && finish !== null && finish >= start
					? finish - start
					: null;
			const detail: Record<CheckState, string> = {
				passed: `${r.name} passed.`,
				failed: `Review the ${r.name} logs, fix the failure, and rerun the build.`,
				canceled: `Check why ${r.name} was canceled, then rerun the build.`,
				running: `Wait for ${r.name} to finish.`,
				queued: `${r.name} is waiting to start.`,
				waiting: `Review the pending approval for ${r.name}.`,
				skipped: `${r.name} was skipped by the pipeline.`,
				unknown: `Rescan to verify ${r.name}.`,
			};
			return {
				id: r.id,
				name: r.name,
				evidence: {
					status: r.state,
					description: r.issues
						?.map((i) => i.message)
						.filter(Boolean)
						.join("\n")
						.slice(0, 4000),
					result: r.result,
					identifier: r.identifier,
					recordType: r.type,
					updatedAt: parseSeconds(r.lastModified),
					attempt: r.attempt,
					startedAt: start,
					completedAt: finish,
				},
				state,
				required: state !== "skipped",
				detail: detail[state],
				owner: "Build owners",
				durationSeconds,
			};
		});
}

export type BuildWithStages = {
	build: AdoBuild;
	stages: BuildStage[];
	required?: boolean;
	collectionIssues?: string[];
};

export function normalizeBuild(item: BuildWithStages): Build {
	const b = item.build;
	const rawState = b.result || b.status;
	const state = mapCheckState(rawState);
	const name = b.definition?.name || `Build ${b.id}`;

	return {
		id: String(b.id),
		name,
		definitionId: b.definition ? String(b.definition.id) : undefined,
		evidence: {
			status: b.status,
			result: b.result,
			sourceSha: b.sourceVersion,
			sourceBranch: b.sourceBranch,
			queuedAt: parseSeconds(b.queueTime),
			startedAt: parseSeconds(b.startTime),
			completedAt: parseSeconds(b.finishTime),
		},
		number: b.id,
		state,
		required: item.required ?? true,
		stages: item.stages.map((stage) => ({
			...stage,
			required: item.required !== false && stage.required,
		})),
	};
}

export function deduplicateLatestStatuses(statuses: AdoStatus[]): AdoStatus[] {
	const map = new Map<string, AdoStatus>();
	for (const s of statuses) {
		const genre = s.context?.genre || "";
		const name = s.context?.name || "";
		const key = `${genre}/${name}`;
		const existing = map.get(key);
		const updated = parseSeconds(s.updatedDate ?? s.creationDate) ?? 0;
		const previous =
			parseSeconds(existing?.updatedDate ?? existing?.creationDate) ?? 0;
		if (
			!existing ||
			updated > previous ||
			(updated === previous && (s.id ?? 0) > (existing.id ?? 0))
		) {
			map.set(key, s);
		}
	}
	return Array.from(map.values());
}

export function extractRequiredApprovals(evaluations: AdoEvaluation[]): number {
	let maxApprovers = 0;
	for (const ev of evaluations) {
		const cfg = ev.configuration;
		if (
			cfg.isEnabled === false ||
			cfg.isBlocking === false ||
			ev.status?.toLowerCase() === "notapplicable"
		)
			continue;
		const typeId = cfg.type?.id?.toLowerCase();
		if (typeId === "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" && cfg.settings) {
			const count = Number(cfg.settings.minimumApproverCount);
			if (Number.isFinite(count) && count > maxApprovers) {
				maxApprovers = count;
			}
		}
	}
	return maxApprovers;
}

function resolvePoliciesAndStatuses(
	evaluations?: AdoEvaluation[],
	statuses?: AdoStatus[],
): Policy[] {
	const policies: Policy[] = [];
	const coveredContexts = new Set<string>();

	if (evaluations) {
		for (const ev of evaluations) {
			policies.push(normalizePolicy(ev));
			const typeId = ev.configuration.type?.id?.toLowerCase();
			if (
				typeId === "cbdc66da-9728-4af8-aada-9a5a32e4a226" &&
				ev.configuration.settings
			) {
				const genre = (ev.configuration.settings.statusGenre as string) || "";
				const name = (ev.configuration.settings.statusName as string) || "";
				coveredContexts.add(`${genre}/${name}`);
			}
		}
	}

	if (statuses) {
		const latestStatuses = deduplicateLatestStatuses(statuses);
		for (const st of latestStatuses) {
			const genre = st.context?.genre || "";
			const name = st.context?.name || "";
			const key = `${genre}/${name}`;
			if (!coveredContexts.has(key)) {
				policies.push(normalizeStatusPolicy(st, false));
			}
		}
	}

	return policies;
}

function resolvePullState(rawStatus?: string): "open" | "merged" | "closed" {
	const lower = (rawStatus || "active").toLowerCase();
	if (lower === "completed") return "merged";
	if (lower === "abandoned") return "closed";
	return "open";
}

export function normalizePullRequest(opts: {
	projectId: string;
	rawPr: AdoPullRequestSummary;
	evaluations?: AdoEvaluation[];
	statuses?: AdoStatus[];
	builds?: BuildWithStages[];
	now: number;
	updatedAt?: number;
	collectionIssues?: string[];
	filesChanged?: number | null;
	additions?: number | null;
	deletions?: number | null;
	comments?: number | null;
	checksObservedAt?: number | null;
	summaryObservedAt?: number;
}): PullRequest {
	const { projectId, rawPr, now } = opts;
	const repoId = rawPr.repository.id;
	const externalId = String(rawPr.pullRequestId);
	const id = adoPullId(projectId, repoId, externalId);

	const nowSec = Math.floor(now);
	const createdSec = parseSeconds(rawPr.creationDate) ?? nowSec;
	const fallbackUpdated =
		parseSeconds(rawPr.closedDate) ??
		parseSeconds(rawPr.creationDate) ??
		nowSec;
	const updatedSec = opts.updatedAt ?? fallbackUpdated;

	const policies = resolvePoliciesAndStatuses(opts.evaluations, opts.statuses);
	const normalizedBuilds = (opts.builds || []).map(normalizeBuild);
	const reviewerPolicies = (opts.evaluations ?? []).filter(
		(ev) =>
			ev.configuration.type?.id?.toLowerCase() ===
				"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" &&
			ev.configuration.isEnabled !== false &&
			ev.configuration.isBlocking !== false &&
			ev.status?.toLowerCase() !== "notapplicable",
	);
	const excludeCreator = reviewerPolicies.some(
		(ev) => ev.configuration.settings?.creatorVoteCounts === false,
	);

	const reviewers = (rawPr.reviewers || []).map((r) => ({
		id: r.id,
		name: r.displayName || "Unknown",
		vote: mapReviewerVote(r.vote),
		providerVote: r.vote,
		hasDeclined: r.hasDeclined,
		required: r.isRequired === true,
		isGroup: r.isContainer,
		countsTowardApproval:
			r.isContainer !== true &&
			!(excludeCreator && r.id === rawPr.createdBy?.id),
	}));

	const evalRequiredApprovals = opts.evaluations
		? extractRequiredApprovals(opts.evaluations)
		: 0;

	const issues =
		opts.collectionIssues && opts.collectionIssues.length > 0
			? opts.collectionIssues
			: undefined;

	return {
		id,
		projectId,
		externalId,
		number: rawPr.pullRequestId,
		repository: { id: repoId, name: rawPr.repository.name },
		title: (rawPr.title || "").trim() || `PR #${rawPr.pullRequestId}`,
		description: rawPr.description || "",
		author: {
			id: rawPr.createdBy?.id || "unknown",
			name: rawPr.createdBy?.displayName || "Unknown",
			handle: rawPr.createdBy?.uniqueName?.trim() || undefined,
			avatarUrl: rawPr.createdBy?.imageUrl,
		},
		sourceBranch: (rawPr.sourceRefName || "").replace(/^refs\/heads\//, ""),
		targetBranch: (rawPr.targetRefName || "").replace(/^refs\/heads\//, ""),
		state: resolvePullState(rawPr.status),
		evidence: {
			status: rawPr.status,
			mergeStatus: rawPr.mergeStatus,
			mergeSha: rawPr.lastMergeCommit?.commitId,
		},
		mergedAt:
			rawPr.status === "completed" ? parseSeconds(rawPr.closedDate) : null,
		draft: rawPr.isDraft === true,
		mergeable: mapMergeable(rawPr.mergeStatus),
		coverage: issues ? "partial" : "complete",
		collectionIssues: issues,
		createdAt: createdSec,
		updatedAt: updatedSec,
		observedAt: nowSec,
		summaryObservedAt: opts.summaryObservedAt ?? nowSec,
		headSha: rawPr.lastMergeSourceCommit?.commitId ?? null,
		targetSha: rawPr.lastMergeTargetCommit?.commitId ?? null,
		checksObservedAt:
			opts.checksObservedAt === undefined ? nowSec : opts.checksObservedAt,
		requiredApprovals: evalRequiredApprovals,
		authorCountsTowardApproval: opts.evaluations ? !excludeCreator : undefined,
		allowDownvotes: opts.evaluations
			? reviewerPolicies.every(
					(ev) => ev.configuration.settings?.allowDownvotes === true,
				)
			: undefined,
		reviewers,
		policies,
		builds: normalizedBuilds,
		labels: (rawPr.labels || []).map((l) => l.name),
		filesChanged: opts.filesChanged ?? null,
		additions: opts.additions ?? null,
		deletions: opts.deletions ?? null,
		comments: opts.comments ?? null,
		activity: [],
	};
}
