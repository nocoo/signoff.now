import type { CommandExecutor } from "../../executor/types.ts";
import { splitLines } from "../../utils/parse.ts";
import type { GitMeta, GitRemote } from "../types.ts";

export async function getGitVersion(exec: CommandExecutor): Promise<string> {
	const result = await exec("git", ["--version"]);
	return result.stdout.replace("git version ", "");
}

export function deriveRepoName(repoRoot: string, remotes: GitRemote[]): string {
	const origin = remotes.find((r) => r.name === "origin");
	if (origin) {
		const url = origin.fetchUrl;
		// SSH: git@host:org/repo.git or HTTPS: https://host/org/repo.git
		const lastSegment = url.split("/").pop() ?? url.split(":").pop() ?? url;
		return lastSegment.replace(/\.git$/, "");
	}
	return repoRoot.split("/").pop() ?? repoRoot;
}

export async function getHead(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string | null> {
	if (!hasHead) return null;
	const result = await exec("git", ["rev-parse", "HEAD"], { cwd });
	return result.exitCode === 0 ? result.stdout : null;
}

export async function getHeadShort(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string | null> {
	if (!hasHead) return null;
	const result = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd });
	return result.exitCode === 0 ? result.stdout : null;
}

export async function getCurrentBranch(
	exec: CommandExecutor,
	cwd: string,
): Promise<string | null> {
	const result = await exec("git", ["symbolic-ref", "--short", "HEAD"], {
		cwd,
	});
	return result.exitCode === 0 ? result.stdout : null;
}

export async function getDefaultBranch(
	exec: CommandExecutor,
	cwd: string,
): Promise<string | null> {
	const result = await exec(
		"git",
		["symbolic-ref", "refs/remotes/origin/HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0) return null;
	return result.stdout.replace("refs/remotes/origin/", "");
}

export async function getRemotes(
	exec: CommandExecutor,
	cwd: string,
): Promise<GitRemote[]> {
	const result = await exec("git", ["remote", "-v"], { cwd });
	if (result.exitCode !== 0 || result.stdout === "") return [];

	const lines = splitLines(result.stdout);
	const remoteMap = new Map<string, { fetchUrl: string; pushUrls: string[] }>();

	for (const line of lines) {
		const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
		if (!match) continue;

		const name = match[1] as string;
		const url = match[2] as string;
		const type = match[3] as string;

		if (!remoteMap.has(name)) {
			remoteMap.set(name, { fetchUrl: "", pushUrls: [] });
		}
		const entry = remoteMap.get(name) as {
			fetchUrl: string;
			pushUrls: string[];
		};

		if (type === "fetch") {
			entry.fetchUrl = url;
		} else {
			entry.pushUrls.push(url);
		}
	}

	return Array.from(remoteMap.entries()).map(([name, entry]) => ({
		name,
		fetchUrl: entry.fetchUrl,
		pushUrls: entry.pushUrls,
	}));
}

export async function getIsShallow(
	exec: CommandExecutor,
	cwd: string,
): Promise<boolean> {
	const result = await exec("git", ["rev-parse", "--is-shallow-repository"], {
		cwd,
	});
	return result.stdout === "true";
}

export async function getFirstCommitAuthorDate(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string | null> {
	if (!hasHead) return null;
	// Find root commit(s)
	const revResult = await exec("git", ["rev-list", "--max-parents=0", "HEAD"], {
		cwd,
	});
	if (revResult.exitCode !== 0 || revResult.stdout === "") return null;

	const rootCommit = splitLines(revResult.stdout)[0];
	if (!rootCommit) return null;

	const result = await exec("git", ["log", rootCommit, "-1", "--format=%aI"], {
		cwd,
	});
	return result.exitCode === 0 ? result.stdout : null;
}

export async function collectMeta(
	exec: CommandExecutor,
	repoRoot: string,
	hasHead: boolean,
): Promise<GitMeta> {
	const [
		gitVersion,
		head,
		headShort,
		currentBranch,
		defaultBranch,
		remotes,
		isShallow,
		firstCommitAuthorDate,
	] = await Promise.all([
		getGitVersion(exec),
		getHead(exec, repoRoot, hasHead),
		getHeadShort(exec, repoRoot, hasHead),
		getCurrentBranch(exec, repoRoot),
		getDefaultBranch(exec, repoRoot),
		getRemotes(exec, repoRoot),
		getIsShallow(exec, repoRoot),
		getFirstCommitAuthorDate(exec, repoRoot, hasHead),
	]);

	return {
		gitVersion,
		repoRoot,
		repoName: deriveRepoName(repoRoot, remotes),
		head,
		headShort,
		currentBranch,
		defaultBranch,
		remotes,
		isShallow,
		firstCommitAuthorDate,
	};
}
