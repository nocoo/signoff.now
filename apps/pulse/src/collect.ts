/**
 * Extractable orchestration function for desktop integration.
 *
 * Mirrors the logic in main.ts (get remote → parse → resolve identity → fetch PRs)
 * but accepts a CommandExecutor via DI, allowing the desktop app to inject its own
 * Node.js executor instead of requiring Bun at runtime.
 */

import { GitHubClient } from "./api/github-client.ts";
import type { GitHubApiClient } from "./api/types.ts";
import { fetchPrs } from "./commands/prs/fetch-prs.ts";
import type { PrsReport } from "./commands/types.ts";
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

export interface CollectPrsOptions {
	/** Command executor (Bun or Node). */
	exec: CommandExecutor;
	/** Absolute path to the project's git repository. */
	cwd: string;
	/** PR state filter. */
	state: "open" | "closed" | "all";
	/** Max results (0 = unlimited). */
	limit: number;
	/** Filter by author login. */
	author: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
	/** Skip identity cache. */
	noCache?: boolean;
	/** Custom cache store (omit to disable caching). */
	cacheStore?: CacheStore;
	/**
	 * Optional API client override (for testing).
	 * If omitted, a real GitHubClient is created from the resolved token.
	 */
	apiClient?: GitHubApiClient;
}

/**
 * Collect PR data for a project.
 *
 * Resolves the git remote, authenticates via gh CLI, and fetches PRs
 * from the GitHub GraphQL API. Suitable for both CLI and desktop contexts.
 */
export async function collectPrs(opts: CollectPrsOptions): Promise<PrsReport> {
	const { exec, cwd, state, limit, author, noCache, cacheStore } = opts;

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

	// Step 4: Fetch PRs
	const client = opts.apiClient ?? new GitHubClient(identity.token);
	const report = await fetchPrs(client, {
		owner: remote.owner,
		repo: remote.repo,
		state,
		limit,
		author,
		cursor: opts.cursor ?? null,
		resolvedUser: identity.login,
		resolvedVia: identity.resolvedVia,
	});

	return report;
}
