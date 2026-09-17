import {
	type MergeRequirement,
	type Project,
	type PullRequest,
	projectMergeRequirements,
} from "@signoff/domain/workbench";
import { AdoError, type AdoPagedClient, adoUrl } from "../ado/client.js";
import {
	type BuildWithStages,
	normalizeBuildStages,
	normalizePolicy,
	normalizePullRequest,
	parseSeconds,
} from "./normalize.js";
import {
	type AdoBuild,
	type AdoEvaluation,
	type AdoPullRequestSummary,
	type AdoStatus,
	adoBuildSchema,
	adoBuildsSchema,
	adoBuildTimelineSchema,
	adoEvaluationsSchema,
	adoIterationChangesSchema,
	adoIterationsSchema,
	adoPolicyConfigurationsSchema,
	adoPullRequestSummarySchema,
	adoPullRequestsSchema,
	adoRepositoriesSchema,
	adoStatusesSchema,
	adoThreadsSchema,
	parseRaw,
} from "./raw.js";

const DEFAULT_CONCURRENCY = 4;
const BASE_URL = "https://dev.azure.com";
const BUILD_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";

export type RepoMeta = {
	id: string;
	name: string;
	projectGuid: string;
};

export function policyArtifactId(
	projectGuid: string,
	pullRequestId: number,
): string {
	return `vstfs:///CodeReview/CodeReviewId/${projectGuid}/${pullRequestId}`;
}

export function policyEvaluationsUrl(
	org: string,
	projectGuid: string,
	prId: number,
): string {
	return adoUrl(
		`${BASE_URL}/${org}/${projectGuid}`,
		"_apis/policy/evaluations",
		{ artifactId: policyArtifactId(projectGuid, prId) },
		"7.1-preview.1",
	);
}

function boundedIssue(message: string): string {
	return message.length > 1000 ? message.slice(0, 1000) : message;
}

function issueMessage(error: unknown, fallback: string): string {
	return boundedIssue(error instanceof Error ? error.message : fallback);
}

