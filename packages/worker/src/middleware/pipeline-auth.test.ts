import { describe, expect, test } from "bun:test";
import { isPipelineWritePath } from "./pipeline-auth.js";

describe("isPipelineWritePath", () => {
	test("matches ingest and recompute", () => {
		expect(isPipelineWritePath("/api/pipeline/ingest")).toBe(true);
		expect(isPipelineWritePath("/api/pipeline/recompute/complete")).toBe(true);
	});

	test("rejects management and bootstrap", () => {
		expect(isPipelineWritePath("/api/settings")).toBe(false);
		expect(isPipelineWritePath("/api/pipeline/bootstrap")).toBe(false);
	});
});
