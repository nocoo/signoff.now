import { describe, expect, test } from "bun:test";
import { ACTIVITY_TYPES, DEFAULT_WEIGHTS } from "./constants.js";

describe("ACTIVITY_TYPES / DEFAULT_WEIGHTS", () => {
	test("has all 8 activity types", () => {
		expect(ACTIVITY_TYPES).toHaveLength(8);
		expect(new Set(ACTIVITY_TYPES).size).toBe(8);
	});

	test("DEFAULT_WEIGHTS covers every activity type", () => {
		for (const t of ACTIVITY_TYPES) {
			expect(DEFAULT_WEIGHTS[t]).toBeDefined();
			expect(Number.isInteger(DEFAULT_WEIGHTS[t])).toBe(true);
			expect(DEFAULT_WEIGHTS[t]).toBeGreaterThanOrEqual(0);
		}
	});

	test("DEFAULT_WEIGHTS has no extra keys", () => {
		expect(Object.keys(DEFAULT_WEIGHTS).sort()).toEqual(
			[...ACTIVITY_TYPES].sort(),
		);
	});
});
