import { describe, expect, test } from "vitest";
import { HEATMAP_HUES, heatmapColor } from "./palette";

describe("Basalt visualization palette", () => {
	test("maps heat levels to official Basalt tokens", () => {
		expect(heatmapColor(1)).toBe("hsl(var(--basalt-heatmap-green-1))");
		expect(heatmapColor(2)).toBe("hsl(var(--basalt-heatmap-green-2))");
		expect(heatmapColor(3)).toBe("hsl(var(--basalt-heatmap-green-3))");
		expect(heatmapColor(4)).toBe("hsl(var(--basalt-heatmap-green-4))");
	});

	test("uses Basalt muted for empty or invalid levels", () => {
		expect(heatmapColor(0)).toBe("hsl(var(--basalt-muted))");
		expect(heatmapColor(5)).toBe("hsl(var(--basalt-muted))");
		expect(heatmapColor(-1)).toBe("hsl(var(--basalt-muted))");
		expect(heatmapColor(1.5)).toBe("hsl(var(--basalt-muted))");
	});

	test("supports every official sequential heatmap hue", () => {
		expect(heatmapColor(3, "blue")).toBe("hsl(var(--basalt-heatmap-blue-3))");
		expect(HEATMAP_HUES).toEqual(["green", "red", "blue", "orange"]);
	});
});
