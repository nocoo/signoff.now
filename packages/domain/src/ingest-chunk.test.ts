import { describe, expect, test } from "bun:test";
import {
	fixtureFileSchema,
	ingestSuccessSchema,
	splitFixtureIntoChunks,
} from "./ingest.js";

const repo = "11111111-1111-4111-8111-111111111111";

function activity(i: number) {
	return {
		type: "pr.merged" as const,
		occurredAt: 1_720_000_000 + i,
		provider: "ado" as const,
		org: "acme",
		project: "Alpha",
		developerId: "d1",
		matchedUniqueName: "a@example.com",
		repoId: "r1",
		sourceIds: { prRepoGuid: repo, prId: i + 1 },
	};
}

describe("fixtureFileSchema + splitFixtureIntoChunks", () => {
	test("splits 25 activities into 3 chunks", () => {
		const file = fixtureFileSchema.parse({
			pipelineConfigVersion: 1,
			runId: "01J7XZ8K3N4Y5W2P6Q9R1STVWX",
			chunkIndex: 0,
			isFinalChunk: true,
			runMeta: {
				startedAt: 1_720_000_000,
				source: "fixture",
				windowFrom: "2026-06-01",
				windowTo: "2026-07-01",
				mode: "incremental",
			},
			activities: Array.from({ length: 25 }, (_, i) => activity(i)),
			unmatchedIdentities: [],
		});
		const chunks = splitFixtureIntoChunks(file);
		expect(chunks).toHaveLength(3);
		expect(chunks[0]!.activities).toHaveLength(10);
		expect(chunks[1]!.activities).toHaveLength(10);
		expect(chunks[2]!.activities).toHaveLength(5);
		expect(chunks[0]!.isFinalChunk).toBe(false);
		expect(chunks[2]!.isFinalChunk).toBe(true);
		expect(chunks[2]!.chunkIndex).toBe(2);
	});

	test("rejects isFinalChunk false", () => {
		const r = fixtureFileSchema.safeParse({
			pipelineConfigVersion: 1,
			runId: "01J7XZ8K3N4Y5W2P6Q9R1STVWX",
			chunkIndex: 0,
			isFinalChunk: false,
			runMeta: {
				startedAt: 1_720_000_000,
				source: "fixture",
				windowFrom: "2026-06-01",
				windowTo: "2026-07-01",
				mode: "incremental",
			},
			activities: [activity(0)],
			unmatchedIdentities: [],
		});
		expect(r.success).toBe(false);
	});

	test("ingestSuccessSchema accepts 200 body", () => {
		const r = ingestSuccessSchema.safeParse({
			runId: "01J7XZ8K3N4Y5W2P6Q9R1STVWX",
			chunkIndex: 0,
			pipelineConfigVersion: 1,
			activities: { received: 1, upserted: 1, rejected: 0 },
			scores: { affectedDevDays: 1, recomputed: 1 },
			unmatched: { upserted: 0 },
			finalized: true,
		});
		expect(r.success).toBe(true);
	});
});
