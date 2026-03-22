import type { CommandExecutor, FsReader } from "../../executor/types.ts";
import { getExtension, splitLines, splitNul } from "../../utils/parse.ts";
import type {
	FileSizeInfo,
	GitBlobInfo,
	GitFileChurn,
	GitFiles,
} from "../types.ts";

interface TrackedFile {
	path: string;
	mode: string;
}

/**
 * Parse `git ls-files -z --stage` output into tracked file entries.
 * Excludes gitlink entries (mode 160000) and deduplicates by path
 * (conflict stages produce multiple entries for the same path).
 */
export async function parseTrackedFiles(
	exec: CommandExecutor,
	cwd: string,
): Promise<TrackedFile[]> {
	const result = await exec("git", ["ls-files", "-z", "--stage"], { cwd });
	if (result.exitCode !== 0 || result.stdout === "") return [];

	const tokens = splitNul(result.stdout);
	const seen = new Set<string>();
	const files: TrackedFile[] = [];

	for (const token of tokens) {
		// Format: <mode> <sha> <stage>\t<path>
		const tabIdx = token.indexOf("\t");
		if (tabIdx === -1) continue;

		const meta = token.slice(0, tabIdx);
		const path = token.slice(tabIdx + 1);
		const mode = meta.split(" ")[0] ?? "";

		// Skip gitlink (submodule) entries
		if (mode === "160000") continue;

		// Deduplicate by path (conflict stages)
		if (seen.has(path)) continue;
		seen.add(path);

		files.push({ path, mode });
	}

	return files;
}

export function getTrackedCount(trackedFiles: TrackedFile[]): number {
	return trackedFiles.length;
}

export function getTypeDistribution(
	trackedFiles: TrackedFile[],
): Record<string, number> {
	const dist: Record<string, number> = {};
	for (const file of trackedFiles) {
		const ext = getExtension(file.path);
		dist[ext] = (dist[ext] ?? 0) + 1;
	}
	return dist;
}

/**
 * Count total lines across all tracked files using `wc -l`.
 * Silently skips files that fail (e.g. deleted but still in index).
 */
export async function getTotalLines(
	exec: CommandExecutor,
	cwd: string,
	trackedFiles: TrackedFile[],
): Promise<number> {
	let total = 0;
	for (const file of trackedFiles) {
		try {
			const result = await exec("wc", ["-l", "--", file.path], { cwd });
			if (result.exitCode !== 0) continue;
			const num = Number.parseInt(
				result.stdout.trim().split(/\s+/)[0] ?? "",
				10,
			);
			if (!Number.isNaN(num)) {
				total += num;
			}
		} catch {
			// Deleted file — skip silently
		}
	}
	return total;
}

/**
 * Get the largest tracked files by filesystem size.
 * Silently skips files that throw (e.g. deleted but still in index).
 * Returns top 10 sorted descending by size.
 */
export async function getLargestTracked(
	fs: FsReader,
	repoRoot: string,
	trackedFiles: TrackedFile[],
): Promise<FileSizeInfo[]> {
	const results: FileSizeInfo[] = [];
	for (const file of trackedFiles) {
		try {
			const sizeBytes = await fs.fileSize(`${repoRoot}/${file.path}`);
			results.push({ path: file.path, sizeBytes });
		} catch {
			// Deleted file — skip silently
		}
	}
	results.sort((a, b) => b.sizeBytes - a.sizeBytes);
	return results.slice(0, 10);
}

/**
 * Find the largest blobs across all history.
 * 1. `git rev-list --objects --all` → parse newline-separated lines
 *    Each line is "<sha>" or "<sha> <path>"
 * 2. `git cat-file --batch-check` with blob SHAs → filter type=blob
 * Returns top 10 sorted descending by size.
 */
