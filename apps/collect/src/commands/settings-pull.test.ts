import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import { createLogger } from "../logger.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { settingsPull } from "./settings-pull.ts";

const fs: FsLike = {
	async mkdir() {},
	async writeFile() {},
	async readFile() {
		return "";
	},
	async stat() {
		return null;
	},
};

const snap = {
	fetchedAt: "t",
	settings: {
		timezone: "UTC",
		emailSuffixes: ["x.com"],
		activityWeights: {},
		pipelineConfigVersion: 4,
		scoresStale: false,
		scoresStaleReason: null,
	},
	developers: [{ id: "d", name: "A", alias: "a" }],
	repos: [],
};

describe("settingsPull", () => {
	test("writes cache on success", async () => {
		const logs: string[] = [];
		const code = await settingsPull({
			client: {
				bootstrap: async () => snap,
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/d",
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(code).toBe(0);
		expect(logs.some((l) => l.includes("pipelineConfigVersion=4"))).toBe(true);
	});

	test("maps http errors to exit codes", async () => {
		const make = (status: number): PipelineClient => ({
			bootstrap: async () => {
				throw { status, body: null, message: `HTTP ${status}` };
			},
			ingest: async () => ({}),
			recomputeComplete: async () => ({}),
		});
		const log = createLogger({ log: () => {}, error: () => {} });
		expect(
			await settingsPull({ client: make(500), fs, dataDir: "/d", log }),
		).toBe(4);
		expect(
			await settingsPull({ client: make(401), fs, dataDir: "/d", log }),
		).toBe(2);
		expect(
			await settingsPull({ client: make(409), fs, dataDir: "/d", log }),
		).toBe(3);
	});

	test("non-http error → runtime", async () => {
		const code = await settingsPull({
			client: {
				bootstrap: async () => {
					throw new Error("network down");
				},
				ingest: async () => ({}),
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/d",
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(1);
	});
});
