import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import { createLogger } from "../logger.ts";
import { collectDryRun } from "./collect-dry-run.ts";

describe("collectDryRun", () => {
	test("prints plan from cache", async () => {
		const payload = {
			fetchedAt: "t",
			cachedAt: "t",
			settings: {
				timezone: "UTC",
				emailSuffixes: [],
				activityWeights: {},
				pipelineConfigVersion: 1,
				scoresStale: false,
				scoresStaleReason: null,
			},
			developers: [],
			repos: [
				{
					id: "r1",
					provider: "ado",
					org: "acme",
					project: "Alpha",
					name: "svc",
					externalId: "g1",
					projectExternalId: "pg1",
					enabled: true,
				},
				{
					id: "r2",
					provider: "ado",
					org: "acme",
					project: "Alpha",
					name: "lib",
					externalId: "g2",
					projectExternalId: "pg1",
					enabled: false,
				},
			],
		};
		const fs: FsLike = {
			async mkdir() {},
			async writeFile() {},
			async readFile() {
				return JSON.stringify(payload);
			},
			async stat() {
				return null;
			},
		};
		const logs: string[] = [];
		const code = await collectDryRun({
			fs,
			dataDir: "/d",
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(code).toBe(0);
		expect(logs.some((l) => l.includes("PR  acme/Alpha/svc"))).toBe(true);
		expect(logs.some((l) => l.includes("WI  acme/Alpha"))).toBe(true);
		expect(logs.some((l) => l.includes("no ADO"))).toBe(true);
		// disabled repo not in PR list as enabled
		expect(logs.filter((l) => l.includes("PR  ")).length).toBe(1);
	});

	test("missing cache → contract error", async () => {
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
		const code = await collectDryRun({
			fs,
			dataDir: "/d",
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});
});
