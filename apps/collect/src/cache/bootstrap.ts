import type { BootstrapSnapshot } from "../pipeline/client.ts";

export type CachedBootstrap = BootstrapSnapshot & {
	/** ISO timestamp when cache was written (may equal snapshot.fetchedAt). */
	cachedAt: string;
};

export type FsLike = {
	mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
	writeFile: (path: string, data: string) => Promise<void>;
	readFile: (path: string) => Promise<string>;
	stat: (path: string) => Promise<{ isDirectory: boolean } | null>;
};

export function bootstrapCachePath(dataDir: string): string {
	return `${dataDir.replace(/\/+$/, "")}/cache/bootstrap.json`;
}

export async function ensureDataDirs(
	fs: FsLike,
	dataDir: string,
): Promise<void> {
	const root = dataDir.replace(/\/+$/, "");
	for (const sub of ["cache", "raw", "normalized"]) {
		await fs.mkdir(`${root}/${sub}`, { recursive: true });
	}
}

export async function writeBootstrapCache(
	fs: FsLike,
	dataDir: string,
	snapshot: BootstrapSnapshot,
): Promise<string> {
	await ensureDataDirs(fs, dataDir);
	const path = bootstrapCachePath(dataDir);
	const payload: CachedBootstrap = {
		...snapshot,
		cachedAt: new Date().toISOString(),
	};
	await fs.writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
	return path;
}

export async function readBootstrapCache(
	fs: FsLike,
	dataDir: string,
): Promise<CachedBootstrap | null> {
	const path = bootstrapCachePath(dataDir);
	try {
		const raw = await fs.readFile(path);
		const parsed = JSON.parse(raw) as CachedBootstrap;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!parsed.settings ||
			typeof parsed.settings.pipelineConfigVersion !== "number"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}
