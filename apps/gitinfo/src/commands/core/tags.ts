import type { CommandExecutor } from "../../executor/types.ts";
import { splitLines } from "../../utils/parse.ts";
import type { GitTagInfo, GitTags } from "../types.ts";

export async function getTagCount(
	exec: CommandExecutor,
	cwd: string,
): Promise<number> {
	const result = await exec("git", ["tag", "-l"], { cwd });
	if (result.exitCode !== 0 || result.stdout === "") return 0;
	return splitLines(result.stdout).length;
}

export async function getTagDetails(
	exec: CommandExecutor,
	cwd: string,
): Promise<GitTagInfo[]> {
	const result = await exec(
		"git",
		[
			"for-each-ref",
			"--format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject)",
			"refs/tags/",
		],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return [];

	const lines = splitLines(result.stdout);
	const tags: GitTagInfo[] = [];

	for (const line of lines) {
		const parts = line.split("\t");
		const name = parts[0] ?? "";
		const objectType = parts[1] ?? "";
		const sha = parts[2] ?? "";
		const dateRaw = parts[3] ?? "";
		const messageRaw = parts[4] ?? "";

		const isAnnotated = objectType === "tag";

		tags.push({
			name,
			type: isAnnotated ? "annotated" : "lightweight",
			sha,
			date: isAnnotated ? dateRaw : null,
			message: isAnnotated && messageRaw !== "" ? messageRaw : null,
		});
	}

	return tags;
}

export async function getLatestReachableTag(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string | null> {
	if (!hasHead) return null;
	const result = await exec("git", ["describe", "--tags", "--abbrev=0"], {
		cwd,
	});
	if (result.exitCode !== 0) return null;
	return result.stdout === "" ? null : result.stdout;
}

export async function getCommitsSinceTag(
	exec: CommandExecutor,
	cwd: string,
	tag: string | null,
): Promise<number | null> {
	if (tag === null) return null;
	const result = await exec("git", ["rev-list", `${tag}..HEAD`, "--count"], {
		cwd,
	});
	if (result.exitCode !== 0) return null;
	const count = Number.parseInt(result.stdout, 10);
	return Number.isNaN(count) ? null : count;
}

export async function collectTags(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitTags> {
	const [count, tags, latestReachableTag] = await Promise.all([
		getTagCount(exec, cwd),
		getTagDetails(exec, cwd),
		getLatestReachableTag(exec, cwd, hasHead),
	]);

	const commitsSinceTag = await getCommitsSinceTag(
		exec,
		cwd,
		latestReachableTag,
	);

	return {
		count,
		tags,
		latestReachableTag,
		commitsSinceTag,
	};
}
