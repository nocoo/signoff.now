import { describe, expect, test } from "bun:test";
import { createLogger } from "../logger.ts";
import { ingestFixture } from "./ingest-fixture.ts";

const valid = {
	pipelineConfigVersion: 1,
	runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
	chunkIndex: 0,
	isFinalChunk: true,
	runMeta: {
		startedAt: 1720000000,
		source: "fixture",
		windowFrom: "2026-06-01",
		windowTo: "2026-07-01",
		mode: "full_rematch",
	},
	activities: [
		{
			type: "pr.merged",
			occurredAt: 1720000123,
			provider: "ado",
			org: "acme",
			project: "Alpha",
			repoId: "repo-1",
			developerId: "dev-1",
			matchedUniqueName: "ada@example.com",
			sourceIds: {
				prRepoGuid: "11111111-1111-4111-8111-111111111111",
				prId: 1001,
			},
		},
	],
	unmatchedIdentities: [],
};

describe("ingestFixture", () => {
	test("prints summary without sending", async () => {
		const logs: string[] = [];
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(code).toBe(0);
		expect(logs.some((l) => l.includes("STUB"))).toBe(true);
		expect(logs.some((l) => l.includes("no HTTP"))).toBe(true);
		expect(logs.some((l) => l.includes("pr.merged"))).toBe(true);
	});

	test("invalid schema → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify({ pipelineConfigVersion: 1 }),
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("bad json → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => "{",
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("read error → runtime", async () => {
		const code = await ingestFixture({
			filePath: "/missing.json",
			readFile: async () => {
				throw new Error("ENOENT");
			},
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(1);
	});

	test("previews first 3 of many activities", async () => {
		const many = {
			...valid,
			activities: Array.from({ length: 5 }, (_, i) => ({
				...valid.activities[0],
				sourceIds: {
					prRepoGuid: "11111111-1111-4111-8111-111111111111",
					prId: 1000 + i,
				},
			})),
		};
		const logs: string[] = [];
		await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(many),
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(logs.some((l) => l.includes("and 2 more"))).toBe(true);
	});
});
