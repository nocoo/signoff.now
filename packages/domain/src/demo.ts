import {
	type Build,
	type BuildStage,
	type CheckState,
	type Project,
	type PullRequest,
	projectSchema,
	pullRequestSchema,
	type ScanRun,
} from "./workbench.js";

type Scenario =
	| "failed"
	| "canceled"
	| "policy"
	| "approval"
	| "presence"
	| "running"
	| "queued"
	| "conflict"
	| "review"
	| "changes"
	| "ready"
	| "optional"
	| "draft"
	| "merged"
	| "closed"
	| "unknown";

const PEOPLE = [
	{ id: "maya", name: "Maya Chen" },
	{ id: "alex", name: "Alex Morgan" },
	{ id: "nina", name: "Nina Patel" },
	{ id: "james", name: "James Wilson" },
	{ id: "luis", name: "Luis Romero" },
	{ id: "sarah", name: "Sarah Park" },
	{ id: "noah", name: "Noah Kim" },
	{ id: "emma", name: "Emma Davis" },
] as const;
const person = (index: number) => PEOPLE[index % PEOPLE.length] ?? PEOPLE[0];

const CATALOG: readonly {
	id: string;
	provider: Project["provider"];
	name: string;
	organization: string;
	projectKey: string;
	owner: string;
	description: string;
	repositories: string[];
	firstNumber: number;
	pulls: [Scenario, string][];
}[] = [
	{
		id: "demo-platform",
		provider: "ado",
		name: "Core Platform",
		organization: "northstar-demo",
		projectKey: "Platform",
		owner: "Maya Chen",
		description: "Shared infrastructure, identity, and service foundations.",
		repositories: ["api-gateway", "identity-service", "platform-sdk"],
		firstNumber: 4821,
		pulls: [
			["failed", "Fix token refresh race in concurrent sessions"],
			["approval", "Roll out regional failover for the gateway"],
			["running", "Add streaming responses to the SDK"],
			["conflict", "Consolidate tenant routing configuration"],
			["review", "Introduce scoped service credentials"],
			["changes", "Cache organization membership lookups"],
			["ready", "Propagate trace context across service calls"],
			["optional", "Reduce cold-start allocations in the SDK"],
			["draft", "Design a shared rate-limiting middleware"],
			["queued", "Upgrade the gateway runtime to Node 24"],
			["merged", "Correct retry backoff for transient failures"],
			["policy", "Update the authentication dependency tree"],
		],
	},
	{
		id: "demo-commerce",
		provider: "ado",
		name: "Commerce",
		organization: "northstar-demo",
		projectKey: "Commerce",
		owner: "Luis Romero",
		description: "Checkout, billing, and the order lifecycle.",
		repositories: ["checkout", "billing-api", "orders"],
		firstNumber: 2164,
		pulls: [
			["failed", "Make payment webhooks idempotent"],
			["canceled", "Add tax calculation for European markets"],
			["review", "Support partial refunds on split orders"],
			["running", "Persist checkout recovery sessions"],
			["presence", "Enable the new billing reconciliation job"],
			["ready", "Validate inventory before confirming an order"],
			["draft", "Introduce multi-currency price display"],
			["merged", "Handle duplicate invoice notifications"],
			["merged", "Backfill missing fulfillment timestamps"],
			["closed", "Replace the legacy payment retry queue"],
		],
	},
	{
		id: "demo-devex",
		provider: "ado",
		name: "Developer Experience",
		organization: "fabrikam-demo",
		projectKey: "Developer Experience",
		owner: "Nina Patel",
		description: "Build systems and tools that keep engineering moving.",
		repositories: ["build-tools", "developer-portal", "dev-cli"],
		firstNumber: 907,
		pulls: [
			["running", "Cache dependency graphs between pipeline runs"],
			["review", "Add ownership insights to the service catalog"],
			["ready", "Explain failed authentication in CLI output"],
			["optional", "Parallelize independent workspace builds"],
			["queued", "Refresh the preview environment pool"],
			["draft", "Prototype local secrets synchronization"],
			["merged", "Expose pipeline duration in build summaries"],
			["closed", "Experiment with a shared dependency cache"],
			["unknown", "Publish signed CLI binaries for Windows"],
		],
	},
	{
		id: "demo-mobile",
		provider: "ado",
		name: "Mobile Apps",
		organization: "northstar-demo",
		projectKey: "Mobile",
		owner: "Noah Kim",
		description: "Native clients and the shared mobile experience.",
		repositories: ["ios-client", "android-client", "shared-ui"],
		firstNumber: 1530,
		pulls: [
			["changes", "Restore offline drafts after app suspension"],
			["review", "Improve biometric sign-in recovery"],
			["failed", "Keep navigation state across deep links"],
			["ready", "Announce connection changes to screen readers"],
			["draft", "Add a compact layout for small screens"],
			["merged", "Fix attachment previews in dark mode"],
			["closed", "Experiment with predictive list prefetching"],
		],
	},
	{
		id: "demo-github-nocoo",
		provider: "github",
		name: "nocoo",
		organization: "github.com",
		projectKey: "nocoo",
		owner: "Maya Chen",
		description: "GitHub repositories and Actions in the shared PR workbench.",
		repositories: ["signoff.now"],
		firstNumber: 101,
		pulls: [
			["failed", "Keep reviewer votes in sync after new commits"],
			["review", "Add repository ownership to the PR queue"],
			["running", "Run browser checks for the compact workbench"],
			["ready", "Preserve filters between workbench visits"],
			["approval", "Publish the preview after environment approval"],
			["draft", "Explore issue triage alongside pull requests"],
			["merged", "Improve keyboard navigation in PR details"],
			["closed", "Experiment with a daily review digest"],
		],
	},
];

