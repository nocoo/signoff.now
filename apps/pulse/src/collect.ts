/**
 * Extractable orchestration function for desktop integration.
 *
 * Mirrors the logic in main.ts (get remote → parse → resolve identity → fetch PRs)
 * but accepts a CommandExecutor via DI, allowing the desktop app to inject its own
 * Node.js executor instead of requiring Bun at runtime.
 */

import { GitHubClient } from "./api/github-client.ts";
import type { GitHubApiClient } from "./api/types.ts";
import { fetchPrDetail } from "./commands/pr-detail/fetch-pr-detail.ts";
import { fetchPrDiff } from "./commands/pr-diff/fetch-pr-diff.ts";
import { fetchPrSearch } from "./commands/pr-search/fetch-pr-search.ts";
import { fetchPrs } from "./commands/prs/fetch-prs.ts";
import { fetchRepo } from "./commands/repo/fetch-repo.ts";
import type {
	PullRequestDetailReport,
	PullRequestDiffReport,
	PullRequestSearchReport,
	PullRequestStateFilter,
	PullRequestsReport,
	RepositoryReport,
} from "./commands/types.ts";
import type { CommandExecutor } from "./executor/types.ts";
import { parseRemoteUrl } from "./identity/resolve-remote.ts";
import type { CacheStore } from "./identity/resolve-user.ts";
import { resolveIdentity } from "./identity/resolve-user.ts";

export class CollectError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollectError";
	}
}

/** Shared options for all collect functions. */
interface CollectBaseOptions {
	/** Command executor (Bun or Node). */
	exec: CommandExecutor;
	/** Absolute path to the project's git repository. */
	cwd: string;
	/** Skip identity cache. */
	noCache?: boolean;
	/** Custom cache store (omit to disable caching). */
	cacheStore?: CacheStore;
	/** Optional API client override (for testing). */
	apiClient?: GitHubApiClient;
}

export interface CollectPullRequestsOptions extends CollectBaseOptions {
	/** PR state filter. */
	state: PullRequestStateFilter;
	/** Max results (0 = unlimited). */
	limit: number;
	/** Filter by author login. */
	author: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

export interface CollectPullRequestDetailOptions extends CollectBaseOptions {
	/** PR number to fetch detail for. */
	number: number;
}

export interface CollectPullRequestDiffOptions extends CollectBaseOptions {
	/** PR number to fetch diff for. */
	number: number;
}

export interface CollectPullRequestSearchOptions extends CollectBaseOptions {
	/** Search qualifier. */
	query: string;
	/** Max results. */
	limit: number;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

/**
 * Resolve git remote and GitHub identity for a project directory.
 * Shared bootstrap logic used by both collectPullRequests and collectPullRequestDetail.
 */
async function resolveProject(opts: CollectBaseOptions) {
	const { exec, cwd, noCache, cacheStore } = opts;

	// Step 1: Get the remote URL
	const remoteResult = await exec("git", ["remote", "get-url", "origin"], {
		cwd,
	});
	if (remoteResult.exitCode !== 0) {
		throw new CollectError(
			"Could not read git remote. Is this a git repository?",
		);
	}

	// Step 2: Parse remote URL
	const remote = parseRemoteUrl(remoteResult.stdout.trim());

	if (remote.platform === "azure-devops") {
		throw new CollectError("Azure DevOps is not supported yet");
	}

	if (remote.platform === "unknown" || !remote.owner || !remote.repo) {
		throw new CollectError(
			`Could not parse remote URL: ${remoteResult.stdout.trim()}`,
		);
	}

	// Step 3: Resolve identity
	const identity = await resolveIdentity(exec, remote.host, remote.owner, {
		noCache,
		cacheStore,
	});

	if (!identity) {
		throw new CollectError(
			"No authenticated GitHub user found. Run: gh auth login",
		);
	}

	const client = opts.apiClient ?? new GitHubClient(identity.token);

	return { remote, identity, client };
}

/**
 * Collect PR data for a project.
 */
export async function collectPullRequests(
	opts: CollectPullRequestsOptions,
): Promise<PullRequestsReport> {
	const { remote, identity, client } = await resolveProject(opts);

	return fetchPrs(client, {
		owner: remote.owner,
		repo: remote.repo,
		state: opts.state,
		limit: opts.limit,
		author: opts.author,
		cursor: opts.cursor ?? null,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});
}

/**
 * Collect detailed information for a single PR.
 */
export async function collectPullRequestDetail(
	opts: CollectPullRequestDetailOptions,
): Promise<PullRequestDetailReport> {
	const { remote, identity, client } = await resolveProject(opts);

	return fetchPrDetail(client, {
		owner: remote.owner,
		repo: remote.repo,
		number: opts.number,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});
}

/**
 * Collect diff and changed files for a single PR.
 */
export async function collectPullRequestDiff(
	opts: CollectPullRequestDiffOptions,
): Promise<PullRequestDiffReport> {
	const { remote, identity, client } = await resolveProject(opts);

	return fetchPrDiff(client, {
		owner: remote.owner,
		repo: remote.repo,
		number: opts.number,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});
}

/**
 * Search PRs for a project.
 */
export async function collectPullRequestSearch(
	opts: CollectPullRequestSearchOptions,
): Promise<PullRequestSearchReport> {
	const { remote, identity, client } = await resolveProject(opts);

	return fetchPrSearch(client, {
		owner: remote.owner,
		repo: remote.repo,
		query: opts.query,
		limit: opts.limit,
		cursor: opts.cursor ?? null,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});
}

export type CollectRepositoryOptions = CollectBaseOptions;

/**
 * Collect repository metadata for a project.
 */
export async function collectRepository(
	opts: CollectRepositoryOptions,
): Promise<RepositoryReport> {
	const { remote, identity, client } = await resolveProject(opts);

	return fetchRepo(client, {
		owner: remote.owner,
		repo: remote.repo,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});
}
