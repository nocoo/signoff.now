import { readdir, stat } from "node:fs/promises";
import type { CommandExecutor, FsReader } from "./types.ts";

export function createBunFsReader(exec: CommandExecutor): FsReader {
	return {
		async exists(path: string): Promise<boolean> {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},

		async readdir(path: string): Promise<string[]> {
			try {
				const entries = await readdir(path);
				return entries;
			} catch {
				return [];
			}
		},

		async fileSize(path: string): Promise<number> {
			const s = await stat(path);
			return s.size;
		},

		async dirSizeKiB(path: string): Promise<number> {
			const result = await exec("du", ["-sk", path]);
			if (result.exitCode !== 0) {
				return 0;
			}
			const sizeStr = result.stdout.split("\t")[0];
			return sizeStr ? Number.parseInt(sizeStr, 10) : 0;
		},
	};
}