function stage(
	id: string,
	label: string,
	state: CheckState,
	owner: string,
	detail = "Completed successfully",
): BuildStage {
	return {
		id,
		name: label,
		state,
		required: true,
		detail,
		owner,
		durationSeconds:
			state === "queued" || state === "waiting" || state === "unknown"
				? null
				: 42 + label.length * 13,
	};
}

function buildsFor(
	scenario: Scenario,
	number: number,
	author: string,
	owner: string,
): Build[] {
	const validation: Build = {
		id: "validation",
		name: "PR validation",
		number: number * 10 + 1,
		required: true,
		state: "passed",
		stages: [
			stage("install", "Install", "passed", "Build agents"),
			stage("compile", "Build", "passed", "Build agents"),
			stage("unit", "Unit tests", "passed", author),
			stage("integration", "Integration", "passed", author),
		],
	};
	const release: Build = {
		id: "release",
		name: "Release readiness",
		number: number * 10 + 2,
		required: true,
		state: "passed",
		stages: [
			stage("package", "Package", "passed", "Build agents"),
			stage("security", "Security", "passed", owner),
			stage("preview", "Staging", "passed", owner),
		],
	};
	if (scenario === "failed") {
		validation.state = "failed";
		validation.stages[2] = stage(
			"unit",
			"Unit tests",
			"failed",
			author,
			"Fix the failing regression test and rerun validation",
		);
		validation.stages[3] = stage(
			"integration",
			"Integration",
			"skipped",
			author,
			"Blocked by the failed unit test stage",
		);
	} else if (scenario === "canceled") {
		validation.state = "canceled";
		validation.stages[2] = stage(
			"unit",
			"Unit tests",
			"canceled",
			author,
			"Rerun validation; the agent was interrupted",
		);
		validation.stages[3] = stage(
			"integration",
			"Integration",
			"skipped",
			author,
			"The upstream stage was canceled",
		);
	} else if (scenario === "running") {
		validation.state = "running";
		validation.stages[2] = stage(
			"unit",
			"Unit tests",
			"running",
			"Build agents",
			"284 of 412 tests complete",
		);
		validation.stages[3] = stage(
			"integration",
			"Integration",
			"queued",
			"Build agents",
			"Waiting for unit tests",
		);
	} else if (scenario === "queued" || scenario === "draft") {
		validation.state = "queued";
		validation.stages = validation.stages.map((s) => ({
			...s,
			state: "queued",
			durationSeconds: null,
			detail:
				scenario === "draft"
					? "Starts when the PR is published"
					: "Waiting for a hosted build agent",
		}));
	} else if (scenario === "approval") {
		release.state = "waiting";
		release.stages[2] = stage(
			"preview",
			"Staging",
			"waiting",
			owner,
			"Approve deployment to the staging environment",
		);
	} else if (scenario === "unknown") {
		release.state = "unknown";
		release.stages[1] = stage(
			"security",
			"Security",
			"unknown",
			owner,
			"The build timeline could not be retrieved",
		);
	}
	const result = [validation, release];
	if (scenario === "optional" || scenario === "failed") {
		result.push({
			id: "compatibility",
			name: "Compatibility matrix",
			number: number * 10 + 3,
			required: scenario === "failed",
			state: scenario === "optional" ? "failed" : "running",
			stages: [
				stage("linux", "Linux", "passed", "Build agents"),
				stage(
					"windows",
					"Windows",
					scenario === "optional" ? "failed" : "running",
					author,
					scenario === "optional"
						? "An advisory benchmark exceeded the performance budget"
						: "Running the Windows compatibility suite",
				),
				stage("macos", "macOS", "passed", "Build agents"),
			],
		});
	}
	return result;
}

