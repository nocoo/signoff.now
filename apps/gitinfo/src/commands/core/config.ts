import { isAbsolute, join } from "node:path";
import type { CommandExecutor, FsReader } from "../../executor/types.ts";
import { splitLines, splitNul } from "../../utils/parse.ts";
import type { GitConfig, GitObjectStats } from "../types.ts";

export async function getGitDirSizeKiB(
	fs: FsReader,
	gitDir: string,
): Promise<number> {
	return fs.dirSizeKiB(gitDir);
}

export async function getObjectStats(
	exec: CommandExecutor,
	cwd: string,
): Promise<GitObjectStats> {
	const result = await exec("git", ["count-objects", "-v"], { cwd });
	const stats: GitObjectStats = {
		count: 0,
		size: 0,
		inPack: 0,
		packs: 0,
		sizePackKiB: 0,
		prunePackable: 0,
		garbage: 0,
		sizeGarbageKiB: 0,
	};

	if (result.exitCode !== 0) return stats;

	const keyMap: Record<string, keyof GitObjectStats> = {
		count: "count",
		size: "size",
		"in-pack": "inPack",
		packs: "packs",
		"size-pack": "sizePackKiB",
		"prune-packable": "prunePackable",
		garbage: "garbage",
		"size-garbage": "sizeGarbageKiB",
	};

	for (const line of splitLines(result.stdout)) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const rawKey = line.slice(0, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();
		const field = keyMap[rawKey];
		if (field) {
			const num = Number.parseInt(rawValue, 10);
			if (!Number.isNaN(num)) {
				stats[field] = num;
			}
		}
	}

	return stats;
}

export async function getWorktreeCount(
	exec: CommandExecutor,
	cwd: string,
): Promise<number> {
	const result = await exec("git", ["worktree", "list", "--porcelain", "-z"], {
		cwd,
	});
	if (result.exitCode !== 0 || result.stdout === "") return 0;

	const tokens = splitNul(result.stdout);
	let count = 0;
	for (const token of tokens) {
		if (token.startsWith("worktree ")) {
			count++;
		}
	}
	return count;
}

export async function getHooks(
	exec: CommandExecutor,
	fs: FsReader,
	cwd: string,
	repoRoot: string,
	gitPath: (name: string) => Promise<string>,
): Promise<string[]> {
	let hooksDir: string;

	const configResult = await exec("git", ["config", "core.hooksPath"], { cwd });

	if (configResult.exitCode === 0 && configResult.stdout !== "") {
		const configuredPath = configResult.stdout.trim();
		hooksDir = isAbsolute(configuredPath)
			? configuredPath
			: join(repoRoot, configuredPath);
	} else {
		hooksDir = await gitPath("hooks");
	}

	const entries = await fs.readdir(hooksDir);
	return entries.filter((name) => !name.endsWith(".sample"));
}

export async function getLocalConfig(
	exec: CommandExecutor,
	cwd: string,
): Promise<Record<string, string[]>> {
	const result = await exec("git", ["config", "--local", "--list", "-z"], {
		cwd,
	});
	if (result.exitCode !== 0 || result.stdout === "") return {};

	const tokens = splitNul(result.stdout);
	const config: Record<string, string[]> = {};

	for (const token of tokens) {
		const newlineIdx = token.indexOf("\n");
		if (newlineIdx === -1) continue;
		const key = token.slice(0, newlineIdx);
		const value = token.slice(newlineIdx + 1);
		if (config[key]) {
			config[key].push(value);
		} else {
			config[key] = [value];
		}
	}

	return config;
}

export async function collectConfig(
	exec: CommandExecutor,
	fs: FsReader,
	cwd: string,
	repoRoot: string,
	gitDir: string,
	gitPath: (name: string) => Promise<string>,
): Promise<GitConfig> {
	const [gitDirSizeKiB, objectStats, worktreeCount, hooks, localConfig] =
		await Promise.all([
			getGitDirSizeKiB(fs, gitDir),
			getObjectStats(exec, cwd),
			getWorktreeCount(exec, cwd),
			getHooks(exec, fs, cwd, repoRoot, gitPath),
			getLocalConfig(exec, cwd),
		]);

	return {
		gitDirSizeKiB,
		objectStats,
		worktreeCount,
		hooks,
		localConfig,
	};
}
