/**
 * Desktop bridge for pulse PR collection.
 *
 * Imports pulse's core logic and wires it up with the Node.js executor
 * (same pattern as gitinfo/collect.ts). The Electron main process can
 * call collectProjectPrs() to fetch PRs for any project.
 */

import { CollectError, collectPrs } from "@signoff/pulse/collect";
import { createNodeExecutor } from "../gitinfo/executor";

export { CollectError };

export interface CollectProjectPrsOptions {
	/** Absolute path to the project's git repository. */
	projectPath: string;
	/** PR state filter. */
	state?: "open" | "closed" | "all";
	/** Max results (0 = unlimited). */
	limit?: number;
	/** Filter by author login. */
	author?: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

/**
 * Collect PR data for a project using the Node.js executor.
 *
 * Delegates to pulse's collectPrs() with a Node-compatible executor,
 * so it works in packaged Electron without requiring Bun at runtime.
 */
export async function collectProjectPrs(opts: CollectProjectPrsOptions) {
	const exec = createNodeExecutor();

	return collectPrs({
		exec,
		cwd: opts.projectPath,
		state: opts.state ?? "open",
		limit: opts.limit ?? 0,
		author: opts.author ?? null,
		cursor: opts.cursor ?? null,
	});
}