const ACTIVITY_TITLES: Record<Scenario, string> = {
	failed: "PR validation failed",
	canceled: "PR validation was canceled",
	policy: "Dependency policy blocked the pull request",
	approval: "Deployment is waiting for approval",
	presence: "Only Proof of Presence human verification remains",
	running: "PR validation is running",
	queued: "PR validation is waiting for a build agent",
	conflict: "Merge conflicts detected",
	review: "Requested a required review",
	changes: "Reviewer requested changes",
	ready: "All required gates passed",
	optional: "Required gates passed with advisory failures",
	draft: "Saved a draft pull request",
	merged: "Pull request merged",
	closed: "Pull request closed",
	unknown: "Incomplete build timeline",
};

function descriptionFor(scenario: Scenario, title: string): string {
	return scenario === "presence"
		? `## Summary\n\n${title}.\n\nThe automated checks and required reviews are complete. **Proof of Presence (PoP)** needs human verification before merging.\n\n### Validation\n\n| Gate | Status |\n| --- | --- |\n| Build and tests | Passed |\n| Code review | Approved |\n| PoP | Awaiting human verification |\n\n- [x] Automated validation\n- [x] Required reviews\n- [ ] Complete PoP in Azure DevOps`
		: `## Summary\n\n${title}.\n\nIncludes **regression coverage** and a staged rollout. Review the required checks and deployment gates before merging.`;
}

