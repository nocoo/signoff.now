import { z } from "zod";

const name = z.string().trim().min(1).max(240);
const instant = z.number().int().nonnegative();
export const providerSchema = z.enum(["ado", "github"]);
export const checkStateSchema = z.enum([
	"passed",
	"failed",
	"running",
	"queued",
	"waiting",
	"skipped",
	"canceled",
	"unknown",
]);
export type CheckState = z.infer<typeof checkStateSchema>;

export const readinessKindSchema = z.enum([
	"ready",
	"approval",
	"review",
	"running",
	"unknown",
	"blocked",
	"draft",
	"merged",
	"closed",
]);
export type ReadinessKind = z.infer<typeof readinessKindSchema>;
export const readinessColorSchema = z.enum([
	"green",
	"yellow",
	"orange",
	"blue",
	"red",
	"purple",
	"gray",
]);
export type ReadinessColor = z.infer<typeof readinessColorSchema>;
export const mergeRequirementKindSchema = z.enum([
	"conflict",
	"review",
	"build",
	"status",
	"policy",
]);
const gateIdSchema = z.string().trim().min(1).max(260);
export const mergeRequirementSchema = z.object({
	id: gateIdSchema,
	name,
	kind: mergeRequirementKindSchema,
	definitionId: name.optional(),
	detail: z.string().max(1000).optional(),
	sourceIds: z.array(gateIdSchema).max(1000).optional(),
});
export type MergeRequirement = z.infer<typeof mergeRequirementSchema>;
const readinessRuleSchema = z
	.object({
		gateId: gateIdSchema,
		label: name,
		color: readinessColorSchema,
	})
	.strict();
export type ReadinessRule = z.infer<typeof readinessRuleSchema>;
export const READINESS_LABELS: Record<ReadinessKind, string> = {
	ready: "Ready to merge",
	approval: "Awaiting approval",
	review: "Review needed",
	running: "In progress",
	unknown: "Unknown / incomplete",
	blocked: "Blocked",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
};
const READINESS_COLORS: Record<ReadinessKind, ReadinessColor> = {
	ready: "green",
	approval: "yellow",
	review: "orange",
	running: "blue",
	unknown: "gray",
	blocked: "red",
	draft: "gray",
	merged: "purple",
	closed: "gray",
};
export const readinessRuleKey = (rule: ReadinessRule): string => rule.gateId;
export const readinessRulesSchema = z
	.array(readinessRuleSchema)
	.max(1000)
	.refine(
		(rules) => new Set(rules.map(readinessRuleKey)).size === rules.length,
		"Merge requirement IDs must be unique",
	);
export const readinessWriteSchema = z
	.object({
		revision: z.number().int().positive(),
		rules: readinessRulesSchema,
	})
	.strict();

