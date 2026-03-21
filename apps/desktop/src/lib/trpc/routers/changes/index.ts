/**
 * Changes router — git operations for diff viewing, staging, committing.
 *
 * Uses simple-git under the hood. The router follows the factory pattern:
 * - createChangesRouter(getGit) returns plain async functions (testable)
 * - createChangesTrpcRouter(getGit) wraps in tRPC procedures
 *
 * getGit is a factory that creates a simple-git instance for a given path.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────

export interface ChangedFile {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "untracked";
	staged: boolean;
}

interface GitStatus {
	files: ChangedFile[];
	branch: string | null;
	tracking: string | null;
}

interface DiffResult {
	diff: string;
	filePath: string;
}

interface CommitResult {
	hash: string;
	summary: { changes: number; insertions: number; deletions: number };
}

interface LogEntry {
	hash: string;
	date: string;
	message: string;
	author_name: string;
}

interface LogResult {
	latest: LogEntry | null;
	all: LogEntry[];
	total: number;
}

// ── Helpers ───────────────────────────────────────────

function mapFileStatus(
	index: string,
	workingDir: string,
): ChangedFile["status"] {
	if (index === "?" || workingDir === "?") return "untracked";
	if (index === "A" || workingDir === "A") return "added";
	if (index === "D" || workingDir === "D") return "deleted";
	if (index === "R" || workingDir === "R") return "renamed";
	return "modified";
}

function isStaged(index: string): boolean {
	return index !== " " && index !== "?";
}

// ── Factory ───────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: simple-git instance type varies between test mock and production
type GitFactory = (cwd?: string) => any;

export function createChangesRouter(getGit: GitFactory) {
	return {
		async status(input: { workspacePath: string }): Promise<GitStatus> {
			const git = getGit(input.workspacePath);
			const result = await git.status();
			return {
				files: result.files.map(
					(f: { path: string; index: string; working_dir: string }) => ({
						path: f.path,
						status: mapFileStatus(f.index, f.working_dir),
						staged: isStaged(f.index),
					}),
				),
				branch: result.current ?? null,
				tracking: result.tracking ?? null,
			};
		},

		async diff(input: {
			workspacePath: string;
			filePath: string;
			staged?: boolean;
		}): Promise<DiffResult> {
			const git = getGit(input.workspacePath);
			const options = input.staged
				? ["--cached", "--", input.filePath]
				: ["--", input.filePath];
			const diffText = await git.diff(options);
			return { diff: diffText, filePath: input.filePath };
		},

		async stage(input: {
			workspacePath: string;
			filePaths: string[];
		}): Promise<void> {
			const git = getGit(input.workspacePath);
			await git.add(input.filePaths);
		},

		async unstage(input: {
			workspacePath: string;
			filePaths: string[];
		}): Promise<void> {
			const git = getGit(input.workspacePath);
			await git.reset(["HEAD", "--", ...input.filePaths]);
		},

		async commit(input: {
			workspacePath: string;
			message: string;
		}): Promise<CommitResult> {
			const git = getGit(input.workspacePath);
			const result = await git.commit(input.message);
			return {
				hash: result.commit,
				summary: result.summary ?? { changes: 0, insertions: 0, deletions: 0 },
			};
		},

		async discard(input: {
			workspacePath: string;
			filePaths: string[];
		}): Promise<void> {
			const git = getGit(input.workspacePath);
			await git.checkout(["--", ...input.filePaths]);
		},

		async log(input: {
			workspacePath: string;
			limit?: number;
		}): Promise<LogResult> {
			const git = getGit(input.workspacePath);
			const result = await git.log({ maxCount: input.limit ?? 20 });
			return {
				latest: result.latest
					? {
							hash: result.latest.hash,
							date: result.latest.date,
							message: result.latest.message,
							author_name: result.latest.author_name,
						}
					: null,
				all: result.all ?? [],
				total: result.total ?? 0,
			};
		},
	};
}

// ── tRPC wrapper ──────────────────────────────────────

export function createChangesTrpcRouter(getGit: GitFactory) {
	const impl = createChangesRouter(getGit);

	return router({
		status: publicProcedure
			.input(z.object({ workspacePath: z.string() }))
			.query(({ input }) => impl.status(input)),

		diff: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					filePath: z.string(),
					staged: z.boolean().optional(),
				}),
			)
			.query(({ input }) => impl.diff(input)),

		stage: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					filePaths: z.array(z.string()),
				}),
			)
			.mutation(({ input }) => impl.stage(input)),

		unstage: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					filePaths: z.array(z.string()),
				}),
			)
			.mutation(({ input }) => impl.unstage(input)),

		commit: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					message: z.string(),
				}),
			)
			.mutation(({ input }) => impl.commit(input)),

		discard: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					filePaths: z.array(z.string()),
				}),
			)
			.mutation(({ input }) => impl.discard(input)),

		log: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					limit: z.number().optional(),
				}),
			)
			.query(({ input }) => impl.log(input)),
	});
}
