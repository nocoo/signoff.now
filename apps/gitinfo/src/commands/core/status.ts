import type { CommandExecutor, FsReader } from "../../executor/types.ts";
import { splitLines, splitNul } from "../../utils/parse.ts";
import type { GitStatus, GitStatusEntry, RepoState } from "../types.ts";

export async function parseStatus(
	exec: CommandExecutor,
	cwd: string,
): Promise<{
	staged: GitStatusEntry[];
	modified: GitStatusEntry[];
	untracked: string[];
	conflicted: string[];
}> {
	const result = await exec("git", ["status", "--porcelain=v2", "-z"], { cwd });
	if (result.exitCode !== 0) {
		return { staged: [], modified: [], untracked: [], conflicted: [] };
	}

	const staged: GitStatusEntry[] = [];
	const modified: GitStatusEntry[] = [];
	const untracked: string[] = [];
	const conflicted: string[] = [];

	const tokens = splitNul(result.stdout);
	let i = 0;

	while (i < tokens.length) {
		const token = tokens[i] as string;

		// Untracked: ? <path>
		if (token.startsWith("? ")) {
			untracked.push(token.slice(2));
			i++;
			continue;
		}

		// Ignored: ! <path>
		if (token.startsWith("! ")) {
			i++;
			continue;
		}

		// Unmerged: u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
		if (token.startsWith("u ")) {
			const parts = token.split(" ");
			const path = parts.slice(10).join(" ");
			conflicted.push(path);
			i++;
			continue;
		}

		// Changed: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
		if (token.startsWith("1 ")) {
			const xy = token.slice(2, 4);
			const indexStatus = xy[0] as string;
			const workTreeStatus = xy[1] as string;
			const parts = token.split(" ");
			const path = parts.slice(8).join(" ");

			if (indexStatus !== ".") {
				staged.push({ path, indexStatus, workTreeStatus });
			}
			if (workTreeStatus !== ".") {
				modified.push({ path, indexStatus, workTreeStatus });
			}
			i++;
			continue;
		}

		// Rename/Copy: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
		if (token.startsWith("2 ")) {
			const xy = token.slice(2, 4);
			const indexStatus = xy[0] as string;
			const workTreeStatus = xy[1] as string;
			const parts = token.split(" ");
			const scoreField = parts[8] as string;
			const renameScore = Number.parseInt(scoreField.slice(1), 10);
			const path = parts.slice(9).join(" ");

			i++;
			const sourcePath = tokens[i] as string | undefined;

			const entry: GitStatusEntry = {
				path,
				indexStatus,
				workTreeStatus,
				sourcePath: sourcePath ?? undefined,
				renameScore: Number.isNaN(renameScore) ? undefined : renameScore,
			};

			if (indexStatus !== ".") {
				staged.push(entry);
			}
			if (workTreeStatus !== ".") {
				modified.push(entry);
			}
			i++;
			continue;
		}

		i++;
	}

	return { staged, modified, untracked, conflicted };
}

export async function getStashCount(
	exec: CommandExecutor,
	cwd: string,
): Promise<number> {
	const result = await exec("git", ["stash", "list"], { cwd });
	if (result.exitCode !== 0 || result.stdout === "") return 0;
	return splitLines(result.stdout).length;
}

export async function getRepoState(
	fs: FsReader,
	gitPath: (name: string) => Promise<string>,
): Promise<RepoState> {
	const checks: [string, RepoState][] = [
		["MERGE_HEAD", "merge"],
		["rebase-merge", "rebase-interactive"],
		["rebase-apply", "rebase"],
		["CHERRY_PICK_HEAD", "cherry-pick"],
		["BISECT_LOG", "bisect"],
		["REVERT_HEAD", "revert"],
	];

	for (const [file, state] of checks) {
		const path = await gitPath(file);
		if (await fs.exists(path)) {
			return state;
		}
	}

	return "clean";
}

export async function collectStatus(
	exec: CommandExecutor,
	fs: FsReader,
	cwd: string,
	gitPath: (name: string) => Promise<string>,
): Promise<GitStatus> {
	const [statusResult, stashCount, repoState] = await Promise.all([
		parseStatus(exec, cwd),
		getStashCount(exec, cwd),
		getRepoState(fs, gitPath),
	]);

	return {
		...statusResult,
		stashCount,
		repoState,
	};
}
