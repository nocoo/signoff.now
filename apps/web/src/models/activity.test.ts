import { describe, expect, it } from "vitest";
import { heatmapLevel } from "./activity";

describe("heatmapLevel", () => {
	it("zero when empty", () => {
		expect(heatmapLevel(0, 10)).toBe(0);
		expect(heatmapLevel(5, 0)).toBe(0);
	});

	it("buckets by ratio", () => {
		expect(heatmapLevel(1, 100)).toBe(1);
		expect(heatmapLevel(30, 100)).toBe(2);
		expect(heatmapLevel(60, 100)).toBe(3);
		expect(heatmapLevel(90, 100)).toBe(4);
	});
});
