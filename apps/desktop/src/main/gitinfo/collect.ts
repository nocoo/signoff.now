/**
 * collectAll — orchestrates all gitinfo collectors for a given project path.
 *
 * Replicates the bootstrap sequence from gitinfo's main.ts (steps 1-6)
 * but as a callable function instead of a CLI entry point. Always uses
 * the "full" tier set (instant + moderate + slow) since desktop users
 * benefit from the richest data.
 */

import type { GitInfoReport } from "@signoff/gitinfo";
import type { CollectorContext } from "@signoff/gitinfo/collectors";
import {
	branchesCollector,
	configCollector,
	contributorsCollector,
	filesCollector,
	logsCollector,
	metaCollector,
	statusCollector,
	tagsCollector,
} from "@signoff/gitinfo/collectors/all";
import { runCollectors } from "@signoff/gitinfo/collectors/run";
import {
	EMPTY_BRANCHES,
	EMPTY_CONFIG,
	EMPTY_CONTRIBUTORS,
	EMPTY_FILES,
	EMPTY_LOGS,
	EMPTY_META,
	EMPTY_STATUS,
	EMPTY_TAGS,
} from "@signoff/gitinfo/defaults";
import { createNodeExecutor } from "./executor";
import { createNodeFsReader } from "./fs-reader";

const ALL_COLLECTORS = [
	metaCollector,
	statusCollector,
	branchesCollector,
	logsCollector,
	contributorsCollector,
	tagsCollector,
	filesCollector,
	configCollector,
];

export class CollectError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollectError";
	}
}

/**
 * Collect all gitinfo data for a project path.
 *
 * @param projectPath - Absolute path to the project's git repository
 * @returns Full GitInfoReport with all collector results
 * @throws CollectError if path is not a git repo or is bare
 */
export async function collectAll(projectPath: string): Promise<GitInfoReport> {
	const exec = createNodeExecutor();
	const fs = createNodeFsReader(exec);

	// 1. Bare repo guard
	const bareResult = await exec("git", ["rev-parse", "--is-bare-repository"], {
		cwd: projectPath,
	});
	if (bareResult.exitCode !== 0) {
		throw new CollectError(
			"Not a git repository (or any of the parent directories)",
		);
	}
	if (bareResult.stdout === "true") {
		throw new CollectError("Bare repositories are not supported");
	}

	// 2. Resolve repo root and HEAD state
	const repoRootResult = await exec("git", ["rev-parse", "--show-toplevel"], {
		cwd: projectPath,
	});
	if (repoRootResult.exitCode !== 0) {
		throw new CollectError("Failed to resolve repository root");
	}
	const repoRoot = repoRootResult.stdout;

	const headResult = await exec("git", ["rev-parse", "--verify", "HEAD"], {
		cwd: repoRoot,
	});
	const hasHead = headResult.exitCode === 0;

	// 3. Git dir and path helper
	const gitDirResult = await exec("git", ["rev-parse", "--absolute-git-dir"], {
		cwd: repoRoot,
	});
	const gitDir = gitDirResult.stdout;

	const gitPath = async (name: string): Promise<string> => {
		const result = await exec(
			"git",
			["rev-parse", "--path-format=absolute", "--git-path", name],
			{ cwd: repoRoot },
		);
		return result.stdout;
	};

	// 4. Build context — always use full tiers for desktop
	const ctx: CollectorContext = {
		exec,
		fs,
		repoRoot,
		gitDir,
		gitPath,
		hasHead,
		activeTiers: new Set(["instant", "moderate", "slow"]),
	};

	// 5. Run all collectors in parallel
	const startTime = performance.now();
	const { results, errors } = await runCollectors(ALL_COLLECTORS, ctx);
	const durationMs = Math.round(performance.now() - startTime);

	// 6. Assemble report with defaults for failed collectors
	return {
		generatedAt: new Date().toISOString(),
		tiers: ["instant", "moderate", "slow"],
		durationMs,
		meta: (results.get("meta") as GitInfoReport["meta"]) ?? EMPTY_META,
		status: (results.get("status") as GitInfoReport["status"]) ?? EMPTY_STATUS,
		branches:
			(results.get("branches") as GitInfoReport["branches"]) ?? EMPTY_BRANCHES,
		logs: (results.get("logs") as GitInfoReport["logs"]) ?? EMPTY_LOGS,
		contributors:
			(results.get("contributors") as GitInfoReport["contributors"]) ??
			EMPTY_CONTRIBUTORS,
		tags: (results.get("tags") as GitInfoReport["tags"]) ?? EMPTY_TAGS,
		files: (results.get("files") as GitInfoReport["files"]) ?? EMPTY_FILES,
		config: (results.get("config") as GitInfoReport["config"]) ?? EMPTY_CONFIG,
		errors,
	};
}
