/**
 * Desktop bridge for pulse PR collection.
 *
 * Imports pulse's core logic and wires it up with the Node.js executor
 * (same pattern as gitinfo/collect.ts). The Electron main process can
 * call collectProjectPrs() to fetch PRs for any project.
 */

import {
	CollectError,
	collectPullRequestDetail,
	collectPullRequests,
} from "@signoff/pulse/collect";
import { createNodeExecutor } from "../gitinfo/executor";

export { CollectError };

export interface CollectProjectPrsOptions {
	/** Absolute path to the project's git repository. */
	projectPath: string;
	/** PR state filter. */
	state?: "open" | "closed" | "merged" | "all";
	/** Max results (0 = unlimited). */
	limit?: number;
	/** Filter by author login. */
	author?: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

export interface CollectProjectPrDetailOptions {
	/** Absolute path to the project's git repository. */
	projectPath: string;
	/** PR number to fetch detail for. */
	number: number;
}

/**
 * Collect PR data for a project using the Node.js executor.
 */
export async function collectProjectPrs(opts: CollectProjectPrsOptions) {
	const exec = createNodeExecutor();

	return collectPullRequests({
		exec,
		cwd: opts.projectPath,
		state: opts.state ?? "open",
		limit: opts.limit ?? 0,
		author: opts.author ?? null,
		cursor: opts.cursor ?? null,
	});
}

/**
 * Collect detailed information for a single PR using the Node.js executor.
 */
export async function collectProjectPrDetail(
	opts: CollectProjectPrDetailOptions,
) {
	const exec = createNodeExecutor();

	return collectPullRequestDetail({
		exec,
		cwd: opts.projectPath,
		number: opts.number,
	});
}
