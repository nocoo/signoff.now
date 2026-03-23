import { describe, expect, test } from "bun:test";
import type { CollectorTier } from "@signoff/gitinfo";
import { clearAll, getCached, invalidate, setCached } from "./cache";

// Use a minimal mock report — only needs to satisfy the type
const mockReport = {
	generatedAt: "2026-01-01T00:00:00.000Z",
	tiers: ["instant", "moderate", "slow"] as CollectorTier[],
	durationMs: 100,
	meta: {} as never,
	status: {} as never,
	branches: {} as never,
	logs: {} as never,
	contributors: {} as never,
	tags: {} as never,
	files: {} as never,
	config: {} as never,
	errors: [],
};

describe("gitinfo cache", () => {
	test("returns null for uncached project", () => {
		clearAll();
		expect(getCached("unknown")).toBeNull();
	});

	test("stores and retrieves a report", () => {
		clearAll();
		setCached("p1", mockReport);
		const result = getCached("p1");
		expect(result).toEqual(mockReport);
	});

	test("invalidate removes cached entry", () => {
		clearAll();
		setCached("p1", mockReport);
		invalidate("p1");
		expect(getCached("p1")).toBeNull();
	});

	test("clearAll removes all entries", () => {
		clearAll();
		setCached("p1", mockReport);
		setCached("p2", mockReport);
		clearAll();
		expect(getCached("p1")).toBeNull();
		expect(getCached("p2")).toBeNull();
	});

	test("overwrites existing cache entry", () => {
		clearAll();
		setCached("p1", mockReport);
		const updated = { ...mockReport, durationMs: 999 };
		setCached("p1", updated);
		expect(getCached("p1")?.durationMs).toBe(999);
	});
});
