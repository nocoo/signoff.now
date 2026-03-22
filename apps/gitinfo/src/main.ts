#!/usr/bin/env bun
import { ArgParseError, getHelpText, parseArgs } from "./cli/args.ts";
import { formatJson } from "./cli/output.ts";
import { branchesCollector } from "./commands/collectors/branches.collector.ts";
import { configCollector } from "./commands/collectors/config.collector.ts";
import { contributorsCollector } from "./commands/collectors/contributors.collector.ts";
import { filesCollector } from "./commands/collectors/files.collector.ts";
import { logsCollector } from "./commands/collectors/logs.collector.ts";
import { metaCollector } from "./commands/collectors/meta.collector.ts";
import { runCollectors } from "./commands/collectors/run-collectors.ts";
import { statusCollector } from "./commands/collectors/status.collector.ts";
import { tagsCollector } from "./commands/collectors/tags.collector.ts";
import type { CollectorContext } from "./commands/collectors/types.ts";
import { formatPretty, formatPrettySection } from "./commands/pretty/format.ts";
import type { CollectorTier, GitInfoReport } from "./commands/types.ts";
import { createBunExecutor } from "./executor/bun-executor.ts";
import { createBunFsReader } from "./executor/bun-fs-reader.ts";

const VERSION = "0.1.0";

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

async function main(): Promise<void> {
	const rawArgs = process.argv.slice(2);

	let args: ReturnType<typeof parseArgs>;
	try {
		args = parseArgs(rawArgs);
	} catch (err) {
		if (err instanceof ArgParseError) {
			console.error(`Error: ${err.message}\n`);
			console.error(getHelpText());
			process.exit(1);
		}
		throw err;
	}

	if (args.help) {
		console.log(getHelpText());
		return;
	}

	if (args.version) {
		console.log(`gitinfo v${VERSION}`);
		return;
	}

	const exec = createBunExecutor();
	const fs = createBunFsReader(exec);
	const targetDir = args.cwd ?? process.cwd();

	// 1. Bare guard
	const bareResult = await exec("git", ["rev-parse", "--is-bare-repository"], {
		cwd: targetDir,
	});
	if (bareResult.exitCode !== 0) {
		console.error(
			"Error: not a git repository (or any of the parent directories)",
		);
		process.exit(128);
	}
	if (bareResult.stdout === "true") {
		console.error("Error: bare repositories are not supported");
		process.exit(1);
	}

	// 2. Resolve repo root and HEAD state
	const repoRootResult = await exec("git", ["rev-parse", "--show-toplevel"], {
		cwd: targetDir,
	});
	if (repoRootResult.exitCode !== 0) {
		console.error("Error: failed to resolve repository root");
		process.exit(1);
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

	// 4. Large repo warning
	if (hasHead) {
		const countResult = await exec("git", ["rev-list", "--count", "HEAD"], {
			cwd: repoRoot,
		});
		const commitCount = Number.parseInt(countResult.stdout, 10);
		if (commitCount > 50_000) {
			console.error(
				`⚠ Large repository (${commitCount} commits) — slow fields may take a while`,
			);
		}
	}

	// 5. Build context and run collectors
	const activeTiers: Set<CollectorTier> = new Set(["instant", "moderate"]);
	if (args.full) {
		activeTiers.add("slow");
	}

	const ctx: CollectorContext = {
		exec,
		fs,
		repoRoot,
		gitDir,
		gitPath,
		hasHead,
		activeTiers,
	};

	const startTime = performance.now();
	const { results, errors } = await runCollectors(ALL_COLLECTORS, ctx);
	const durationMs = Math.round(performance.now() - startTime);

	// 6. Assemble report
	const report: GitInfoReport = {
		generatedAt: new Date().toISOString(),
		tiers: Array.from(activeTiers),
		durationMs,
		meta: results.get("meta") as GitInfoReport["meta"],
		status: results.get("status") as GitInfoReport["status"],
		branches: results.get("branches") as GitInfoReport["branches"],
		logs: results.get("logs") as GitInfoReport["logs"],
		contributors: results.get("contributors") as GitInfoReport["contributors"],
		tags: results.get("tags") as GitInfoReport["tags"],
		files: results.get("files") as GitInfoReport["files"],
		config: results.get("config") as GitInfoReport["config"],
		errors,
	};

	// 7. Output
	if (args.pretty) {
		if (args.section) {
			console.log(formatPrettySection(report, args.section));
		} else {
			console.log(formatPretty(report));
		}
	} else {
		console.log(formatJson(report, args.section));
	}
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
