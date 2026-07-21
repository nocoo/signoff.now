import { describe, expect, test } from "bun:test";
import { ingestBodySchema } from "./ingest.js";

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
