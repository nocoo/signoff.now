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
const readinessRuleSchema = z.union([
	z.object({ kind: readinessKindSchema, color: readinessColorSchema }).strict(),
	z.object({ policy: name, label: name, color: readinessColorSchema }).strict(),
]);
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
export const DEFAULT_READINESS_RULES: ReadinessRule[] = [
	{ kind: "ready", color: "green" },
	{ kind: "approval", color: "yellow" },
	{ kind: "review", color: "orange" },
	{ kind: "running", color: "blue" },
	{ kind: "unknown", color: "gray" },
	{ kind: "blocked", color: "red" },
	{ kind: "draft", color: "gray" },
	{ kind: "merged", color: "purple" },
	{ kind: "closed", color: "gray" },
];
export function readinessRuleKey(rule: ReadinessRule): string {
	return "kind" in rule
		? `kind:${rule.kind}`
		: `policy:${rule.policy.trim().toLowerCase()}`;
}
export const readinessRulesSchema = z
	.array(readinessRuleSchema)
	.max(50)
	.refine(
		(rules) =>
			!rules.length ||
			(new Set(rules.map(readinessRuleKey)).size === rules.length &&
				readinessKindSchema.options.every((kind) =>
					rules.some((rule) => "kind" in rule && rule.kind === kind),
				)),
		"Include every readiness state once, with no duplicate policy rules",
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
const scopedPullIdsSchema = z
	.array(name)
	.max(20)
	.refine((ids) => new Set(ids).size === ids.length, "PR IDs must be unique");
export const scanRequestSchema = revisionSchema.extend({
	pullIds: scopedPullIdsSchema.optional(),
});

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
	headSha: z.string().max(240).nullable().optional(),
	checksObservedAt: instant.nullable().optional(),
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
	/** Omitted: full scan. Empty: list only. Otherwise: selected PR checks. */
	pullIds: scopedPullIdsSchema.optional(),
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

export type PullIssue = {
	kind: "blocked" | "approval" | "review" | "running" | "unknown";
	label: string;
	action: string;
	owner: string;
	policy?: string;
};
export type PullReadiness = {
	kind: ReadinessKind;
	label: string;
	action: string;
	owner: string;
	policy?: string;
	issues: PullIssue[];
};
export function projectReadinessRules(project: Project): ReadinessRule[] {
	return project.readinessRules?.length
		? project.readinessRules
		: DEFAULT_READINESS_RULES;
}

/** Smaller ranks are closer to ready; named policy rules precede kind fallbacks. */
export function readinessPriority(
	readiness: Pick<PullReadiness, "kind" | "policy">,
	project: Project,
): number {
	const rules = projectReadinessRules(project);
	const policy = readiness.policy?.trim().toLowerCase();
	const index =
		policy === undefined
			? -1
			: rules.findIndex(
					(rule) =>
						"policy" in rule && rule.policy.trim().toLowerCase() === policy,
				);
	return index >= 0
		? index
		: rules.findIndex((rule) => "kind" in rule && rule.kind === readiness.kind);
}
export function readinessColor(
	readiness: Pick<PullReadiness, "kind" | "policy">,
	project: Project,
): ReadinessColor {
	return (
		projectReadinessRules(project)[
			readinessPriority(readiness, project)
		] as ReadinessRule
	).color;
}

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
		policy?: string,
	) =>
		issues.push({
			kind,
			label,
			action,
			owner: who,
			...(policy === undefined ? {} : { policy }),
		});
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
			add("blocked", "Policy failed", policy.detail, policy.owner, policy.name);
		else if (policy.state === "waiting")
			add(
				"approval",
				"Approval needed",
				policy.detail,
				policy.owner,
				policy.name,
			);
		else if (policy.state === "running" || policy.state === "queued")
			add(
				"running",
				"Checks running",
				policy.detail,
				policy.owner,
				policy.name,
			);
		else if (policy.state !== "passed")
			add(
				"unknown",
				"Check unavailable",
				`Verify ${policy.name.toLowerCase()}`,
				policy.owner,
				policy.name,
			);
	}
	for (const build of pr.builds.filter((b) => b.required)) {
		issues.push(...buildIssues(build, pr.author.name, owner));
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
	else if (pr.checksObservedAt === null)
		add(
			"unknown",
			"Awaiting checks",
			"Enable auto refresh on this page to collect policies, builds, and stages",
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
	const uniqueIssues = [
		...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values(),
	]
		.map((issue) => {
			const rule = projectReadinessRules(project)[
				readinessPriority(issue, project)
			] as ReadinessRule;
			return "policy" in rule ? { ...issue, label: rule.label } : issue;
		})
		.sort(
			(a, b) => readinessPriority(b, project) - readinessPriority(a, project),
		);
	const first = uniqueIssues[0];
	return first
		? { ...first, issues: uniqueIssues }
		: {
				kind: "ready",
				label: "Ready to merge",
				action: `Merge into ${pr.targetBranch}`,
				owner,
				issues: uniqueIssues,
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
		: `https://github.com/${encodeURIComponent(project.projectKey)}`;
}

export function pullUrl(project: Project, pr: PullRequest): string {
	return project.provider === "ado"
		? `${projectUrl(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.number}`
		: `${projectUrl(project)}/${encodeURIComponent(pr.repository.name)}/pull/${pr.number}`;
}
