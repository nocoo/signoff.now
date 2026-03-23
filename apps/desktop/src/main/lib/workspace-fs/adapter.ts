import { basename } from "node:path";
import type {
	DirectoryEntry,
	FileContent,
	FileMetadata,
} from "lib/trpc/routers/filesystem";
import { getFsHostService } from "./index";

/**
 * Adapts the filesystem router's call convention to FsHostService's interface.
 *
 * The router builds `fullPath = join(workspacePath, relativePath)` then calls
 * adapter methods with `{ workspacePath, path: fullPath }`.
 *
 * FsHostService expects `{ absolutePath }` on every method.
 *
 * Type mappings (router ← workspace-fs):
 *   DirectoryEntry { name, isDirectory, isSymlink, size }  ←  FsEntry { absolutePath, name, kind }
 *   FileContent { content, encoding }  ←  FsReadResult { kind, content, ... }
 *   FileMetadata { name, isDirectory, isSymlink, size, mtime }  ←  FsMetadata { absolutePath, kind, size, modifiedAt, ... }
 */
export function createFsAdapter() {
	return {
		listDirectory: async (input: {
			workspacePath: string;
			path: string;
		}): Promise<DirectoryEntry[]> => {
			const fs = getFsHostService(input.workspacePath);
			const result = await fs.listDirectory({
				absolutePath: input.path,
			});
			return result.entries.map((e) => ({
				name: e.name,
				isDirectory: e.kind === "directory",
				isSymlink: e.kind === "symlink",
				size: 0, // FsEntry doesn't carry size; enrichment deferred to getMetadata calls
			}));
		},

		readFile: async (input: {
			workspacePath: string;
			path: string;
		}): Promise<FileContent> => {
			const fs = getFsHostService(input.workspacePath);
			const result = await fs.readFile({
				absolutePath: input.path,
			});
			if (result.kind === "text") {
				return { content: result.content, encoding: "utf-8" };
			}
			// Binary: decode as latin1 to preserve byte values
			return {
				content: new TextDecoder("latin1").decode(result.content),
				encoding: "binary",
			};
		},

		writeFile: async (input: {
			workspacePath: string;
			path: string;
			content: string;
		}): Promise<void> => {
			const fs = getFsHostService(input.workspacePath);
			const result = await fs.writeFile({
				absolutePath: input.path,
				content: input.content,
			});
			if (!result.ok) {
				throw new Error(`writeFile failed: ${result.reason}`);
			}
		},

		createDirectory: async (input: {
			workspacePath: string;
			path: string;
		}): Promise<void> => {
			const fs = getFsHostService(input.workspacePath);
			await fs.createDirectory({
				absolutePath: input.path,
			});
		},

		deletePath: async (input: {
			workspacePath: string;
			path: string;
			permanent?: boolean;
		}): Promise<void> => {
			const fs = getFsHostService(input.workspacePath);
			await fs.deletePath({
				absolutePath: input.path,
				permanent: input.permanent,
			});
		},

		movePath: async (input: {
			workspacePath: string;
			sourcePath: string;
			destinationPath: string;
		}): Promise<void> => {
			const fs = getFsHostService(input.workspacePath);
			await fs.movePath({
				sourceAbsolutePath: input.sourcePath,
				destinationAbsolutePath: input.destinationPath,
			});
		},

		getMetadata: async (input: {
			workspacePath: string;
			path: string;
		}): Promise<FileMetadata> => {
			const fs = getFsHostService(input.workspacePath);
			const result = await fs.getMetadata({
				absolutePath: input.path,
			});
			if (!result) throw new Error(`File not found: ${input.path}`);
			return {
				name: basename(result.absolutePath),
				isDirectory: result.kind === "directory",
				isSymlink: result.kind === "symlink" || Boolean(result.symlinkTarget),
				size: result.size ?? 0,
				mtime: result.modifiedAt ? new Date(result.modifiedAt).getTime() : 0,
			};
		},
	};
}
