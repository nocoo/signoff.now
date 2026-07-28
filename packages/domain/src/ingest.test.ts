import { describe, expect, test } from "bun:test";
import { ingestBodySchema, MAX_CHUNK_INDEX } from "./ingest.js";

const validBody = {
	pipelineConfigVersion: 1,
	runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
	chunkIndex: 0,
	isFinalChunk: true,
	runMeta: {
		startedAt: 1720000000,
		source: "fixture" as const,
		windowFrom: "2026-06-01",
		windowTo: "2026-07-01",
		mode: "full_rematch" as const,
	},
	activities: [
		{
			type: "pr.merged" as const,
			occurredAt: 1720000123,
			provider: "ado" as const,
			org: "acme",
			project: "Alpha",
			repoId: "repo-1",
			developerId: "dev-1",
			matchedUniqueName: "ada@example.com",
			sourceIds: {
				prRepoGuid: "11111111-1111-4111-8111-111111111111",
				prId: 1001,
			},
			meta: { title: "Fixture PR" },
		},
	],
	unmatchedIdentities: [] as {
		uniqueName: string;
		sampleOrg?: string;
		sampleProject?: string;
		sampleContext?: string;
	}[],
};

function activity(i: number) {
	return {
		type: "pr.merged" as const,
		occurredAt: 1720000123 + i,
		provider: "ado" as const,
		org: "acme",
		project: "Alpha",
		repoId: "repo-1",
		developerId: "dev-1",
		matchedUniqueName: "ada@example.com",
		sourceIds: {
			prRepoGuid: "11111111-1111-4111-8111-111111111111",
			prId: 1000 + i,
		},
	};
}

describe("ingestBodySchema", () => {
	test("accepts valid fixture-shaped body", () => {
		const r = ingestBodySchema.safeParse(validBody);
		expect(r.success).toBe(true);
	});

	test("accepts UUID v4 runId", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			runId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(r.success).toBe(true);
	});

	test("rejects activities.length > 10", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			activities: Array.from({ length: 11 }, (_, i) => activity(i)),
		});
		expect(r.success).toBe(false);
	});

	test("accepts activities.length === 10", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			activities: Array.from({ length: 10 }, (_, i) => activity(i)),
		});
		expect(r.success).toBe(true);
	});

	test("rejects unmatchedIdentities.length > 10", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			unmatchedIdentities: Array.from({ length: 11 }, (_, i) => ({
				uniqueName: `u${i}@x.com`,
			})),
		});
		expect(r.success).toBe(false);
	});

	test("rejects bad runId", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			runId: "not-a-valid-id",
		});
		expect(r.success).toBe(false);
	});

	test("rejects bad windowFrom format", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			runMeta: { ...validBody.runMeta, windowFrom: "06/01/2026" },
		});
		expect(r.success).toBe(false);
	});

	test("rejects extra top-level keys", () => {
		const r = ingestBodySchema.safeParse({
			...validBody,
			extra: true,
		});
		expect(r.success).toBe(false);
	});
});

describe("chunkIndex ceiling", () => {
	const mk = (i: number) => ({
		pipelineConfigVersion: 1,
		runId: "01JAY7B4HXTMRP0VQZ0FKZH5E9",
		chunkIndex: i,
		isFinalChunk: false,
		runMeta: {
			startedAt: 1,
			source: "fixture" as const,
			windowFrom: "2026-07-01",
			windowTo: "2026-07-02",
			mode: "incremental" as const,
		},
		activities: [],
		unmatchedIdentities: [],
	});

	test("the largest index a fixture can produce is accepted", () => {
		expect(ingestBodySchema.safeParse(mk(0)).success).toBe(true);
		expect(ingestBodySchema.safeParse(mk(MAX_CHUNK_INDEX)).success).toBe(true);
	});

	test("an index no fixture could produce is refused", () => {
		// Harmless today because the write path refuses gaps, but the contract
		// should state its own ceiling rather than lean on a downstream guard.
		expect(ingestBodySchema.safeParse(mk(MAX_CHUNK_INDEX + 1)).success).toBe(
			false,
		);
		expect(ingestBodySchema.safeParse(mk(99_999)).success).toBe(false);
	});
});
