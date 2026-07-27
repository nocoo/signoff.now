import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import { assertUnderRoot, createRawWriter, safeSegment } from "./storage.ts";

function memoryFs() {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	const fs: FsLike = {
		async mkdir(path) {
			dirs.add(path);
		},
		async writeFile(path, data) {
			files.set(path, data);
		},
		async rename(from, to) {
			const v = files.get(from);
			if (v === undefined) {
				throw new Error(`rename source missing: ${from}`);
			}
			files.delete(from);
			files.set(to, v);
		},
		async readFile(path) {
			const v = files.get(path);
			if (v === undefined) {
				throw new Error(`no such file: ${path}`);
			}
			return v;
		},
		async stat(path) {
			return files.has(path) ? { isDirectory: false } : null;
		},
		async unlink(path) {
			files.delete(path);
		},
	};
	return { fs, files, dirs };
}

describe("safeSegment", () => {
	test("encodes separators so a name cannot become a directory", () => {
		expect(safeSegment("a/b")).toBe("a%2Fb");
		expect(safeSegment("..")).toBe("..");
		expect(safeSegment("../../etc")).toBe("..%2F..%2Fetc");
	});

	test("leaves ordinary names readable", () => {
		expect(safeSegment("alpha-repo")).toBe("alpha-repo");
		expect(safeSegment("1615473")).toBe("1615473");
	});

	test("refuses an empty segment", () => {
		expect(() => safeSegment("")).toThrow();
	});
});

describe("assertUnderRoot", () => {
	test("accepts paths inside the root", () => {
		expect(() => assertUnderRoot(".data", ".data/raw/x.json")).not.toThrow();
		expect(() => assertUnderRoot(".data", ".data")).not.toThrow();
	});

	test("rejects traversal, however it is spelled", () => {
		expect(() => assertUnderRoot(".data", ".data/../etc/passwd")).toThrow();
		expect(() => assertUnderRoot(".data", "../outside.json")).toThrow();
		expect(() => assertUnderRoot(".data", ".data/a/../../b")).toThrow();
	});

	test("rejects a sibling directory with a shared prefix", () => {
		// `.data-evil` starts with `.data` textually but is not inside it.
		expect(() => assertUnderRoot(".data", ".data-evil/x")).toThrow();
	});
});

describe("createRawWriter", () => {
	test("publishes via rename so a reader never sees a partial file", async () => {
		const { fs, files } = memoryFs();
		const seenDuringWrite: string[] = [];
		const w = createRawWriter(
			{
				...fs,
				async writeFile(path, data) {
					seenDuringWrite.push(path);
					await fs.writeFile(path, data);
				},
			},
			".data",
		);

		await w.writeJson(".data/meta/cursor.json", { a: 1 });

		// The bytes land under a temp name first; only the rename publishes them.
		expect(seenDuringWrite).toEqual([".data/meta/cursor.json.tmp"]);
		expect(files.has(".data/meta/cursor.json.tmp")).toBe(false);
		expect(JSON.parse(files.get(".data/meta/cursor.json") as string)).toEqual({
			a: 1,
		});
	});

	test("falls back to a direct write when rename is unavailable", async () => {
		const { fs, files } = memoryFs();
		const { rename: _drop, ...noRename } = fs;
		const w = createRawWriter(noRename as FsLike, ".data");
		await w.writeJson(".data/x.json", { a: 1 });
		expect(files.has(".data/x.json")).toBe(true);
	});

	test("refuses to write outside the data root", async () => {
		const { fs } = memoryFs();
		const w = createRawWriter(fs, ".data");
		await expect(w.writeJson("/etc/passwd", {})).rejects.toThrow();
		await expect(w.writeJson(".data/../x.json", {})).rejects.toThrow();
	});

	test("snapshots include the run id so one second cannot collide", async () => {
		const { fs, files } = memoryFs();
		const w = createRawWriter(fs, ".data");
		const dir = ".data/raw/ado/acme/Alpha/repos/alpha-repo/prs";

		const a = await w.writeSnapshot({
			dir,
			entityId: 1615473,
			fetchedAt: 1_784_737_800,
			collectRunId: "01JRUNA",
			payload: { pullRequestId: 1615473 },
		});
		const b = await w.writeSnapshot({
			dir,
			entityId: 1615473,
			fetchedAt: 1_784_737_800,
			collectRunId: "01JRUNB",
			payload: { pullRequestId: 1615473, status: "completed" },
		});

		// A PR can go abandoned → reopened → completed; overwriting the earlier
		// capture would destroy the evidence its Activity was built from.
		expect(a).not.toBe(b);
		expect(files.size).toBe(2);
	});

	test("snapshots carry the schema version and fetch time", async () => {
		const { fs, files } = memoryFs();
		const w = createRawWriter(fs, ".data");
		const path = await w.writeSnapshot({
			dir: ".data/raw/x",
			entityId: 7,
			fetchedAt: 1_784_737_800,
			collectRunId: "01JRUN",
			payload: { id: 7 },
		});
		expect(JSON.parse(files.get(path) as string)).toEqual({
			schemaVersion: 1,
			fetchedAt: 1_784_737_800,
			payload: { id: 7 },
		});
	});

	test("an entity id containing a separator cannot escape its directory", async () => {
		const { fs, files } = memoryFs();
		const w = createRawWriter(fs, ".data");
		const path = await w.writeSnapshot({
			dir: ".data/raw/x",
			entityId: "../../escape",
			fetchedAt: 1,
			collectRunId: "r",
			payload: {},
		});
		expect(path.startsWith(".data/raw/x/")).toBe(true);
		expect([...files.keys()].every((k) => k.startsWith(".data/"))).toBe(true);
	});
});
