import type { CommandExecutor } from "../../executor/types.ts";
import { splitLines } from "../../utils/parse.ts";
import type { CommitFrequency, GitCommitSummary, GitLogs } from "../types.ts";

export async function getTotalCommits(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<number> {
	if (!hasHead) return 0;
	const result = await exec("git", ["rev-list", "--count", "HEAD"], { cwd });
	if (result.exitCode !== 0) return 0;
	return Number.parseInt(result.stdout, 10) || 0;
}

export async function getTotalMerges(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<number> {
	if (!hasHead) return 0;
	const result = await exec(
		"git",
		["rev-list", "--merges", "--count", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0) return 0;
	return Number.parseInt(result.stdout, 10) || 0;
}

export async function getFirstCommitDate(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string | null> {
	if (!hasHead) return null;
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

export async function getLastCommit(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitCommitSummary | null> {
	if (!hasHead) return null;
	const result = await exec(
		"git",
		["log", "-1", "--format=%H%n%h%n%aN <%aE>%n%aI%n%s"],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return null;

	const lines = result.stdout.split("\n");
	if (lines.length < 5) return null;

	return {
		sha: lines[0] as string,
		shaShort: lines[1] as string,
		author: lines[2] as string,
		date: lines[3] as string,
		subject: lines[4] as string,
	};
}

export async function getCommitFrequency(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<CommitFrequency | undefined> {
	if (!hasHead) return { byDayOfWeek: {}, byHour: {}, byMonth: {} };

	const [dayResult, hourResult, monthResult] = await Promise.all([
		exec(
			"git",
			["log", "--format=%ad", "--date=format:%a", "--since=1 year ago", "HEAD"],
			{ cwd },
		),
		exec(
			"git",
			["log", "--format=%ad", "--date=format:%H", "--since=1 year ago", "HEAD"],
			{ cwd },
		),
		exec(
			"git",
			[
				"log",
				"--format=%ad",
				"--date=format:%Y-%m",
				"--since=1 year ago",
				"HEAD",
			],
			{ cwd },
		),
	]);

	const countLines = (stdout: string): Record<string, number> => {
		const map: Record<string, number> = {};
		for (const line of splitLines(stdout)) {
			map[line] = (map[line] ?? 0) + 1;
		}
		return map;
	};

	return {
		byDayOfWeek: countLines(dayResult.stdout),
		byHour: countLines(hourResult.stdout),
		byMonth: countLines(monthResult.stdout),
	};
}

export async function getConventionalTypes(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<Record<string, number> | undefined> {
	if (!hasHead) return {};

	const result = await exec(
		"git",
		["log", "--format=%s", "-n", "1000", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return undefined;

	const pattern = /^(\w+)(?:\(.+\))?!?:/;
	const types: Record<string, number> = {};

	for (const line of splitLines(result.stdout)) {
		const match = line.match(pattern);
		if (match) {
			const type = match[1] as string;
			types[type] = (types[type] ?? 0) + 1;
		}
	}

	return types;
}

export async function collectLogs(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
	includeSlow: boolean,
): Promise<GitLogs> {
	const [totalCommits, totalMerges, firstCommitDate, lastCommit] =
		await Promise.all([
			getTotalCommits(exec, cwd, hasHead),
			getTotalMerges(exec, cwd, hasHead),
			getFirstCommitDate(exec, cwd, hasHead),
			getLastCommit(exec, cwd, hasHead),
		]);

	const logs: GitLogs = {
		totalCommits,
		totalMerges,
		firstCommitDate,
		lastCommit,
	};

	if (includeSlow) {
		const [commitFrequency, conventionalTypes] = await Promise.all([
			getCommitFrequency(exec, cwd, hasHead),
			getConventionalTypes(exec, cwd, hasHead),
		]);
		logs.commitFrequency = commitFrequency;
		logs.conventionalTypes = conventionalTypes;
	}

	return logs;
}
