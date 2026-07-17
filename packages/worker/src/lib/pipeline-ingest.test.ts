import { describe, expect, test } from "bun:test";
import {
	gatePipelineIngest,
	ingestNotImplementedBody,
} from "./pipeline-ingest.js";

describe("gatePipelineIngest", () => {
	test("rejects null body", () => {
		expect(gatePipelineIngest(null, 1).kind).toBe("bad_request");
	});

	test("rejects missing version", () => {
		const r = gatePipelineIngest({ activities: [{ id: "a" }] }, 1);
		expect(r.kind).toBe("bad_request");
	});

	test("rejects version conflict", () => {
		const r = gatePipelineIngest({ pipelineConfigVersion: 2 }, 1);
		expect(r).toEqual({ kind: "conflict", currentVersion: 1 });
	});

	test("never reports success — not_implemented even with activities", () => {
		const r = gatePipelineIngest(
			{
				pipelineConfigVersion: 3,
				activities: [{ id: "1" }, { id: "2" }],
			},
			3,
		);
		expect(r.kind).toBe("not_implemented");
		if (r.kind === "not_implemented") {
			expect(r.currentVersion).toBe(3);
		}
		// Explicitly: no accepted count, no ok:true
		const body = ingestNotImplementedBody(3);
		expect(body).not.toHaveProperty("ok", true);
		expect(body).not.toHaveProperty("accepted");
		expect(body.error).toBe("Not Implemented");
	});
});
