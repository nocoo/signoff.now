import type { CommandExecutor } from "../../executor/types.ts";
import { splitLines } from "../../utils/parse.ts";
import type { GitBranches, GitBranchInfo } from "../types.ts";

export async function getCurrentBranchName(
	exec: CommandExecutor,
	cwd: string,
): Promise<string | null> {
	const result = await exec("git", ["branch", "--show-current"], { cwd });
	if (result.exitCode !== 0) return null;
	return result.stdout === "" ? null : result.stdout;
}

export async function getLocalBranches(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitBranchInfo[]> {
	if (!hasHead) return [];

	const result = await exec(
		"git",
		[
			"for-each-ref",
			"--format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict)",
			"refs/heads/",
		],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return [];

	// Get merged branches for isMerged check
	const mergedResult = await exec("git", ["branch", "--merged", "HEAD"], {
		cwd,
	});
	const mergedSet = new Set<string>();
	if (mergedResult.exitCode === 0 && mergedResult.stdout !== "") {
		for (const line of splitLines(mergedResult.stdout)) {
			// git branch output has "* current" or "  branch" prefix
			mergedSet.add(line.replace(/^[\s*]+/, ""));
		}
	}

	const lines = splitLines(result.stdout);
	const branches: GitBranchInfo[] = [];

	for (const line of lines) {
		const parts = line.split("\t");
		const name = parts[0] ?? "";
		const upstream = parts[1] || null;
		const trackInfo = parts[2] ?? "";
		const lastCommitDate = parts[3] ?? "";

		let aheadBehind: { ahead: number; behind: number } | null = null;
		if (upstream) {
			aheadBehind = parseTrack(trackInfo);
		}

		branches.push({
			name,
			upstream,
			aheadBehind,
			lastCommitDate,
			isMerged: mergedSet.has(name),
		});
	}

	return branches;
}

/**
 * Parse `%(upstream:track)` output into ahead/behind counts.
 * Formats: "[ahead N]", "[behind N]", "[ahead N, behind M]", "" (up to date), "[gone]"
 */
function parseTrack(track: string): { ahead: number; behind: number } | null {
	if (track === "[gone]") return null;

	// Empty string means up-to-date (called only when upstream exists)
	if (track === "") return { ahead: 0, behind: 0 };

	let ahead = 0;
	let behind = 0;

	const aheadMatch = track.match(/ahead (\d+)/);
	if (aheadMatch) {
		ahead = Number.parseInt(aheadMatch[1] as string, 10);
	}

	const behindMatch = track.match(/behind (\d+)/);
	if (behindMatch) {
		behind = Number.parseInt(behindMatch[1] as string, 10);
	}

	return { ahead, behind };
}

export async function getRemoteBranches(
	exec: CommandExecutor,
	cwd: string,
): Promise<string[]> {
	const result = await exec(
		"git",
		[
			"for-each-ref",
			"--format=%(if)%(symref)%(then)%(else)%(refname:short)%(end)",
			"refs/remotes/",
		],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return [];

	// Filter empty lines (symbolic refs produce empty output)
	return splitLines(result.stdout);
}

export async function getTotalLocal(
	exec: CommandExecutor,
	cwd: string,
): Promise<number> {
	const result = await exec(
		"git",
		["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return 0;
	return splitLines(result.stdout).length;
}

export async function collectBranches(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitBranches> {
	const [current, local, remote, totalLocal] = await Promise.all([
		getCurrentBranchName(exec, cwd),
		getLocalBranches(exec, cwd, hasHead),
		getRemoteBranches(exec, cwd),
		getTotalLocal(exec, cwd),
	]);

	return {
		current,
		local,
		remote,
		totalLocal,
		totalRemote: remote.length,
	};
}