export function makeDemoPulls(project: Project, now: number): PullRequest[] {
	const definition = CATALOG.find((d) => d.id === project.id);
	const templates: readonly [Scenario, string][] = definition?.pulls ?? [
		["failed", "Fix retry handling for interrupted requests"],
		["review", "Add project-level configuration"],
		["running", "Improve build cache reuse"],
		["approval", "Enable staged deployment checks"],
		["ready", "Document the service ownership model"],
		["draft", "Introduce a shared health endpoint"],
	];
	const repositories = definition?.repositories ?? ["services", "web-client"];
	const linkedWork = project.provider === "github" ? "issue" : "work item";
	const buildActor =
		project.provider === "github" ? "GitHub Actions" : "Azure Pipelines";
	return templates.map(([scenario, title], index) => {
		const number = (definition?.firstNumber ?? 100) + index;
		const id = `${project.id}-pr-${number}`;
		const author = person(index);
		const repositoryName =
			repositories[index % repositories.length] ?? "services";
		const createdAt = now - ((index % 5) + 1) * 86400 - 2400;
		const updatedAt = now - (index * 11 + 4) * 60;
		return pullRequestSchema.parse({
			id,
			projectId: project.id,
			externalId: String(number),
			number,
			repository: {
				id: `${project.id}-${repositoryName}`,
				name: repositoryName,
			},
			title,
			description: descriptionFor(scenario, title),
			author,
			sourceBranch: `${scenario === "failed" || scenario === "conflict" ? "fix" : "feature"}/${title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.slice(0, 52)}`,
			targetBranch: "main",
			state: scenario === "merged" || scenario === "closed" ? scenario : "open",
			draft: scenario === "draft",
			mergeable:
				scenario === "conflict"
					? "conflicts"
					: scenario === "unknown"
						? "unknown"
						: "clear",
			coverage: scenario === "unknown" ? "partial" : "complete",
			createdAt,
			updatedAt,
			observedAt: project.lastScannedAt ?? now,
			requiredApprovals: 2,
			reviewers: [
				{ ...person(index + 1), vote: "approved", required: true },
				{
					...person(index + 3),
					vote:
						scenario === "review" || scenario === "draft"
							? "pending"
							: scenario === "changes"
								? "changes_requested"
								: "approved",
					required: true,
				},
			],
			policies: [
				...(scenario === "presence"
					? [
							{
								id: "proof-of-presence",
								name: "Proof Of Presence",
								state: "failed",
								required: true,
								detail: "Human verification is required in Azure DevOps.",
								owner: author.name,
							},
						]
					: []),
				{
					id: "linked-work",
					name: `Linked ${linkedWork}`,
					state: "passed",
					required: true,
					detail: `Linked to ${linkedWork} #${7600 + index}`,
					owner: author.name,
				},
				{
					id: "comments",
					name: "Resolved conversations",
					state: "passed",
					required: true,
					detail: "All blocking conversations are resolved",
					owner: author.name,
				},
				{
					id: "dependency",
					name: "Dependency policy",
					state: scenario === "policy" ? "failed" : "passed",
					required: true,
					detail:
						scenario === "policy"
							? "Upgrade the dependency with a high-severity finding"
							: "No restricted or vulnerable dependencies",
					owner: author.name,
				},
				{
					id: "coverage",
					name: "Coverage trend",
					state: scenario === "optional" ? "failed" : "passed",
					required: false,
					detail:
						scenario === "optional"
							? "Coverage decreased by 0.4%; this is advisory"
							: "Coverage is above the project baseline",
					owner: author.name,
				},
			],
			builds: buildsFor(scenario, number, author.name, project.owner),
			labels:
				scenario === "failed" || scenario === "policy"
					? ["release blocker", "bug"]
					: scenario === "draft"
						? ["proposal"]
						: ["enhancement"],
			filesChanged: 3 + index * 2,
			additions: 48 + index * 31,
			deletions: 9 + index * 7,
			comments: 2 + index * 3,
			activity: [
				{
					id: `${id}-opened`,
					at: createdAt,
					actor: author.name,
					title: "Opened the pull request",
					detail: `Proposed changes from ${repositoryName}`,
				},
				{
					id: `${id}-review`,
					at: updatedAt - 900,
					actor: person(index + 1).name,
					title: "Approved the latest iteration",
					detail: "Required reviewer · approval applies to the current changes",
				},
				{
					id: `${id}-build`,
					at: updatedAt,
					actor: buildActor,
					title: ACTIVITY_TITLES[scenario],
					detail:
						scenario === "failed"
							? "Unit tests failed. Downstream integration tests were skipped."
							: "Build and policy results are shown in Checks & builds.",
				},
			],
		});
	});
}

