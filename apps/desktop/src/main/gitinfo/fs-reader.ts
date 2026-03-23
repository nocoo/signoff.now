/**
 * Node.js FsReader implementation using `node:fs/promises`.
 *
 * Copied from gitinfo's bun-fs-reader.ts — uses only standard Node APIs
 * despite the original name. The `du -sk` call goes through the injected
 * CommandExecutor (which is our Node spawn-based executor).
 */

import { readdir, stat } from "node:fs/promises";
import type { CommandExecutor, FsReader } from "@signoff/gitinfo/executor";

export function createNodeFsReader(exec: CommandExecutor): FsReader {
	return {
		async exists(path: string): Promise<boolean> {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},
		async readdir(dirPath: string): Promise<string[]> {
			try {
				return await readdir(dirPath);
			} catch {
				return [];
			}
		},
		async fileSize(path: string): Promise<number> {
			return (await stat(path)).size;
		},
		async dirSizeKiB(path: string): Promise<number> {
			const result = await exec("du", ["-sk", path]);
			if (result.exitCode !== 0) return 0;
			const sizeStr = result.stdout.split("\t")[0];
			return sizeStr ? Number.parseInt(sizeStr, 10) : 0;
		},
	};
}
