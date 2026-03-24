import type { CacheStore } from "./resolve-user.ts";
import type { IdentityMapCache } from "./types.ts";

/**
 * Default cache store using filesystem (~/.cache/pulse/identity-map.json).
 */
export function createFsCacheStore(): CacheStore {
	const cacheDir = `${process.env.HOME}/.cache/pulse`;
	const cacheFile = `${cacheDir}/identity-map.json`;

	return {
		async read(): Promise<IdentityMapCache | null> {
			try {
				const file = Bun.file(cacheFile);
				if (!(await file.exists())) return null;
				const raw = await file.text();
				return JSON.parse(raw) as IdentityMapCache;
			} catch {
				return null;
			}
		},
		async write(cache: IdentityMapCache): Promise<void> {
			try {
				const { mkdir } = await import("node:fs/promises");
				await mkdir(cacheDir, { recursive: true });
				await Bun.write(cacheFile, JSON.stringify(cache));
			} catch {
				// Cache write failure is non-fatal
			}
		},
	};
}