export function demoWorkspace(now: number): {
	projects: Project[];
	pullRequests: PullRequest[];
	scans: ScanRun[];
} {
	const projects = CATALOG.map((d, index) =>
		projectSchema.parse({
			id: d.id,
			name: d.name,
			provider: d.provider,
			organization: d.organization,
			projectKey: d.projectKey,
			repositories: d.repositories,
			description: d.description,
			owner: d.owner,
			enabled: true,
			source: "demo",
			revision: 1,
			createdAt: now - 30 * 86400,
			updatedAt: now - 600,
			lastScannedAt: now - 45 - index * 27,
			scanState: d.pulls.some(([scenario]) => scenario === "unknown")
				? "partial"
				: "complete",
			scanMessage:
				d.id === "demo-devex"
					? "One build timeline is unavailable. Rescan to retrieve the missing checks."
					: null,
		}),
	);
	const pullRequests = projects.flatMap((p) => makeDemoPulls(p, now));
	const scans: ScanRun[] = projects.map((p) => ({
		id: `${p.id}-initial-scan`,
		projectId: p.id,
		source: "demo",
		state: p.scanState === "partial" ? "partial" : "complete",
		startedAt: (p.lastScannedAt ?? now) - 8,
		completedAt: p.lastScannedAt ?? now,
		pullRequestCount: pullRequests.filter((pr) => pr.projectId === p.id).length,
		advancedStages: 0,
		message: p.scanMessage ?? "All repository PRs and checks were scanned.",
	}));
	return { projects, pullRequests, scans };
}

function buildState(stages: BuildStage[]): CheckState {
	const required = stages.filter((s) => s.required);
	for (const state of [
		"failed",
		"canceled",
		"waiting",
		"unknown",
		"running",
		"queued",
		"skipped",
	] as const) {
		if (required.some((s) => s.state === state)) return state;
	}
	return "passed";
}

/** Only demo scans call this. Human decisions and failed gates remain blocked. */
export function advanceDemoPull(
	pr: PullRequest,
	now: number,
	scanId: string,
): { pull: PullRequest; advancedStages: number } {
	const pull = structuredClone(pr);
	pull.observedAt = now;
	let advancedStages = 0;
	if (pull.state !== "open" || pull.draft) return { pull, advancedStages };
	const recovered = pull.coverage === "partial";
	if (recovered) {
		pull.coverage = "complete";
		if (pull.mergeable === "unknown") pull.mergeable = "clear";
		for (const policy of pull.policies) {
			if (policy.state === "unknown") {
				policy.state = "passed";
				policy.detail = "Retrieved successfully on rescan";
			}
		}
	}
	for (const build of pull.builds) {
		for (const s of build.stages) {
			if (recovered && s.state === "unknown") {
				s.state = "passed";
				s.detail = "Timeline recovered; stage passed";
				s.durationSeconds = 126;
				advancedStages++;
			}
		}
		const index = build.stages.findIndex(
			(s) => s.state === "running" || s.state === "queued",
		);
		if (
			index >= 0 &&
			build.stages
				.slice(0, index)
				.every(
					(s) => s.state === "passed" || (s.state === "skipped" && !s.required),
				)
		) {
			const active = build.stages[index];
			if (active) {
				active.state = active.state === "queued" ? "running" : "passed";
				active.detail =
					active.state === "running"
						? "A build agent is executing this stage"
						: "Completed successfully";
				active.durationSeconds = (active.durationSeconds ?? 0) + 45;
				advancedStages++;
			}
		}
		build.state = buildState(build.stages);
	}
	if (advancedStages || recovered) {
		pull.updatedAt = now;
		pull.activity.push({
			id: `${scanId}-${pr.id}`,
			at: now,
			actor: "Demo scanner",
			title: recovered
				? "Recovered missing check results"
				: `Updated ${advancedStages} build stage${advancedStages === 1 ? "" : "s"}`,
			detail:
				"Simulated progress; approvals, review feedback, and failures still require attention.",
		});
		pull.activity = pull.activity.slice(-12);
	}
	return { pull, advancedStages };
}
