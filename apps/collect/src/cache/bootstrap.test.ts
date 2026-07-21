import { describe, expect, test } from "bun:test";
import {
	bootstrapCachePath,
	ensureDataDirs,
	type FsLike,
	readBootstrapCache,
	writeBootstrapCache,
} from "./bootstrap.ts";

function memFs(): FsLike & { files: Map<string, string>; dirs: Set<string> } {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	return {
		files,
		dirs,
		async mkdir(path) {
			dirs.add(path);
		},
		async writeFile(path, data) {
			files.set(path, data);
		},
		async readFile(path) {
			const v = files.get(path);
			if (v === undefined) {
				throw new Error("ENOENT");
			}
			return v;
		},
		async stat(path) {
			if (dirs.has(path)) {
				return { isDirectory: true };
			}
			if (files.has(path)) {
				return { isDirectory: false };
			}
			return null;
		},
	};
}

const snap = {
	fetchedAt: "2026-01-01T00:00:00.000Z",
	settings: {
		timezone: "UTC",
		emailSuffixes: ["x.com"],
		activityWeights: { "pr.merged": 10 },
		pipelineConfigVersion: 3,
		scoresStale: false,
		scoresStaleReason: null,
	},
	developers: [{ id: "d1", name: "Ada", alias: "ada" }],
	repos: [
		{
			id: "r1",
			provider: "ado",
			org: "o",
			project: "p",
			name: "n",
			externalId: "g",
			projectExternalId: "pg",
			enabled: true,
		},
	],
};

describe("bootstrap cache", () => {
	test("path under dataDir/cache", () => {
		expect(bootstrapCachePath("/tmp/.data")).toBe(
			"/tmp/.data/cache/bootstrap.json",
		);
		expect(bootstrapCachePath("/tmp/.data/")).toBe(
			"/tmp/.data/cache/bootstrap.json",
		);
	});

	test("write and read roundtrip", async () => {
		const fs = memFs();
		const path = await writeBootstrapCache(fs, "/proj/.data", snap);
		expect(path).toBe("/proj/.data/cache/bootstrap.json");
		const cached = await readBootstrapCache(fs, "/proj/.data");
		expect(cached?.settings.pipelineConfigVersion).toBe(3);
		expect(cached?.repos[0]?.projectExternalId).toBe("pg");
		expect(cached?.cachedAt).toBeTruthy();
	});

	test("read missing returns null", async () => {
		expect(await readBootstrapCache(memFs(), "/x")).toBeNull();
	});

	test("read invalid json shape returns null", async () => {
		const fs = memFs();
		await fs.mkdir("/x/cache");
		await fs.writeFile("/x/cache/bootstrap.json", '{"no":"settings"}');
		expect(await readBootstrapCache(fs, "/x")).toBeNull();
	});

	test("ensureDataDirs creates subdirs", async () => {
		const fs = memFs();
		await ensureDataDirs(fs, "/p/.data");
		expect(fs.dirs.has("/p/.data/cache")).toBe(true);
		expect(fs.dirs.has("/p/.data/raw")).toBe(true);
		expect(fs.dirs.has("/p/.data/normalized")).toBe(true);
	});
});
