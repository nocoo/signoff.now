/** Bun filesystem adapter — excluded from unit coverage. */
import type { FsLike } from "./bootstrap.ts";

export function createBunFs(): FsLike {
	return {
		async mkdir(path, opts) {
			const { mkdir } = await import("node:fs/promises");
			await mkdir(path, { recursive: opts?.recursive ?? true });
		},
		async writeFile(path, data) {
			await Bun.write(path, data);
		},
		async readFile(path) {
			return await Bun.file(path).text();
		},
		async stat(path) {
			const f = Bun.file(path);
			if (!(await f.exists())) {
				return null;
			}
			return { isDirectory: false };
		},
		async unlink(path) {
			const { unlink } = await import("node:fs/promises");
			await unlink(path);
		},
	};
}
