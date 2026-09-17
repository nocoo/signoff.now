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

const actorSchema = z.object({ id: name, name });
export const policySchema = z.object({
	id: name,
	name,
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
	requiredApprovals: z.number().int().nonnegative(),
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
export const collectionJobSchema = z.object({
	id: name,
	projectId: name,
	revision: z.number().int().positive(),
	state: z.enum([
		"queued",
		"running",
		"auth_required",
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
});
export type CollectionJob = z.infer<typeof collectionJobSchema>;
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
	collector: collectorStatusSchema.nullable().optional(),
	demoMode: z.boolean(),
	fetchedAt: instant,
	truncated: z.boolean(),
});
export type Workbench = z.infer<typeof workbenchSchema>;

export type ReadinessKind =
	| "blocked"
	| "approval"
	| "review"
	| "running"
	| "unknown"
	| "ready"
	| "draft"
	| "merged"
	| "closed";
export type PullIssue = {
	kind: "blocked" | "approval" | "review" | "running" | "unknown";
	label: string;
	action: string;
	owner: string;
};
export type PullReadiness = {
	kind: ReadinessKind;
	label: string;
	action: string;
	owner: string;
	issues: PullIssue[];
};
const PRIORITY = { blocked: 0, approval: 1, unknown: 2, review: 3, running: 4 };

export function isFailed(state: CheckState): boolean {
	return state === "failed" || state === "canceled";
}

export function approvalCount(pr: Pick<PullRequest, "reviewers">): number {
	return pr.reviewers.filter(
		(reviewer) =>
			!reviewer.isGroup &&
			reviewer.countsTowardApproval !== false &&
			reviewer.vote === "approved",
	).length;
}

function buildIssue(
	build: Build,
	author: string,
	owner: string,
): PullIssue | null {
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
		return {
			kind: "blocked",
			label: build.state === "canceled" ? "Build canceled" : "Build failed",
			action: failed?.detail ?? `Rerun ${build.name}`,
			owner: failed?.owner ?? author,
		};
	if (waiting || build.state === "waiting")
		return {
			kind: "approval",
			label: "Approval needed",
			action: waiting?.detail ?? `Approve ${build.name}`,
			owner: waiting?.owner ?? owner,
		};
	const inProgress =
		active || build.state === "running" || build.state === "queued";
	if (
		unknown ||
		build.state === "unknown" ||
		build.state === "skipped" ||
		(!required.length && !inProgress)
	)
		return {
			kind: "unknown",
			label: "Build unavailable",
			action: `Rescan ${build.name} to verify its stages`,
			owner,
		};
	if (inProgress)
		return {
			kind: "running",
			label:
				active?.state === "queued" || build.state === "queued"
					? "Build queued"
					: "Building",
			action: active
				? `${active.name} · ${active.detail}`
				: `Wait for ${build.name}`,
			owner: active?.owner ?? "Build agents",
		};
	return null;
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
	const add = (
		kind: PullIssue["kind"],
		label: string,
		action: string,
		who = owner,
	) => issues.push({ kind, label, action, owner: who });
	if (pr.mergeable === "conflicts")
		add(
			"blocked",
			"Merge conflict",
			`Resolve conflicts with ${pr.targetBranch}`,
			pr.author.name,
		);
	const changes = pr.reviewers.filter((r) => r.vote === "changes_requested");
	if (changes.length)
		add(
			"blocked",
			"Changes requested",
			`Address ${changes.map((r) => r.name).join(" and ")}'s review feedback`,
			pr.author.name,
		);
	for (const policy of pr.policies.filter((p) => p.required)) {
		if (isFailed(policy.state))
			add("blocked", "Policy failed", policy.detail, policy.owner);
		else if (policy.state === "waiting")
			add("approval", "Approval needed", policy.detail, policy.owner);
		else if (policy.state === "running" || policy.state === "queued")
			add("running", "Checks running", policy.detail, policy.owner);
		else if (policy.state !== "passed")
			add(
				"unknown",
				"Check unavailable",
				`Verify ${policy.name.toLowerCase()}`,
				policy.owner,
			);
	}
	for (const build of pr.builds.filter((b) => b.required)) {
		const issue = buildIssue(build, pr.author.name, owner);
		if (issue) issues.push(issue);
	}
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
		);
	}
	if (!project.enabled)
		add(
			"unknown",
			"Monitoring paused",
			"Resume monitoring and scan this project",
		);
	else if (
		pr.coverage === "partial" ||
		pr.mergeable === "unknown" ||
		project.scanState === "failed"
	)
		add(
			"unknown",
			"Scan incomplete",
			"Rescan to retrieve the missing PR checks",
		);
	issues.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
	const first = issues[0];
	return first
		? { ...first, issues }
		: {
				kind: "ready",
				label: "Ready to merge",
				action: `Merge into ${pr.targetBranch}`,
				owner,
				issues,
			};
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

export function projectUrl(project: Project): string {
	return project.provider === "ado"
		? `https://dev.azure.com/${encodeURIComponent(project.organization)}/${encodeURIComponent(project.projectKey)}`
		: `https://github.com/${encodeURIComponent(project.organization)}/${encodeURIComponent(project.projectKey)}`;
}

export function pullUrl(project: Project, pr: PullRequest): string {
	return project.provider === "ado"
		? `${projectUrl(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.number}`
		: `https://github.com/${encodeURIComponent(project.organization)}/${encodeURIComponent(pr.repository.name)}/pull/${pr.number}`;
}
