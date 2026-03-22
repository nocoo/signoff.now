import type { FsReader } from "./types.ts";

export function createMockFsReader(opts?: {
	files?: Map<string, string[]>;
	exists?: Map<string, boolean>;
	fileSizes?: Map<string, number>;
	sizes?: Map<string, number>;
}): FsReader {
	return {
		async exists(path: string): Promise<boolean> {
			return opts?.exists?.get(path) ?? false;
		},

		async readdir(path: string): Promise<string[]> {
			return opts?.files?.get(path) ?? [];
		},

		async fileSize(path: string): Promise<number> {
			const size = opts?.fileSizes?.get(path);
			if (size === undefined) {
				throw new Error(`No mock fileSize for: ${path}`);
			}
			return size;
		},

		async dirSizeKiB(path: string): Promise<number> {
			return opts?.sizes?.get(path) ?? 0;
		},
	};
}
