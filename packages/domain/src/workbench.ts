import { z } from "zod";
export const policyInstructionSchema = z
	.object({
		gateId: z.string().min(1).max(500),
		description: z.string().max(4000),
	})
	.strict();
export const policyInstructionsSchema = z
	.array(policyInstructionSchema)
	.max(1000)
	.refine(
		(items) => new Set(items.map((i) => i.gateId)).size === items.length,
		"Policy identities must be unique",
	);
export const policyContextSchema = z.object({
	default: policyInstructionsSchema,
	repositories: z.record(z.string(), policyInstructionsSchema),
});
export type PolicyContext = z.infer<typeof policyContextSchema>;

export { evaluateRequirements as pullRequirements } from "./state-machine.js";

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
export const policyScopeSchema = z.object({
	repositoryId: name.nullable().optional(),
	refName: z.string().max(1024).nullable().optional(),
	matchKind: z.string().max(80).optional(),
});
export const mergeRequirementSchema = z.object({
	id: gateIdSchema,
	name,
	kind: mergeRequirementKindSchema,
	definitionId: name.optional(),
	detail: z.string().max(1000).optional(),
	sourceIds: z.array(gateIdSchema).max(1000).optional(),
	scope: z.array(policyScopeSchema).max(1000).optional(),
});
export type MergeRequirement = z.infer<typeof mergeRequirementSchema>;
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
	policyContext: policyContextSchema.optional(),
	mergeRequirements: z.array(mergeRequirementSchema).max(1000).optional(),
	stateMachineRevision: z.number().int().positive().optional(),
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
/** Bounded provider evidence, retained independently of its interpretation. */
export const policyEvidenceSchema = z.object({
	description: z.string().max(4000).optional(),
	status: z.string().max(120).optional(),
	evaluationId: name.optional(),
	typeId: name.optional(),
	configurationRevision: instant.optional(),
	isBlocking: z.boolean().optional(),
	isEnabled: z.boolean().optional(),
	isExpired: z.boolean().optional(),
	buildIsNotCurrent: z.boolean().optional(),
	buildId: name.optional(),
	validDurationMinutes: instant.optional(),
	minimumApproverCount: instant.optional(),
	creatorVoteCounts: z.boolean().optional(),
	allowDownvotes: z.boolean().optional(),
	scope: z.array(policyScopeSchema).max(1000).optional(),
	startedAt: instant.nullable().optional(),
	completedAt: instant.nullable().optional(),
});
export const buildEvidenceSchema = z.object({
	description: z.string().max(4000).optional(),
	status: z.string().max(120).optional(),
	result: z.string().max(120).nullable().optional(),
	sourceSha: z.string().max(240).optional(),
	sourceBranch: z.string().max(1024).optional(),
	identifier: z.string().max(1024).nullable().optional(),
	attempt: instant.optional(),
	queuedAt: instant.nullable().optional(),
	startedAt: instant.nullable().optional(),
	completedAt: instant.nullable().optional(),
});
export const policySchema = z.object({
	id: name,
	name,
	kind: mergeRequirementKindSchema.optional(),
	definitionId: name.optional(),
	/** Provider reports that the build no longer satisfies this policy. */
	expired: z.boolean().optional(),
	evidence: policyEvidenceSchema.optional(),
	state: checkStateSchema,
	required: z.boolean(),
	detail: z.string(),
	owner: name,
});
export type Policy = z.infer<typeof policySchema>;
export const stageSchema = policySchema.extend({
	evidence: buildEvidenceSchema.optional(),
	durationSeconds: instant.nullable(),
});
export type BuildStage = z.infer<typeof stageSchema>;
export const buildSchema = z.object({
	id: name,
	name,
	definitionId: name.optional(),
	evidence: buildEvidenceSchema.optional(),
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
	evidence: z
		.object({
			status: z.string().max(120),
			mergeStatus: z.string().max(120).optional(),
			mergeSha: z.string().max(240).nullable().optional(),
		})
		.optional(),
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
			providerVote: z.number().finite().optional(),
			hasDeclined: z.boolean().optional(),
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
export const collectionLaneSchema = z.enum(["checks", "discover"]);
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
				name: policy.name,
				kind: previous?.kind ?? policyKind(policy),
				definitionId: policy.definitionId ?? previous?.definitionId,
				scope: policy.evidence?.scope ?? previous?.scope,
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
		{
			gate: MergeRequirement;
			sources: Set<string>;
			details: Set<string>;
			scopes: Map<string, z.infer<typeof policyScopeSchema>>;
		}
	>();
	for (const gate of requirements.values()) {
		const id =
			project.mergeRequirements?.find((existing) =>
				existing.sourceIds?.some(
					(source) => gate.id === source || gate.sourceIds?.includes(source),
				),
			)?.id ?? requirementKey(gate);
		const group = groups.get(id) ?? {
			gate: { ...gate, id },
			sources: new Set<string>(),
			details: new Set<string>(),
			scopes: new Map<string, z.infer<typeof policyScopeSchema>>(),
		};
		if (gate.id !== id) group.gate.name = gate.name;
		for (const sourceId of gate.sourceIds ?? [gate.id])
			group.sources.add(sourceId);
		if (gate.detail) group.details.add(gate.detail);
		for (const scope of gate.scope ?? [])
			group.scopes.set(JSON.stringify(scope), scope);
		groups.set(id, group);
	}
	return [...groups.values()]
		.map(({ gate, sources, details, scopes }) => ({
			...gate,
			sourceIds: [...sources].sort(),
			detail: [...details].join(" · ").slice(0, 1000) || undefined,
			scope: scopes.size ? [...scopes.values()] : undefined,
		}))
		.sort(
			(a, b) =>
				gateKindOrder[a.kind] - gateKindOrder[b.kind] ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
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

export function basePullRequirements(pr: PullRequest, project: Project) {
	return projectMergeRequirements({ ...project, mergeRequirements: [] }, [
		pr,
	]).map((gate) => {
		const policies = pr.policies.filter(
			(p) => p.id === gate.id || gate.sourceIds?.includes(p.id),
		);
		const builds = pr.builds.filter(
			(b) =>
				b.required &&
				(b.definitionId === gate.definitionId || buildGateId(b) === gate.id),
		);
		const states = [...policies, ...builds].map((p) => p.state);
		let state: CheckState = "unknown";
		if (gate.kind === "conflict")
			state =
				pr.mergeable === "clear"
					? "passed"
					: pr.mergeable === "conflicts"
						? "failed"
						: "unknown";
		else if (pr.checksObservedAt !== null && !pr.checksInvalidated) {
			if (gate.id === REVIEW_GATE.id)
				state =
					approvalCount(pr) >= pr.requiredApprovals &&
					!pr.reviewers.some((r) => r.required && r.vote !== "approved")
						? "passed"
						: "waiting";
			else
				state =
					(
						[
							"failed",
							"canceled",
							"unknown",
							"waiting",
							"running",
							"queued",
						] as const
					).find((s) => states.includes(s)) ??
					(states.length ? "passed" : "unknown");
		}
		return {
			...gate,
			required: true,
			state,
			label: gate.name,
			color: "gray" as const,
			links: [pullUrl(project, pr)],
		};
	});
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

export function repositoryBranchUrl(
	project: Pick<Project, "provider" | "organization" | "projectKey">,
	repository: string | { id: string | null; name: string },
	branch: string,
): string {
	const ref = encodeURIComponent(branch);
	return `${repositoryUrl(project, repository)}${project.provider === "ado" ? `?version=GB${ref}` : `/tree/${ref}`}`;
}
