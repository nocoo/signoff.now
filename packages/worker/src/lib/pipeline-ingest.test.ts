import { describe, expect, test } from "bun:test";
import { INGEST_MAX_PAYLOAD_BYTES } from "@signoff/domain";
import {
	checkPayloadSize,
	gatePipelineIngest,
	ingestNotImplementedBody,
} from "./pipeline-ingest.js";

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
		},
	],
	unmatchedIdentities: [] as [],
};

describe("checkPayloadSize", () => {
	test("accepts under limit", () => {
		expect(checkPayloadSize(100)).toBe(true);
		expect(checkPayloadSize(INGEST_MAX_PAYLOAD_BYTES)).toBe(true);
	});
	test("rejects over limit", () => {
		expect(checkPayloadSize(INGEST_MAX_PAYLOAD_BYTES + 1)).toBe(false);
	});
});

describe("gatePipelineIngest", () => {
	test("rejects null body", () => {
		expect(gatePipelineIngest(null, 1).kind).toBe("bad_request");
	});

	test("rejects invalid schema", () => {
		const r = gatePipelineIngest({ pipelineConfigVersion: 1 }, 1);
		expect(r.kind).toBe("bad_request");
	});

	test("rejects version conflict", () => {
		const r = gatePipelineIngest({ ...validBody, pipelineConfigVersion: 2 }, 1);
		expect(r).toEqual({ kind: "conflict", currentVersion: 1 });
	});

	test("rejects oversized payload", () => {
		const r = gatePipelineIngest(validBody, 1, {
			rawByteLength: INGEST_MAX_PAYLOAD_BYTES + 10,
		});
		expect(r.kind).toBe("payload_too_large");
	});

	test("never reports success — not_implemented for valid body", () => {
		const r = gatePipelineIngest(validBody, 1);
		expect(r.kind).toBe("not_implemented");
		if (r.kind === "not_implemented") {
			expect(r.currentVersion).toBe(1);
		}
		const body = ingestNotImplementedBody(1);
		expect(body).not.toHaveProperty("ok", true);
		expect(body).not.toHaveProperty("accepted");
		expect(body.error).toBe("Not Implemented");
	});
});
