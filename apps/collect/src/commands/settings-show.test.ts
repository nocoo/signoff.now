import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import { createLogger } from "../logger.ts";
import { settingsShow } from "./settings-show.ts";

const snap = {
	fetchedAt: "t",
	settings: {
		timezone: "UTC",
		emailSuffixes: ["x.com"],
		activityWeights: {},
		pipelineConfigVersion: 2,
		scoresStale: false,
		scoresStaleReason: null,
	},
	developers: [{ id: "d", name: "A", alias: "a" }],
	repos: [],
};

describe("settingsShow", () => {
	test("reads cache", async () => {
		const fs: FsLike = {
			async mkdir() {},
			async writeFile() {},
			async readFile() {
				return JSON.stringify({ ...snap, cachedAt: "c" });
			},
			async stat() {
				return null;
			},
		};
		const logs: string[] = [];
		const code = await settingsShow({
			client: {
				bootstrap: async () => snap,
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/d",
			remote: false,
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(code).toBe(0);
		expect(logs.some((l) => l.includes("pipelineConfigVersion=2"))).toBe(true);
	});

	test("missing cache → contract", async () => {
		const fs: FsLike = {
			async mkdir() {},
			async writeFile() {},
			async readFile() {
				throw new Error("ENOENT");
			},
			async stat() {
				return null;
			},
		};
		const code = await settingsShow({
			client: {
				bootstrap: async () => snap,
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/d",
			remote: false,
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("--remote refreshes cache", async () => {
		const written: string[] = [];
		const fs: FsLike = {
			async mkdir() {},
			async writeFile(_p, data) {
				written.push(data);
			},
			async readFile() {
				throw new Error("ENOENT");
			},
			async stat() {
				return null;
			},
		};
		const code = await settingsShow({
			client: {
				bootstrap: async () => snap,
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/d",
			remote: true,
			log: createLogger({ log: () => {} }),
		});
		expect(code).toBe(0);
		expect(written.length).toBe(1);
	});

	test("remote http error", async () => {
		const code = await settingsShow({
			client: {
				bootstrap: async () => {
					throw { status: 500, body: null, message: "HTTP 500" };
				},
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs: {
				async mkdir() {},
				async writeFile() {},
				async readFile() {
					return "";
				},
				async stat() {
					return null;
				},
			},
			dataDir: "/d",
			remote: true,
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(4);
	});

	test("remote non-5xx → contract", async () => {
		const code = await settingsShow({
			client: {
				bootstrap: async () => {
					throw { status: 403, body: null, message: "HTTP 403" };
				},
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs: {
				async mkdir() {},
				async writeFile() {},
				async readFile() {
					return "";
				},
				async stat() {
					return null;
				},
			},
			dataDir: "/d",
			remote: true,
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("generic error → runtime", async () => {
		const code = await settingsShow({
			client: {
				bootstrap: async () => {
					throw new Error("boom");
				},
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs: {
				async mkdir() {},
				async writeFile() {},
				async readFile() {
					return "";
				},
				async stat() {
					return null;
				},
			},
			dataDir: "/d",
			remote: true,
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(1);
	});
});