export async function discoverRepositories(
	client: AdoPagedClient,
	project: Project,
): Promise<RepoMeta[]> {
	const org = project.organization;
	const projectKey = project.projectKey;
	const allRepos: RepoMeta[] = [];
	const seenTokens = new Set<string>();
	let token: string | null = null;

	try {
		for (;;) {
			const reposUrl = adoUrl(
				`${BASE_URL}/${org}/${encodeURIComponent(projectKey)}`,
				"_apis/git/repositories",
				token ? { continuationToken: token } : {},
			);
			const page = await client.getPage(reposUrl);
			const parsedRepos = parseRaw(
				adoRepositoriesSchema,
				page.data,
				"repositories list",
			);
			for (const r of parsedRepos.value) {
				allRepos.push({
					id: r.id,
					name: r.name,
					projectGuid: r.project.id,
				});
			}
			if (!page.continuationToken) break;
			if (seenTokens.has(page.continuationToken)) {
				throw new AdoError(
					"bad_response",
					`Repeated continuation token while listing repositories for ${org}/${projectKey}`,
				);
			}
			seenTokens.add(page.continuationToken);
			token = page.continuationToken;
			if (parsedRepos.value.length === 0) break;
		}
	} catch (e) {
		if (e instanceof AdoError) throw e;
		throw new AdoError(
			"bad_request",
			`Failed to list repositories for ${org}/${projectKey}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	if (!project.repositories || project.repositories.length === 0) {
		return allRepos;
	}

	const targetRepos: RepoMeta[] = [];
	for (const requested of project.repositories) {
		const found = allRepos.find(
			(r) =>
				r.name.toLowerCase() === requested.toLowerCase() ||
				r.id.toLowerCase() === requested.toLowerCase(),
		);
		if (!found) {
			throw new AdoError(
				"not_found",
				`Repository "${requested}" not found in project ${org}/${projectKey}`,
			);
		}
		targetRepos.push(found);
	}
	return targetRepos;
}

export async function enumerateActivePullRequests(
	client: AdoPagedClient,
	org: string,
	repo: RepoMeta,
): Promise<AdoPullRequestSummary[]> {
	const activePrs: AdoPullRequestSummary[] = [];
	let skip = 0;
	const top = 100;
	const seenActiveIds = new Set<number>();
	const seenTokens = new Set<string>();
	let token: string | null = null;
	let activeFinished = false;

	while (!activeFinished) {
		const activeUrl = adoUrl(
			`${BASE_URL}/${org}/${repo.projectGuid}`,
			`_apis/git/repositories/${repo.id}/pullrequests`,
			{
				"searchCriteria.status": "active",
				$top: top,
				$skip: skip,
				continuationToken: token ?? undefined,
			},
		);
		let page: Awaited<ReturnType<typeof client.getPage>>;
		try {
			page = await client.getPage(activeUrl);
		} catch (e) {
			if (e instanceof AdoError) throw e;
			throw new AdoError(
				"bad_request",
				`Failed to enumerate active PRs for repo ${repo.name}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		const parsedPage = parseRaw(
			adoPullRequestsSchema,
			page.data,
			"active PRs page",
		);
		if (parsedPage.value.length === 0) {
			break;
		}

		for (const pr of parsedPage.value) {
			if (seenActiveIds.has(pr.pullRequestId)) {
				throw new AdoError(
					"bad_response",
					`Repeated or cyclic PR ${pr.pullRequestId} detected while enumerating active PRs for ${repo.name}`,
				);
			}
			seenActiveIds.add(pr.pullRequestId);
			activePrs.push(pr);
		}

		if (page.continuationToken) {
			if (seenTokens.has(page.continuationToken)) {
				throw new AdoError(
					"bad_response",
					`Repeated continuation token while enumerating active PRs for ${repo.name}`,
				);
			}
			seenTokens.add(page.continuationToken);
			token = page.continuationToken;
			skip += parsedPage.value.length;
		} else if (parsedPage.value.length < top) {
			activeFinished = true;
		} else {
			token = null;
			skip += top;
		}

		if (skip > 10_000) {
			throw new AdoError(
				"bad_response",
				`Active PR list exceeded 10,000 items in ${repo.name}`,
			);
		}
	}

	return activePrs;
}

/** Project policy configurations include requirements absent from the currently open page. */
export async function discoverMergeRequirements(
	client: AdoPagedClient,
	project: Project,
	repositories: RepoMeta[],
): Promise<MergeRequirement[]> {
	const ids = new Set(repositories.map((repo) => repo.id.toLowerCase()));
	const gates = new Map<string, MergeRequirement>();
	const tokens = new Set<string>();
	let token: string | null = null;
	for (;;) {
		const url = adoUrl(
			`${BASE_URL}/${project.organization}/${encodeURIComponent(project.projectKey)}`,
			"_apis/policy/configurations",
			{ $top: 100, continuationToken: token ?? undefined },
		);
		const page = await client.getPage(url);
		for (const configuration of parseRaw(
			adoPolicyConfigurationsSchema,
			page.data,
			"project policies",
		).value) {
			if (
				configuration.isEnabled === false ||
				configuration.isBlocking === false
			)
				continue;
			const scope = configuration.settings?.scope;
			const scopes = Array.isArray(scope)
				? scope.filter(
						(value): value is Record<string, unknown> =>
							typeof value === "object" && value !== null,
					)
				: [];
			const applicable = scopes.filter(
				(entry) =>
					!entry.repositoryId ||
					(typeof entry.repositoryId === "string" &&
						ids.has(entry.repositoryId.toLowerCase())),
			);
			if (scopes.length && !applicable.length) continue;
			const policy = normalizePolicy({ configuration });
			const minimum = configuration.settings?.minimumApproverCount;
			const detail = [
				typeof minimum === "number" ? `${minimum} approvals` : "",
				...new Set(
					applicable.map((entry) =>
						typeof entry.refName === "string"
							? entry.refName.replace(/^refs\/heads\//, "")
							: "All branches",
					),
				),
			]
				.filter(Boolean)
				.join(" · ")
				.slice(0, 1000);
			gates.set(policy.id, {
				id: policy.id,
				name: policy.name,
				kind: policy.kind ?? "policy",
				definitionId: policy.definitionId,
				detail,
			});
		}
		if (gates.size > 1000)
			throw new AdoError(
				"bad_response",
				"Project has more than 1,000 merge requirements; narrow its repository scope.",
			);
		if (!page.continuationToken) break;
		if (tokens.has(page.continuationToken))
			throw new AdoError(
				"bad_response",
				"Policy configuration pagination repeated a token",
			);
		tokens.add(page.continuationToken);
		token = page.continuationToken;
	}
	return [...gates.values()];
}

export async function enumerateRecentHistory(
	client: AdoPagedClient,
	org: string,
	repo: RepoMeta,
): Promise<{
	completed: AdoPullRequestSummary[];
	abandoned: AdoPullRequestSummary[];
	issues: string[];
}> {
	const issues: string[] = [];
	const completed: AdoPullRequestSummary[] = [];
	const abandoned: AdoPullRequestSummary[] = [];

	const completedUrl = adoUrl(
		`${BASE_URL}/${org}/${repo.projectGuid}`,
		`_apis/git/repositories/${repo.id}/pullrequests`,
		{
			"searchCriteria.status": "completed",
			$top: 20,
		},
	);
	try {
		const res = await client.get(completedUrl);
		const parsed = parseRaw(adoPullRequestsSchema, res, "completed PRs");
		completed.push(...parsed.value.slice(0, 20));
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
		issues.push(
			`Recent completed PRs unavailable: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	const abandonedUrl = adoUrl(
		`${BASE_URL}/${org}/${repo.projectGuid}`,
		`_apis/git/repositories/${repo.id}/pullrequests`,
		{
			"searchCriteria.status": "abandoned",
			$top: 10,
		},
	);
	try {
		const res = await client.get(abandonedUrl);
		const parsed = parseRaw(adoPullRequestsSchema, res, "abandoned PRs");
		abandoned.push(...parsed.value.slice(0, 10));
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
		issues.push(
			`Recent abandoned PRs unavailable: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	return { completed, abandoned, issues };
}

export class BuildService {
	private readonly buildCache = new Map<number, AdoBuild>();
	private readonly timelineCache = new Map<number, BuildWithStages>();

	constructor(
		private readonly client: AdoPagedClient,
		private readonly org: string,
	) {}

	async fetchBuildWithStages(
		buildId: number,
		projectGuid: string,
		required = true,
	): Promise<BuildWithStages> {
		const cached = this.timelineCache.get(buildId);
		if (cached) {
			return { ...cached, required };
		}

		let build = this.buildCache.get(buildId);
		if (!build) {
			const buildUrl = adoUrl(
				`${BASE_URL}/${this.org}/${projectGuid}`,
				`_apis/build/builds/${buildId}`,
			);
			const rawBuild = await this.client.get(buildUrl);
			build = parseRaw(adoBuildSchema, rawBuild, `build ${buildId}`);
			this.buildCache.set(buildId, build);
		}

		const timelineUrl = adoUrl(
			`${BASE_URL}/${this.org}/${projectGuid}`,
			`_apis/build/builds/${buildId}/timeline`,
		);
		let stages: ReturnType<typeof normalizeBuildStages> = [];
		let collectionIssues: string[] | undefined;
		try {
			const rawTimeline = await this.client.get(timelineUrl);
			const parsedTimeline = parseRaw(
				adoBuildTimelineSchema,
				rawTimeline,
				`build timeline ${buildId}`,
			);
			stages = normalizeBuildStages(parsedTimeline.records);
		} catch (e) {
			if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
			const status = (build.status || "").toLowerCase();
			const expectedMissing =
				e instanceof AdoError &&
				e.kind === "not_found" &&
				(status === "notstarted" || status === "queued");
			if (!expectedMissing) {
				collectionIssues = [`Build ${buildId} timeline is unavailable`];
			}
		}
		if (
			!collectionIssues &&
			stages.length === 0 &&
			((build.status || "").toLowerCase() === "completed" ||
				Boolean(build.result))
		) {
			collectionIssues = [`Build ${buildId} timeline is empty`];
		}

		const result: BuildWithStages = {
			build,
			stages,
			required,
			collectionIssues,
		};
		this.timelineCache.set(buildId, result);
		return result;
	}
}

async function fetchPrEvaluationsAndStatuses(
	client: AdoPagedClient,
	org: string,
	projectGuid: string,
	repoId: string,
	prId: number,
	issues: string[],
): Promise<{ evaluations: AdoEvaluation[]; statuses: AdoStatus[] }> {
	let evaluations: AdoEvaluation[] = [];
	const evalUrl = policyEvaluationsUrl(org, projectGuid, prId);
	try {
		const res = await client.get(evalUrl);
		evaluations = parseRaw(
			adoEvaluationsSchema,
			res,
			`policy evaluations for PR ${prId}`,
		).value;
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
		issues.push(
			`Policy evaluations unavailable: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	let statuses: AdoStatus[] = [];
	const statusUrl = adoUrl(
		`${BASE_URL}/${org}/${projectGuid}`,
		`_apis/git/repositories/${repoId}/pullRequests/${prId}/statuses`,
	);
	try {
		const res = await client.get(statusUrl);
		statuses = parseRaw(
			adoStatusesSchema,
			res,
			`statuses for PR ${prId}`,
		).value;
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
		issues.push(
			`Statuses unavailable: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	return { evaluations, statuses };
}

function listedBuildRepoId(build: AdoBuild): string | undefined {
	const extra = build as AdoBuild & { repository?: { id?: string } };
	return extra.repository?.id;
}

async function fetchMergeBranchBuilds(
	buildService: BuildService,
	client: AdoPagedClient,
	org: string,
	projectGuid: string,
	repoId: string,
	rawPr: AdoPullRequestSummary,
	buildDefMap: Map<number, BuildWithStages>,
	issues: string[],
): Promise<void> {
	const mergeBranch = `refs/pull/${rawPr.pullRequestId}/merge`;
	const targetCommitId = rawPr.lastMergeCommit?.commitId;
	const seenTokens = new Set<string>();
	let token: string | null = null;
	try {
		for (;;) {
			const mergeBuildsUrl = adoUrl(
				`${BASE_URL}/${org}/${projectGuid}`,
				"_apis/build/builds",
				{
					branchName: mergeBranch,
					repositoryId: repoId,
					repositoryType: "TfsGit",
					maxBuildsPerDefinition: 1,
					queryOrder: "queueTimeDescending",
					$top: 100,
					continuationToken: token ?? undefined,
				},
			);
			const page = await client.getPage(mergeBuildsUrl);
			const parsed = parseRaw(
				adoBuildsSchema,
				page.data,
				`merge builds for PR ${rawPr.pullRequestId}`,
			);
			for (const b of parsed.value) {
				if (
					targetCommitId &&
					b.sourceVersion &&
					b.sourceVersion !== targetCommitId
				) {
					continue;
				}
				if (b.sourceBranch && b.sourceBranch !== mergeBranch) continue;
				const listedRepo = listedBuildRepoId(b);
				if (listedRepo && listedRepo !== repoId) continue;
				const defId = b.definition?.id ?? b.id;
				const existing = buildDefMap.get(defId);
				if (existing && existing.build.id >= b.id) continue;
				try {
					const withStages = await buildService.fetchBuildWithStages(
						b.id,
						projectGuid,
						existing?.required === true,
					);
					buildDefMap.set(defId, {
						...withStages,
						required:
							existing?.required === true || withStages.required === true,
					});
				} catch (e) {
					if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
					issues.push(
						boundedIssue(
							`Failed to fetch stages for build ${b.id}: ${issueMessage(e, "unknown error")}`,
						),
					);
				}
			}
			if (!page.continuationToken) break;
			if (seenTokens.has(page.continuationToken)) {
				issues.push(
					`Merge build listing repeated a continuation token for PR ${rawPr.pullRequestId}`,
				);
				break;
			}
			seenTokens.add(page.continuationToken);
			token = page.continuationToken;
			if (parsed.value.length === 0) break;
		}
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
		issues.push(
			boundedIssue(
				`Merge builds unavailable: ${issueMessage(e, "unknown error")}`,
			),
		);
	}
}

async function fetchPrBuilds(
	buildService: BuildService,
	client: AdoPagedClient,
	org: string,
	projectGuid: string,
	repoId: string,
	rawPr: AdoPullRequestSummary,
	evaluations: AdoEvaluation[],
	issues: string[],
): Promise<BuildWithStages[]> {
	const buildDefMap = new Map<number, BuildWithStages>();

	for (const ev of evaluations) {
		const typeId = ev.configuration.type?.id?.toLowerCase();
		const status = (ev.status || "").toLowerCase();
		if (
			typeId !== BUILD_POLICY_TYPE_ID ||
			ev.configuration.isEnabled === false ||
			status === "notapplicable" ||
			!ev.context ||
			typeof ev.context.buildId !== "number"
		) {
			continue;
		}
		const buildId = ev.context.buildId;
		const isBlocking = ev.configuration.isBlocking !== false;
		try {
			const b = await buildService.fetchBuildWithStages(
				buildId,
				projectGuid,
				isBlocking,
			);
			const defId = b.build.definition?.id ?? buildId;
			const existing = buildDefMap.get(defId);
			if (!existing || b.build.id > existing.build.id) {
				buildDefMap.set(defId, {
					...b,
					required: existing?.required === true || b.required === true,
				});
			}
		} catch (e) {
			if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
			issues.push(
				e instanceof AdoError && e.kind === "not_found"
					? `Build ${buildId} is unavailable`
					: boundedIssue(
							`Failed to fetch build ${buildId}: ${issueMessage(e, "unknown error")}`,
						),
			);
		}
	}

	await fetchMergeBranchBuilds(
		buildService,
		client,
		org,
		projectGuid,
		repoId,
		rawPr,
		buildDefMap,
		issues,
	);

	return Array.from(buildDefMap.values());
}

async function fetchPrMetrics(
	client: AdoPagedClient,
	org: string,
	projectGuid: string,
	repoId: string,
	prId: number,
): Promise<{
	comments: number | null;
	filesChanged: number | null;
	latestIterationSec: number | null;
}> {
	let comments: number | null = null;
	let filesChanged: number | null = null;
	let latestIterationSec: number | null = null;

	const threadsUrl = adoUrl(
		`${BASE_URL}/${org}/${projectGuid}`,
		`_apis/git/repositories/${repoId}/pullRequests/${prId}/threads`,
	);
	try {
		const res = await client.get(threadsUrl);
		const parsed = parseRaw(adoThreadsSchema, res, `threads for PR ${prId}`);
		let userCount = 0;
		for (const t of parsed.value) {
			for (const c of t.comments || []) {
				if (!c.isDeleted && c.commentType !== "system") {
					userCount++;
				}
			}
		}
		comments = userCount;
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
	}

	const iterUrl = adoUrl(
		`${BASE_URL}/${org}/${projectGuid}`,
		`_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations`,
	);
	try {
		const res = await client.get(iterUrl);
		const parsedIter = parseRaw(
			adoIterationsSchema,
			res,
			`iterations for PR ${prId}`,
		);
		if (parsedIter.value.length > 0) {
			for (const it of parsedIter.value) {
				const d = parseSeconds(it.updatedDate) ?? parseSeconds(it.createdDate);
				if (d && (!latestIterationSec || d > latestIterationSec)) {
					latestIterationSec = d;
				}
			}
			const latestIterId = parsedIter.value[parsedIter.value.length - 1]?.id;
			if (latestIterId !== undefined) {
				const changesUrl = adoUrl(
					`${BASE_URL}/${org}/${projectGuid}`,
					`_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIterId}/changes`,
				);
				const rawChanges = await client.get(changesUrl);
				const parsedChanges = parseRaw(
					adoIterationChangesSchema,
					rawChanges,
					`iteration changes for PR ${prId}`,
				);
				if (parsedChanges.changeCounts) {
					let sum = 0;
					for (const count of Object.values(parsedChanges.changeCounts)) {
						sum += count;
					}
					filesChanged = sum;
				}
			}
		}
	} catch (e) {
		if (e instanceof AdoError && e.kind === "unauthenticated") throw e;
	}

	return { comments, filesChanged, latestIterationSec };
}

export async function collectProjectPulls(opts: {
	project: Project;
	client: AdoPagedClient;
	now: number;
	targets?: PullRequest[];
	onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<{
	pulls: PullRequest[];
	state: "complete" | "partial";
	message: string;
	mergeRequirements?: MergeRequirement[];
}> {
	const { project, client, now } = opts;
	const org = project.organization;
	const projectKey = project.projectKey;

	await client.checkAuth(org);

	const targetRepos = opts.targets?.length
		? []
		: await discoverRepositories(client, project);
	const activePrs: AdoPullRequestSummary[] = [];
	const completedPrs: AdoPullRequestSummary[] = [];
	const abandonedPrs: AdoPullRequestSummary[] = [];
	const globalIssues: string[] = [];
	for (const target of opts.targets ?? []) {
		const url = adoUrl(
			`${BASE_URL}/${org}/${encodeURIComponent(projectKey)}`,
			`_apis/git/repositories/${encodeURIComponent(target.repository.id)}/pullrequests/${target.number}`,
		);
		const raw = parseRaw(
			adoPullRequestSummarySchema,
			await client.get(url),
			`selected PR ${target.number}`,
		);
		if (
			raw.repository.id !== target.repository.id ||
			raw.pullRequestId !== target.number
		)
			throw new AdoError(
				"bad_response",
				"Selected PR identity changed during collection",
			);
		activePrs.push(raw);
	}

	for (const repo of targetRepos) {
		const active = await enumerateActivePullRequests(client, org, repo);
		activePrs.push(...active);

		const recent = await enumerateRecentHistory(client, org, repo);
		completedPrs.push(...recent.completed);
		abandonedPrs.push(...recent.abandoned);
		globalIssues.push(...recent.issues);
	}

	const combinedPrMap = new Map<string, AdoPullRequestSummary>();
	const prKey = (pr: AdoPullRequestSummary) =>
		`${pr.repository.id}:${pr.pullRequestId}`;
	for (const pr of activePrs) combinedPrMap.set(prKey(pr), pr);
	for (const pr of completedPrs)
		if (!combinedPrMap.has(prKey(pr))) combinedPrMap.set(prKey(pr), pr);
	for (const pr of abandonedPrs)
		if (!combinedPrMap.has(prKey(pr))) combinedPrMap.set(prKey(pr), pr);

	const allPrs = Array.from(combinedPrMap.values());
	const totalPulls = allPrs.length;
	let completedCount = 0;
	let hasPartialDetails = globalIssues.length > 0;
	const startedMs = Date.now();
	if (opts.onProgress) await opts.onProgress(0, totalPulls);

	const buildService = new BuildService(client, org);

	async function enrichPullRequest(
		rawPr: AdoPullRequestSummary,
	): Promise<PullRequest> {
		const repoMeta = targetRepos.find((r) => r.id === rawPr.repository.id) || {
			id: rawPr.repository.id,
			name: rawPr.repository.name,
			projectGuid: rawPr.repository.project?.id || projectKey,
		};
		const issues: string[] = [];

		const { evaluations, statuses } = await fetchPrEvaluationsAndStatuses(
			client,
			org,
			repoMeta.projectGuid,
			repoMeta.id,
			rawPr.pullRequestId,
			issues,
		);

		const builds = await fetchPrBuilds(
			buildService,
			client,
			org,
			repoMeta.projectGuid,
			repoMeta.id,
			rawPr,
			evaluations,
			issues,
		);
		for (const build of builds) {
			if (build.collectionIssues?.length)
				issues.push(...build.collectionIssues.map(boundedIssue));
		}

		const { comments, filesChanged, latestIterationSec } = await fetchPrMetrics(
			client,
			org,
			repoMeta.projectGuid,
			repoMeta.id,
			rawPr.pullRequestId,
		);

		if (issues.length > 0) {
			hasPartialDetails = true;
		}

		const prClosedSec = parseSeconds(rawPr.closedDate);
		const prCreatedSec = parseSeconds(rawPr.creationDate);
		const computedUpdatedAt =
			prClosedSec ??
			(latestIterationSec && prCreatedSec
				? Math.max(latestIterationSec, prCreatedSec)
				: (latestIterationSec ?? prCreatedSec ?? now));

		const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
		return normalizePullRequest({
			projectId: project.id,
			rawPr,
			evaluations,
			statuses,
			builds,
			now: now + elapsed,
			updatedAt: computedUpdatedAt,
			collectionIssues: issues.length > 0 ? issues : undefined,
			filesChanged,
			additions: null,
			deletions: null,
			comments,
		});
	}

	const normalizedPulls: PullRequest[] = [];
	const queue = [...allPrs];
	const listOnly = opts.targets?.length === 0;
	let mergeRequirements: MergeRequirement[] | undefined;
	if (listOnly) {
		try {
			mergeRequirements = await discoverMergeRequirements(
				client,
				project,
				targetRepos,
			);
		} catch (error) {
			if (error instanceof AdoError && error.kind === "unauthenticated")
				throw error;
			hasPartialDetails = true;
			globalIssues.push(
				issueMessage(error, "Project merge requirements unavailable"),
			);
		}
	}

	async function worker() {
		while (queue.length > 0) {
			const item = queue.shift();
			if (!item) break;
			const normalized = listOnly
				? normalizePullRequest({
						projectId: project.id,
						rawPr: item,
						now,
						checksObservedAt: null,
						collectionIssues: [
							"Checks load with auto refresh on the current PR page.",
						],
					})
				: await enrichPullRequest(item);
			normalizedPulls.push(normalized);
			completedCount++;
			if (opts.onProgress && !listOnly) {
				await opts.onProgress(completedCount, totalPulls);
			}
		}
	}

	const workerCount = Math.min(DEFAULT_CONCURRENCY, allPrs.length || 1);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (listOnly) await opts.onProgress?.(completedCount, totalPulls);

	normalizedPulls.sort((a, b) => b.number - a.number);

	const state = hasPartialDetails ? "partial" : "complete";
	const message =
		listOnly && !hasPartialDetails
			? `Refreshed ${normalizedPulls.length} PR summaries. Checks load for the current PR page.`
			: hasPartialDetails
				? `Collected ${normalizedPulls.length} PRs with partial check/detail coverage.`
				: `Collected ${normalizedPulls.length} PRs completely.`;

	return {
		pulls: normalizedPulls,
		state,
		message,
		mergeRequirements:
			mergeRequirements === undefined
				? undefined
				: projectMergeRequirements(
						{ ...project, mergeRequirements },
						normalizedPulls,
					),
	};
}