export async function getLargestBlobs(
	exec: CommandExecutor,
	cwd: string,
): Promise<GitBlobInfo[]> {
	const revResult = await exec("git", ["rev-list", "--objects", "--all"], {
		cwd,
	});
	if (revResult.exitCode !== 0 || revResult.stdout === "") return [];

	// Each line is "<sha> <path>" or just "<sha>" (for trees/commits)
	const lines = splitLines(revResult.stdout);
	const shaToPath = new Map<string, string>();
	for (const line of lines) {
		const spaceIdx = line.indexOf(" ");
		if (spaceIdx === -1) continue;
		const sha = line.slice(0, spaceIdx);
		const path = line.slice(spaceIdx + 1);
		if (path !== "") {
			shaToPath.set(sha, path);
		}
	}

	if (shaToPath.size === 0) return [];

	// Pass SHAs as stdin via shell wrapper (CommandExecutor has no stdin support)
	const shasInput = Array.from(shaToPath.keys()).join("\\n");
	const batchResult = await exec(
		"sh",
		["-c", `printf '${shasInput}\\n' | git cat-file --batch-check`],
		{ cwd },
	);

	if (batchResult.exitCode !== 0 || batchResult.stdout === "") return [];

	const blobs: GitBlobInfo[] = [];
	for (const line of splitLines(batchResult.stdout)) {
		// Format: <sha> <type> <size>
		const parts = line.split(" ");
		if (parts.length < 3) continue;
		const sha = parts[0] as string;
		const type = parts[1] as string;
		const size = Number.parseInt(parts[2] as string, 10);
		if (type !== "blob" || Number.isNaN(size)) continue;
		const path = shaToPath.get(sha);
		if (!path) continue;
		blobs.push({ sha, path, sizeBytes: size });
	}

	blobs.sort((a, b) => b.sizeBytes - a.sizeBytes);
	return blobs.slice(0, 10);
}

/**
 * Find the most frequently changed files in the last 1000 commits.
 * `git log -z --pretty=format: --name-only -n 1000 HEAD`
 */
export async function getMostChanged(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<GitFileChurn[]> {
	if (!hasHead) return [];

	const result = await exec(
		"git",
		["log", "-z", "--pretty=format:", "--name-only", "-n", "1000", "HEAD"],
		{ cwd },
	);
	if (result.exitCode !== 0 || result.stdout === "") return [];

	const tokens = splitNul(result.stdout);
	const counts = new Map<string, number>();
	for (const token of tokens) {
		const name = token.trim();
		if (name === "") continue;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	const entries: GitFileChurn[] = Array.from(counts.entries()).map(
		([path, count]) => ({ path, count }),
	);
	entries.sort((a, b) => b.count - a.count);
	return entries.slice(0, 20);
}

/**
 * Find binary files by diffing an empty tree against HEAD.
 * Binary files show `-\t-` in numstat output.
 */
export async function getBinaryFiles(
	exec: CommandExecutor,
	cwd: string,
	hasHead: boolean,
): Promise<string[]> {
	if (!hasHead) return [];

	// Get empty tree SHA
	const emptyResult = await exec(
		"git",
		["hash-object", "-t", "tree", "/dev/null"],
		{ cwd },
	);
	if (emptyResult.exitCode !== 0 || emptyResult.stdout === "") return [];
	const emptyTree = emptyResult.stdout.trim();

	const diffResult = await exec(
		"git",
		["diff", "-z", "--numstat", emptyTree, "HEAD", "--"],
		{ cwd },
	);
	if (diffResult.exitCode !== 0 || diffResult.stdout === "") return [];

	const tokens = splitNul(diffResult.stdout);
	const binaries: string[] = [];

	// With -z, each NUL-delimited token is "<added>\t<deleted>\t<path>"
	// Binary files have "-\t-\t<path>"
	// Renames have "<added>\t<deleted>\t<srcpath>\0<dstpath>" (two NUL tokens for paths)
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i] as string;
		const parts = token.split("\t");
		if (parts.length >= 3 && parts[0] === "-" && parts[1] === "-") {
			// Binary: "-\t-\t<path>"
			const path = parts[2] as string;
			if (path !== "") {
				binaries.push(path);
			}
		}
	}

	return binaries;
}

export async function collectFiles(
	exec: CommandExecutor,
	fs: FsReader,
	cwd: string,
	hasHead: boolean,
	includeSlow: boolean,
): Promise<GitFiles> {
	const trackedFiles = await parseTrackedFiles(exec, cwd);

	const trackedCount = getTrackedCount(trackedFiles);
	const typeDistribution = getTypeDistribution(trackedFiles);

	const [totalLines, largestTracked] = await Promise.all([
		getTotalLines(exec, cwd, trackedFiles),
		getLargestTracked(fs, cwd, trackedFiles),
	]);

	const result: GitFiles = {
		trackedCount,
		typeDistribution,
		totalLines,
		largestTracked,
	};

	if (includeSlow) {
		const [largestBlobs, mostChanged, binaryFiles] = await Promise.all([
			getLargestBlobs(exec, cwd),
			getMostChanged(exec, cwd, hasHead),
			getBinaryFiles(exec, cwd, hasHead),
		]);
		result.largestBlobs = largestBlobs;
		result.mostChanged = mostChanged;
		result.binaryFiles = binaryFiles;
	}

	return result;
}