export const repositoryNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[^/\\?#:\p{Cc}]+$/u, "Enter repository names or IDs");
const repositoryScopeSchema = z
	.array(repositoryNameSchema)
	.max(100)
	.refine(
		(items) =>
			new Set(items.map((item) => item.toLowerCase())).size === items.length,
		"Repository names must be unique",
	);

export const projectSchema = z.object({
	id: name,
	provider: providerSchema,
	name,
	organization: name,
	projectKey: name,
	repositories: repositoryScopeSchema.optional(),
	readinessRules: readinessRulesSchema.optional(),
	mergeRequirements: z.array(mergeRequirementSchema).max(1000).optional(),
	readinessRevision: z.number().int().positive().optional(),
	description: z.string(),
	owner: name,
	enabled: z.boolean(),
	source: z.enum(["demo", "cli"]),
	revision: z.number().int().positive(),
	createdAt: instant,
	updatedAt: instant,
	lastScannedAt: instant.nullable(),
	scanState: z.enum(["never", "complete", "partial", "failed"]),
	scanMessage: z.string().nullable(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectWriteSchema = projectSchema
	.pick({
		name: true,
		organization: true,
		projectKey: true,
		repositories: true,
		description: true,
		owner: true,
		enabled: true,
	})
	.extend({
		provider: z.literal("ado"),
		name: z.string().trim().min(1, "Enter a project name").max(100),
		organization: z
			.string()
			.trim()
			.regex(
				/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/,
				"Enter an organization name, such as northstar, rather than a URL",
			),
		projectKey: z
			.string()
			.trim()
			.min(1, "Enter the Azure DevOps project name")
			.max(200)
			.regex(
				/^[^/\\?#:\p{Cc}]+$/u,
				"Enter a project name or ID, rather than a URL",
			),
		description: z.string().trim().max(1000),
		owner: z.string().trim().min(1, "Enter a project owner").max(100),
	})
	.strict();
export type ProjectWrite = z.infer<typeof projectWriteSchema>;
export const projectPatchSchema = projectWriteSchema
	.partial()
	.extend({
		revision: z.number().int().positive(),
	})
	.strict();
export const revisionSchema = z
	.object({ revision: z.number().int().positive() })
	.strict();
export const scopedPullIdsSchema = z
	.array(name)
	.max(20)
	.refine((ids) => new Set(ids).size === ids.length, "PR IDs must be unique");
export const scanRequestSchema = revisionSchema.extend({
	pullIds: scopedPullIdsSchema.optional(),
});

const actorSchema = z.object({
	id: name,
	name,
	handle: z.string().trim().min(1).max(1024).optional(),
	avatarUrl: z.string().url().max(2048).optional(),
});
export const policySchema = z.object({
	id: name,
	name,
	kind: mergeRequirementKindSchema.optional(),
	definitionId: name.optional(),
	state: checkStateSchema,
	required: z.boolean(),
	detail: z.string(),
	owner: name,
});
export type Policy = z.infer<typeof policySchema>;
export const stageSchema = policySchema.extend({
	durationSeconds: instant.nullable(),
});
export type BuildStage = z.infer<typeof stageSchema>;
export const buildSchema = z.object({
	id: name,
	name,
	definitionId: name.optional(),
	number: z.number().int().positive(),
	state: checkStateSchema,
	required: z.boolean(),
	stages: z.array(stageSchema),
});
export type Build = z.infer<typeof buildSchema>;

/** Provider facts only: ADO policies and GitHub checks use this same contract. */
export const pullRequestSchema = z.object({
	id: name,
	projectId: name,
	externalId: name,
	number: z.number().int().positive(),
	repository: z.object({ id: name, name }),
	title: z.string().trim().min(1).max(1000),
	description: z.string(),
	author: actorSchema,
	sourceBranch: name,
	targetBranch: name,
	state: z.enum(["open", "merged", "closed"]),
	draft: z.boolean(),
	mergeable: z.enum(["clear", "conflicts", "unknown"]),
	coverage: z.enum(["complete", "partial"]),
	collectionIssues: z.array(z.string().max(1000)).max(100).optional(),
	createdAt: instant,
	updatedAt: instant,
	observedAt: instant,
	mergedAt: instant.nullable().optional(),
	checksInvalidated: z.boolean().optional(),
	headSha: z.string().max(240).nullable().optional(),
	targetSha: z.string().max(240).nullable().optional(),
	checksObservedAt: instant.nullable().optional(),
	/** Summary request start, in epoch seconds with millisecond precision; independent of slow checks. */
	summaryObservedAt: z.number().finite().nonnegative().optional(),
	requiredApprovals: z.number().int().nonnegative(),
	/** Applies even before the author appears in the reviewer list. */
	authorCountsTowardApproval: z.boolean().optional(),
	allowDownvotes: z.boolean().optional(),
	reviewers: z.array(
		actorSchema.extend({
			vote: z.enum(["approved", "changes_requested", "pending", "commented"]),
			required: z.boolean(),
			isGroup: z.boolean().optional(),
			countsTowardApproval: z.boolean().optional(),
		}),
	),
	policies: z.array(policySchema),
	builds: z.array(buildSchema),
	labels: z.array(name),
	filesChanged: instant.nullable(),
	additions: instant.nullable(),
	deletions: instant.nullable(),
	comments: instant.nullable(),
	activity: z.array(
		z.object({
			id: name,
			at: instant,
			actor: name,
			title: name,
			detail: z.string(),
		}),
	),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const scanRunSchema = z.object({
	id: name,
	projectId: name,
	source: z.enum(["demo", "cli"]),
	state: z.enum(["complete", "partial", "failed"]),
	startedAt: instant,
	completedAt: instant,
	pullRequestCount: instant,
	advancedStages: instant,
	message: z.string(),
});
export type ScanRun = z.infer<typeof scanRunSchema>;
export const collectionLaneSchema = z.enum(["checks", "status"]);
export type CollectionLane = z.infer<typeof collectionLaneSchema>;
export const collectionJobSchema = z.object({
	id: name,
	projectId: name,
	revision: z.number().int().positive(),
	state: z.enum([
		"queued",
		"running",
		"auth_required",
		"canceled",
		"complete",
		"partial",
		"failed",
	]),
	requestedAt: instant,
	startedAt: instant.nullable(),
	updatedAt: instant,
	completedAt: instant.nullable(),
	completedPulls: instant,
	totalPulls: instant.nullable(),
	message: z.string(),
	/** Omitted: full scan. Empty: list only. Otherwise: selected PR checks. */
	pullIds: scopedPullIdsSchema.optional(),
	kind: z.enum(["list", "details", "full"]).optional(),
	lane: collectionLaneSchema.optional(),
	roundId: name.nullable().optional(),
});
export type CollectionJob = z.infer<typeof collectionJobSchema>;
export const refreshQueueKindSchema = z.enum(["list", "details"]);
export type RefreshQueueKind = z.infer<typeof refreshQueueKindSchema>;
export const refreshCooldownSchema = z.union([
	z.literal(0),
	z.literal(60),
	z.literal(120),
	z.literal(300),
	z.literal(600),
]);
export const refreshQueueSchema = z.object({
	kind: refreshQueueKindSchema,
	cooldownSeconds: refreshCooldownSchema,
	lastCompletedAt: instant.nullable(),
	roundId: name.nullable(),
	requested: z.boolean(),
	foregroundUntil: instant,
	totalJobs: instant,
	completedJobs: instant,
});
export type RefreshQueue = z.infer<typeof refreshQueueSchema>;
export function refreshQueuePhase(
	queue: RefreshQueue,
	timestamp: number,
): "off" | "paused" | "running" | "cooldown" | "due" {
	if (!queue.cooldownSeconds) return "off";
	if (queue.kind === "details" && queue.foregroundUntil <= timestamp)
		return "paused";
	if (queue.roundId) return "running";
	return queue.requested ||
		queue.lastCompletedAt === null ||
		timestamp >= queue.lastCompletedAt + queue.cooldownSeconds
		? "due"
		: "cooldown";
}
export const collectorStatusSchema = z.object({
	lastSeenAt: instant,
	state: z.enum(["ready", "auth_required", "error"]),
	message: z.string(),
});
export type CollectorStatus = z.infer<typeof collectorStatusSchema>;
export const scanRequestResultSchema = z.union([
	scanRunSchema,
	collectionJobSchema,
]);
export const workbenchSchema = z.object({
	projects: z.array(projectSchema),
	pullRequests: z.array(pullRequestSchema),
	scans: z.array(scanRunSchema),
	collectionJobs: z.array(collectionJobSchema).optional(),
	refreshQueues: z.array(refreshQueueSchema).optional(),
	collector: collectorStatusSchema.nullable().optional(),
	demoMode: z.boolean(),
	fetchedAt: instant,
	truncated: z.boolean(),
});
export type Workbench = z.infer<typeof workbenchSchema>;

export type PullIssue = {
	kind: "blocked" | "approval" | "review" | "running" | "unknown";
	label: string;
	action: string;
	owner: string;
	gateId?: string;
	gateName?: string;
};
export type PullReadiness = Omit<PullIssue, "kind"> & {
	kind: ReadinessKind;
	issues: PullIssue[];
	rank?: number;
	color?: ReadinessColor;
};
const CONFLICT_GATE: MergeRequirement = {
	id: "merge-conflicts",
	name: "Resolve merge conflicts",
	kind: "conflict",
};
const REVIEW_GATE: MergeRequirement = {
	id: "review-approvals",
	name: "Required reviewer approvals",
	kind: "review",
};
const gateKindOrder = {
	conflict: 0,
	review: 1,
	build: 2,
	status: 3,
	policy: 4,
};
const buildGateId = (build: Build) =>
	`build:${build.definitionId ?? build.name.trim().toLowerCase()}`;
// Old snapshots did not carry the policy type; their names remain a conservative fallback until recollected.
export const policyKind = (policy: Policy): MergeRequirement["kind"] =>
	policy.kind ?? (/reviewer/i.test(policy.name) ? "review" : "policy");

const requirementKey = (gate: MergeRequirement) =>
	gate.id === CONFLICT_GATE.id || gate.id === REVIEW_GATE.id
		? gate.id
		: `${gate.kind}:${gate.kind === "build" && gate.definitionId ? gate.definitionId : gate.name.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** One sortable step per logical requirement; each underlying source evaluation still has to pass. */
export function projectMergeRequirements(
	project: Project,
	pulls: PullRequest[] = [],
): MergeRequirement[] {
	const scoped = pulls.filter((pull) => pull.projectId === project.id);
	const requirements = new Map(
		(project.mergeRequirements ?? []).map((gate) => [gate.id, gate]),
	);
	if (scoped.length) requirements.set(CONFLICT_GATE.id, CONFLICT_GATE);
	for (const pull of scoped) {
		for (const policy of pull.policies.filter((item) => item.required)) {
			const previous =
				requirements.get(policy.id) ??
				[...requirements.values()].find((gate) =>
					gate.sourceIds?.includes(policy.id),
				);
			requirements.set(policy.id, {
				...previous,
				id: policy.id,
				name: previous?.name ?? policy.name,
				kind: previous?.kind ?? policyKind(policy),
				definitionId: policy.definitionId ?? previous?.definitionId,
			});
		}
	}
	const hasReviewPolicies = [...requirements.values()].some(
		(gate) => gate.kind === "review" && gate.id !== REVIEW_GATE.id,
	);
	if (hasReviewPolicies) requirements.delete(REVIEW_GATE.id);
	else if (
		scoped.some(
			(pull) =>
				pull.requiredApprovals > 0 ||
				pull.reviewers.some(
					(reviewer) =>
						reviewer.required || reviewer.vote === "changes_requested",
				),
		)
	)
		requirements.set(REVIEW_GATE.id, REVIEW_GATE);
	const definitions = new Set(
		[...requirements.values()]
			.filter((gate) => gate.kind === "build" && gate.definitionId)
			.map((gate) => gate.definitionId),
	);
	for (const pull of scoped)
		for (const build of pull.builds.filter((item) => item.required)) {
			if (build.definitionId && definitions.has(build.definitionId)) continue;
			const id = buildGateId(build);
			requirements.set(id, {
				id,
				name: build.name,
				kind: "build",
				definitionId: build.definitionId,
			});
		}
	const groups = new Map<
		string,
		{ gate: MergeRequirement; sources: Set<string>; details: Set<string> }
	>();
	for (const gate of requirements.values()) {
		const id = requirementKey(gate);
		const group = groups.get(id) ?? {
			gate: { ...gate, id },
			sources: new Set<string>(),
			details: new Set<string>(),
		};
		for (const sourceId of gate.sourceIds ?? [gate.id])
			group.sources.add(sourceId);
		if (gate.detail) group.details.add(gate.detail);
		groups.set(id, group);
	}
	return [...groups.values()]
		.map(({ gate, sources, details }) => ({
			...gate,
			sourceIds: [...sources].sort(),
			detail: [...details].join(" · ").slice(0, 1000) || undefined,
		}))
		.sort(
			(a, b) =>
				gateKindOrder[a.kind] - gateKindOrder[b.kind] ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
		);
}

function configuredReadinessRules(
	project: Project,
	gates: MergeRequirement[],
): ReadinessRule[] {
	const configured = new Map<string, ReadinessRule>();
	for (const rule of project.readinessRules ?? []) {
		const gate = gates.find(
			(candidate) =>
				candidate.id === rule.gateId ||
				candidate.sourceIds?.includes(rule.gateId),
		);
		if (gate && !configured.has(gate.id))
			configured.set(gate.id, { ...rule, gateId: gate.id });
	}
	return [...configured.values()];
}

/** Workflow order: resolve the first unmet requirement, then work toward the final merge steps. */
export function projectReadinessRules(
	project: Project,
	pulls: PullRequest[] = [],
): ReadinessRule[] {
	const gates = projectMergeRequirements(project, pulls);
	const configured = configuredReadinessRules(project, gates);
	const configuredIds = new Set(configured.map((rule) => rule.gateId));
	return [
		...gates
			.filter((gate) => !configuredIds.has(gate.id))
			.map(
				(gate): ReadinessRule => ({
					gateId: gate.id,
					label: gate.name,
					color:
						gate.kind === "review"
							? "orange"
							: gate.kind === "build"
								? "blue"
								: "red",
				}),
			),
		...configured,
	];
}

/** Zero is merge-ready. Later remaining gates sort ahead of earlier unmet requirements. */
export function readinessPriority(
	readiness: Pick<PullReadiness, "kind" | "gateId" | "rank">,
	project: Project,
): number {
	if (readiness.rank !== undefined) return readiness.rank;
	if (readiness.kind === "ready") return 0;
	const rules = projectReadinessRules(project);
	const index = rules.findIndex((rule) => rule.gateId === readiness.gateId);
	if (index >= 0) return (rules.length - index) / rules.length;
	return {
		approval: 1,
		review: 1,
		running: 1,
		blocked: 1,
		unknown: 2,
		draft: 3,
		merged: 4,
		closed: 5,
	}[readiness.kind];
}
export function readinessColor(
	readiness: Pick<PullReadiness, "kind" | "gateId" | "color">,
	project: Project,
): ReadinessColor {
	return (
		readiness.color ??
		project.readinessRules?.find((rule) => rule.gateId === readiness.gateId)
			?.color ??
		READINESS_COLORS[readiness.kind]
	);
}

export function isFailed(state: CheckState): boolean {
	return state === "failed" || state === "canceled";
}

export function approvalCount(
	pr: Pick<PullRequest, "reviewers" | "author" | "authorCountsTowardApproval">,
): number {
	return pr.reviewers.filter(
		(reviewer) =>
			!reviewer.isGroup &&
			!(
				pr.authorCountsTowardApproval === false && reviewer.id === pr.author.id
			) &&
			reviewer.countsTowardApproval !== false &&
			reviewer.vote === "approved",
	).length;
}

function buildIssues(build: Build, author: string, owner: string): PullIssue[] {
	const issues: PullIssue[] = [];
	const required = build.stages.filter((stage) => stage.required);
	const failed = required.find((stage) => isFailed(stage.state));
	const waiting = required.find((stage) => stage.state === "waiting");
	const active = required.find(
		(stage) => stage.state === "running" || stage.state === "queued",
	);
	const unknown = required.find(
		(stage) => stage.state === "unknown" || stage.state === "skipped",
	);
	if (failed || isFailed(build.state))
		issues.push({
			kind: "blocked",
			label: build.state === "canceled" ? "Build canceled" : "Build failed",
			action: failed?.detail ?? `Rerun ${build.name}`,
			owner: failed?.owner ?? author,
		});
	if (waiting || build.state === "waiting")
		issues.push({
			kind: "approval",
			label: "Approval needed",
			action: waiting?.detail ?? `Approve ${build.name}`,
			owner: waiting?.owner ?? owner,
		});
	const inProgress =
		active || build.state === "running" || build.state === "queued";
	if (
		unknown ||
		build.state === "unknown" ||
		build.state === "skipped" ||
		(!required.length && build.state === "passed")
	)
		issues.push({
			kind: "unknown",
			label: "Build unavailable",
			action: `Rescan ${build.name} to verify its stages`,
			owner,
		});
	if (inProgress)
		issues.push({
			kind: "running",
			label:
				active?.state === "queued" || build.state === "queued"
					? "Build queued"
					: "Building",
			action: active
				? `${active.name} · ${active.detail}`
				: `Wait for ${build.name}`,
			owner: active?.owner ?? "Build agents",
		});
	return issues;
}

function buildRequirementIssues(pr: PullRequest, owner: string): PullIssue[] {
	const issues: PullIssue[] = [];
	for (const build of pr.builds.filter((b) => b.required)) {
		const policies = pr.policies.filter(
			(policy) =>
				policy.required &&
				policyKind(policy) === "build" &&
				build.definitionId &&
				policy.definitionId === build.definitionId,
		);
		const gates = policies.length
			? policies
			: [{ id: buildGateId(build), name: build.name }];
		for (const gate of gates)
			issues.push(
				...buildIssues(build, pr.author.name, owner).map((issue) => ({
					...issue,
					gateId: gate.id,
					gateName: gate.name,
				})),
			);
	}
	return issues;
}

const severity = {
	blocked: 0,
	unknown: 1,
	review: 2,
	approval: 3,
	running: 4,
};

function groupRequirementIssues(
	issues: PullIssue[],
	requirements: MergeRequirement[],
): PullIssue[] {
	const byGate = new Map<string, PullIssue>();
	for (const issue of issues) {
		const gate = requirements.find(
			(candidate) =>
				candidate.id === issue.gateId ||
				(issue.gateId && candidate.sourceIds?.includes(issue.gateId)),
		);
		if (gate) {
			issue.gateId = gate.id;
			issue.gateName = gate.name;
		}
		const key = issue.gateId ?? issue.label;
		const previous = byGate.get(key);
		if (!previous || severity[issue.kind] <= severity[previous.kind])
			byGate.set(key, issue);
	}
	return [...byGate.values()];
}

/** A passed pipeline never overrides a conflict, missing review, or unknown gate. */
export function pullReadiness(
	pr: PullRequest,
	project: Project,
): PullReadiness {
	const owner = project.owner;
	if (pr.state === "merged")
		return {
			kind: "merged",
			label: "Merged",
			action: `Merged into ${pr.targetBranch}`,
			owner,
			issues: [],
		};
	if (pr.state === "closed")
		return {
			kind: "closed",
			label: "Closed",
			action: "Closed without merging",
			owner: pr.author.name,
			issues: [],
		};
	if (pr.draft)
		return {
			kind: "draft",
			label: "Draft",
			action: "Finish the changes and publish for review",
			owner: pr.author.name,
			issues: [],
		};
	const issues: PullIssue[] = [];
	const requirements = projectMergeRequirements(project, [pr]);
	const configured = configuredReadinessRules(project, requirements);
	const rules = projectReadinessRules(project, [pr]);
	const reviewGate =
		requirements.find(
			(gate) => gate.kind === "review" && /minimum/i.test(gate.name),
		) ??
		requirements.find((gate) => gate.kind === "review") ??
		REVIEW_GATE;
	const gateIndex = (issue: PullIssue) => {
		const index = rules.findIndex((rule) => rule.gateId === issue.gateId);
		return index < 0 ? rules.length : index;
	};
	const add = (
		kind: PullIssue["kind"],
		label: string,
		action: string,
		who = owner,
		gate?: Pick<MergeRequirement, "id" | "name">,
	) =>
		issues.push({
			kind,
			label,
			action,
			owner: who,
			...(gate ? { gateId: gate.id, gateName: gate.name } : {}),
		});
	if (pr.mergeable === "conflicts")
		add(
			"blocked",
			"Merge conflict",
			`Resolve conflicts with ${pr.targetBranch}`,
			pr.author.name,
			CONFLICT_GATE,
		);
	const hasReviewPolicy = pr.policies.some(
		(policy) => policy.required && policyKind(policy) === "review",
	);
	const changes = pr.reviewers.filter(
		(r) =>
			r.vote === "changes_requested" &&
			(r.required || !hasReviewPolicy || pr.allowDownvotes !== true),
	);
	if (changes.length)
		add(
			"blocked",
			"Changes requested",
			`Address ${changes.map((r) => r.name).join(" and ")}'s review feedback`,
			pr.author.name,
			reviewGate,
		);
	for (const policy of pr.policies.filter((p) => p.required)) {
		if (
			policyKind(policy) === "review" &&
			["failed", "queued", "running", "waiting"].includes(policy.state)
		)
			add("review", "Review needed", policy.detail, policy.owner, policy);
		else if (isFailed(policy.state))
			add("blocked", "Policy failed", policy.detail, policy.owner, policy);
		else if (policy.state === "waiting")
			add("approval", "Approval needed", policy.detail, policy.owner, policy);
		else if (policy.state === "running" || policy.state === "queued")
			add("running", "Checks running", policy.detail, policy.owner, policy);
		else if (policy.state !== "passed")
			add(
				"unknown",
				"Check unavailable",
				`Verify ${policy.name.toLowerCase()}`,
				policy.owner,
				policy,
			);
	}
	issues.push(...buildRequirementIssues(pr, owner));
	const approvals = approvalCount(pr);
	const pending = pr.reviewers.find(
		(r) =>
			r.required && r.vote !== "approved" && r.vote !== "changes_requested",
	);
	if (pending || approvals < pr.requiredApprovals) {
		add(
			"review",
			"Review needed",
			pending
				? `Review requested from ${pending.name}`
				: `${pr.requiredApprovals - approvals} more approval${pr.requiredApprovals - approvals === 1 ? "" : "s"} needed`,
			pending?.name,
			pr.policies.find(
				(policy) =>
					policy.required &&
					policyKind(policy) === "review" &&
					policy.state !== "passed",
			) ??
				pr.policies.find(
					(policy) => policy.required && policyKind(policy) === "review",
				) ??
				reviewGate,
		);
	}
	if (pr.checksObservedAt === null || pr.checksInvalidated)
		add(
			"unknown",
			"Awaiting checks",
			"Add this PR to the watch list to collect policies, builds, and stages",
		);
	else if (pr.coverage === "partial" || pr.mergeable === "unknown")
		add(
			"unknown",
			"Scan incomplete",
			"Rescan to retrieve the missing PR checks",
		);
	const uniqueIssues = groupRequirementIssues(issues, requirements)
		.sort(
			(a, b) =>
				(configured.length
					? gateIndex(a) - gateIndex(b)
					: severity[a.kind] - severity[b.kind]) ||
				gateIndex(a) - gateIndex(b) ||
				severity[a.kind] - severity[b.kind],
		)
		.map((issue) => {
			const rule = configured.find(
				(candidate) => candidate.gateId === issue.gateId,
			);
			return rule ? { ...issue, label: rule.label } : issue;
		});
	const first = uniqueIssues[0];
	return first
		? {
				...first,
				issues: uniqueIssues,
				rank:
					first.gateId && gateIndex(first) < rules.length
						? (rules.length - gateIndex(first)) / rules.length
						: 2,
				color:
					configured.find((rule) => rule.gateId === first.gateId)?.color ??
					readinessColor(first, project),
			}
		: {
				kind: "ready",
				label: "Ready to merge",
				action: `Merge into ${pr.targetBranch}`,
				owner,
				issues: uniqueIssues,
			};
}

/** Only gates evidenced on this PR; project-only policies may belong to other repositories or branches. */
export function pullRequirements(pr: PullRequest, project: Project) {
	const gates = projectMergeRequirements(
		{ ...project, mergeRequirements: [] },
		[pr],
	);
	const rules = projectReadinessRules(project, [pr]);
	const issues = pullReadiness(
		{ ...pr, state: "open", draft: false },
		{ ...project, mergeRequirements: gates },
	).issues;
	return gates
		.map((gate) => {
			const rule = rules.find((r) => r.gateId === gate.id);
			const issue = issues.find((i) => i.gateId === gate.id);
			const state: CheckState =
				gate.kind === "conflict"
					? pr.mergeable === "clear"
						? "passed"
						: pr.mergeable === "conflicts"
							? "failed"
							: "unknown"
					: pr.checksObservedAt === null || pr.checksInvalidated
						? "unknown"
						: issue
							? (
									{
										blocked: "failed",
										approval: "waiting",
										review: "waiting",
										running: "running",
										unknown: "unknown",
									} as const
								)[issue.kind]
							: "passed";
			return {
				...gate,
				required: true,
				state,
				label: rule?.label ?? gate.name,
				color: rule?.color ?? "gray",
				links: [pullUrl(project, pr)],
			};
		})
		.sort(
			(a, b) =>
				rules.findIndex((r) => r.gateId === a.id) -
				rules.findIndex((r) => r.gateId === b.id),
		);
}

export function pullProgress(pr: PullRequest) {
	const checks = [...pr.policies, ...pr.builds].filter((c) => c.required);
	const stages = pr.builds.flatMap((b) => b.stages);
	return {
		checksPassed: checks.filter((c) => c.state === "passed").length,
		checksTotal: checks.length,
		stagesPassed: stages.filter(
			(s) => s.state === "passed" || (s.state === "skipped" && !s.required),
		).length,
		stagesTotal: stages.length,
		optionalFailures: [...pr.policies, ...pr.builds].filter(
			(c) => !c.required && isFailed(c.state),
		).length,
	};
}

export function organizationUrl(
	project: Pick<Project, "provider" | "organization">,
): string {
	return project.provider === "ado"
		? `https://dev.azure.com/${encodeURIComponent(project.organization)}`
		: "https://github.com";
}

export function projectUrl(
	project: Pick<Project, "provider" | "organization" | "projectKey">,
): string {
	return `${organizationUrl(project)}/${encodeURIComponent(project.projectKey)}`;
}

export function repositoryUrl(
	project: Pick<Project, "provider" | "organization" | "projectKey">,
	repository: string | { id: string | null; name: string },
): string {
	const reference =
		typeof repository === "string"
			? repository
			: project.provider === "ado"
				? (repository.id ?? repository.name)
				: repository.name;
	return `${projectUrl(project)}/${project.provider === "ado" ? "_git/" : ""}${encodeURIComponent(reference)}`;
}

export function pullUrl(
	project: Pick<Project, "provider" | "organization" | "projectKey">,
	pr: Pick<PullRequest, "repository" | "number">,
): string {
	return `${repositoryUrl(project, pr.repository)}/${project.provider === "ado" ? "pullrequest" : "pull"}/${pr.number}`;
}
