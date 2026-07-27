/**
 * Durable local storage for collected payloads (07 §4).
 *
 * Two properties matter and neither is free:
 *
 * - **Atomic**: a crash mid-write must not leave a half-JSON file that a later
 *   run parses as truth. Everything goes to a temp file, then renames.
 * - **Immutable**: a PR can go abandoned → reopened → completed, so overwriting
 *   its snapshot destroys the evidence an older Activity was built from and
 *   breaks 01 §6.2's "rebuildable from raw".
 */

import { RAW_SCHEMA_VERSION } from "@signoff/domain";
import type { FsLike } from "../cache/bootstrap.ts";

/**
 * Make one path segment safe.
 *
 * Repo names can contain `/`, `..`, and characters that mean something to the
 * filesystem. `paths.ts` only trims slashes, so encoding here is what keeps a
 * hostile or merely awkward name inside `.data/`.
 */
export function safeSegment(segment: string): string {
	const encoded = encodeURIComponent(segment);
	if (encoded.length === 0) {
		throw new Error("path segment is empty after encoding");
	}
	return encoded;
}

/** Reject any path that escapes the data root, however it was built. */
export function assertUnderRoot(root: string, candidate: string): void {
	const normalise = (p: string) => {
		const out: string[] = [];
		for (const part of p.split("/")) {
			if (part === "" || part === ".") {
				continue;
			}
			if (part === "..") {
				out.pop();
				continue;
			}
			out.push(part);
		}
		return out.join("/");
	};
	const r = normalise(root);
	const c = normalise(candidate);
	if (c !== r && !c.startsWith(`${r}/`)) {
		throw new Error(`refusing to write outside ${root}: ${candidate}`);
	}
}

export type RawWriter = {
	/** Write a snapshot, returning the path it landed at. */
	writeSnapshot(opts: {
		dir: string;
		entityId: string | number;
		fetchedAt: number;
		collectRunId: string;
		payload: unknown;
	}): Promise<string>;
	/** Write an arbitrary JSON file atomically. */
	writeJson(path: string, value: unknown): Promise<void>;
};

export function createRawWriter(fs: FsLike, dataRoot: string): RawWriter {
	async function writeJson(path: string, value: unknown): Promise<void> {
		assertUnderRoot(dataRoot, path);
		const dir = path.slice(0, path.lastIndexOf("/"));
		await fs.mkdir(dir, { recursive: true });
		// Write-then-rename: a reader never sees a partial file, and a crash
		// leaves the previous version intact rather than a truncated one.
		const body = `${JSON.stringify(value, null, "\t")}\n`;
		const rename = fs.rename;
		if (!rename) {
			// No atomic rename available: writing directly is still better than
			// failing, but the caller loses the crash guarantee.
			await fs.writeFile(path, body);
			return;
		}
		const tmp = `${path}.tmp`;
		await fs.writeFile(tmp, body);
		await rename(tmp, path);
	}

	return {
		writeJson,
		async writeSnapshot({ dir, entityId, fetchedAt, collectRunId, payload }) {
			// `fetchedAt` is whole seconds, so two captures in the same second
			// would collide; the run id makes the name unique without a clock.
			const name = `${fetchedAt}-${safeSegment(collectRunId)}.json`;
			const path = `${dir}/${safeSegment(String(entityId))}/${name}`;
			await writeJson(path, {
				schemaVersion: RAW_SCHEMA_VERSION,
				fetchedAt,
				payload,
			});
			return path;
		},
	};
}
