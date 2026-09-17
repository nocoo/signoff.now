import { describe, expect, it } from "vitest";
import { calculationFreshness, relativeAge } from "./freshness";

const NOW = 1_800_000_000;

describe("collection age", () => {
	it.each([
		[-60, "< 1 min ago"],
		[0, "< 1 min ago"],
		[59, "< 1 min ago"],
		[60, "1 min ago"],
		[180, "3 min ago"],
		[3599, "59 min ago"],
		[3600, "1 hour ago"],
		[7200, "2 hours ago"],
		[86399, "23 hours ago"],
		[86400, "1 day ago"],
		[172800, "2 days ago"],
	])("formats %s seconds without a seconds ticker", (age, expected) => {
		expect(relativeAge(NOW - age, NOW)).toBe(expected);
	});
});

describe("calculation freshness", () => {
	it("distinguishes never calculated from a valid epoch timestamp", () => {
		expect(calculationFreshness(null, NOW)).toBe("never");
		expect(calculationFreshness(0, NOW)).toBe("stale");
	});

	it.each([
		[-60, "fresh"],
		[0, "fresh"],
		[24 * 3600, "fresh"],
		[24 * 3600 + 1, "warning"],
		[72 * 3600, "warning"],
		[72 * 3600 + 1, "stale"],
	])("uses strict boundaries at an age of %s seconds", (age, expected) => {
		expect(calculationFreshness(NOW - age, NOW)).toBe(expected);
	});
});
