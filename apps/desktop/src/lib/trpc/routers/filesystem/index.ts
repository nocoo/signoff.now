/**
 * Filesystem router — file operations for the workspace.
 *
 * Wraps @signoff/workspace-fs operations via tRPC.
 * Factory pattern: createFilesystemRouter(fs) returns plain functions.
 *
 * Operations: listDirectory, readFile, writeFile, createDirectory,
 * deletePath, movePath, getMetadata.
 */

import { join } from "node:path";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────

export interface DirectoryEntry {
	name: string;
	isDirectory: boolean;
	isSymlink: boolean;
	size: number;
}

export interface FileContent {
	content: string;
	encoding: string;
}

export interface FileMetadata {
	name: string;
	isDirectory: boolean;
	isSymlink: boolean;
	size: number;
	mtime: number;
}

// ── Factory ───────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: workspace-fs interface varies between mock and production
type FsOperations = any;

export function createFilesystemRouter(fs: FsOperations) {
	return {
		async listDirectory(input: {
			workspacePath: string;
			relativePath: string;
		}): Promise<{ entries: DirectoryEntry[] }> {
			const fullPath = join(input.workspacePath, input.relativePath);
			const entries = await fs.listDirectory({
				workspacePath: input.workspacePath,
				path: fullPath,
			});
			return { entries };
		},

		async readFile(input: {
			workspacePath: string;
			relativePath: string;
		}): Promise<FileContent> {
			const fullPath = join(input.workspacePath, input.relativePath);
			return fs.readFile({
				workspacePath: input.workspacePath,
				path: fullPath,
			});
		},

		async writeFile(input: {
			workspacePath: string;
			relativePath: string;
			content: string;
		}): Promise<void> {
			const fullPath = join(input.workspacePath, input.relativePath);
			await fs.writeFile({
				workspacePath: input.workspacePath,
				path: fullPath,
				content: input.content,
			});
		},

		async createDirectory(input: {
			workspacePath: string;
			relativePath: string;
		}): Promise<void> {
			const fullPath = join(input.workspacePath, input.relativePath);
			await fs.createDirectory({
				workspacePath: input.workspacePath,
				path: fullPath,
			});
		},

		async deletePath(input: {
			workspacePath: string;
			relativePath: string;
			permanent?: boolean;
		}): Promise<void> {
			const fullPath = join(input.workspacePath, input.relativePath);
			await fs.deletePath({
				workspacePath: input.workspacePath,
				path: fullPath,
				permanent: input.permanent ?? true,
			});
		},

		async movePath(input: {
			workspacePath: string;
			sourcePath: string;
			destinationPath: string;
		}): Promise<void> {
			const srcFull = join(input.workspacePath, input.sourcePath);
			const dstFull = join(input.workspacePath, input.destinationPath);
			await fs.movePath({
				workspacePath: input.workspacePath,
				sourcePath: srcFull,
				destinationPath: dstFull,
			});
		},

		async getMetadata(input: {
			workspacePath: string;
			relativePath: string;
		}): Promise<FileMetadata> {
			const fullPath = join(input.workspacePath, input.relativePath);
			return fs.getMetadata({ path: fullPath });
		},
	};
}

// ── tRPC wrapper ──────────────────────────────────────

export function createFilesystemTrpcRouter(fs: FsOperations) {
	const impl = createFilesystemRouter(fs);

	return router({
		listDirectory: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
				}),
			)
			.query(({ input }) => impl.listDirectory(input)),

		readFile: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
				}),
			)
			.query(({ input }) => impl.readFile(input)),

		writeFile: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
					content: z.string(),
				}),
			)
			.mutation(({ input }) => impl.writeFile(input)),

		createDirectory: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
				}),
			)
			.mutation(({ input }) => impl.createDirectory(input)),

		deletePath: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
					permanent: z.boolean().optional(),
				}),
			)
			.mutation(({ input }) => impl.deletePath(input)),

		movePath: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					sourcePath: z.string(),
					destinationPath: z.string(),
				}),
			)
			.mutation(({ input }) => impl.movePath(input)),

		getMetadata: publicProcedure
			.input(
				z.object({
					workspacePath: z.string(),
					relativePath: z.string(),
				}),
			)
			.query(({ input }) => impl.getMetadata(input)),
	});
}
