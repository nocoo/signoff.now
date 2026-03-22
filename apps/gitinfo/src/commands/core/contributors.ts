import type { CommandExecutor } from "../../executor/types.ts";
import { splitLines } from "../../utils/parse.ts";
import type {
	GitAuthorStats,
	GitAuthorSummary,
	GitContributors,
} from "../types.ts";

/**
 * Parse `git shortlog -sne` output into GitAuthorSummary[].
 * Each line: `  <count>\t<Name> <email>`
 */
function parseShortlog(output: string): GitAuthorSummary[] {
	const lines = splitLines(output);
	const results: GitAuthorSummary[] = [];

	for (const line of lines) {
		const match = line.match(/^\s*(\d+)\t(.+?)\s+<([^>]+)>$/);
		if (!match) continue;
		results.push({
			name: match[2] as string,
			email: match[3] as string,
			commits: Number.parseInt(match[1] as string, 10),
		});
	}

	return results;
}

/**
 * Parse `git log --numstat --pretty=tformat:'%aN <%aE>'` output into per-author stats.
 *
 * Format:
 * ```
 * Author Name <email>
 *
 * <added>\t<deleted>\t<file>
 * <added>\t<deleted>\t<file>
 *
 * Next Author <email>
 * ...
 * ```
 *
 * Binary files show `-` for added/deleted — skip those lines.
 */
function parseNumstatLog(output: string): GitAuthorStats[] {
	const lines = output.split("\n");
	const statsMap = new Map<string, GitAuthorStats>();
	let currentAuthor: string | null = null;
	let currentEmail: string | null = null;

	for (const line of lines) {
		// Try to match an author line: "Name <email>"
		const authorMatch = line.match(/^(.+?)\s+<([^>]+)>$/);
		if (authorMatch) {
			currentAuthor = authorMatch[1] as string;
			currentEmail = authorMatch[2] as string;
			continue;
		}

		// Try to match a numstat line: "<added>\t<deleted>\t<file>"
		const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t.+$/);
		if (numstatMatch && currentAuthor !== null && currentEmail !== null) {
			const addedStr = numstatMatch[1] as string;
			const deletedStr = numstatMatch[2] as string;

			// Skip binary files (shown as `-`)
			if (addedStr === "-" || deletedStr === "-") continue;

			const added = Number.parseInt(addedStr, 10);
			const deleted = Number.parseInt(deletedStr, 10);
			const key = `${currentAuthor} <${currentEmail}>`;

			const existing = statsMap.get(key);
			if (existing) {
				existing.linesAdded += added;
				existing.linesDeleted += deleted;
			} else {
				statsMap.set(key, {
					name: currentAuthor,
					email: currentEmail,
					linesAdded: added,
					linesDeleted: deleted,
				});
			}
		}
	}

	return Array.from(statsMap.values());
}

export async function getAuthors(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitAuthorSummary[]> {
	if (!hasHead) return [];
	const result = await exec(
		"git",
		["shortlog", "-sne", "--no-merges", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0) return [];
	return parseShortlog(result.stdout);
}

export async function getActiveRecent(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<number> {
	if (!hasHead) return 0;
	const result = await exec(
		"git",
		["shortlog", "-sne", "--no-merges", "--since=90 days ago", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0) return 0;
	return parseShortlog(result.stdout).length;
}

export async function getAuthorStats(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitAuthorStats[] | undefined> {
	if (!hasHead) return [];
	const result = await exec(
		"git",
		["log", "--numstat", "--pretty=tformat:%aN <%aE>", "-n", "1000", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0) return undefined;
	return parseNumstatLog(result.stdout);
}

export async function collectContributors(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
	includeSlow: boolean,
): Promise<GitContributors> {
	const [authors, activeRecent, authorStats] = await Promise.all([
		getAuthors(exec, cwd, hasHead),
		getActiveRecent(exec, cwd, hasHead),
		includeSlow
			? getAuthorStats(exec, cwd, hasHead)
			: Promise.resolve(undefined),
	]);

	return {
		authors,
		totalAuthors: authors.length,
		activeRecent,
		authorStats,
	};
}
