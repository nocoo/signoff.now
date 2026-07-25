import { describe, expect, test } from "vitest";
import {
	CHART_COLORS,
	CHART_TOKENS,
	chart,
	chartPrimary,
	HEATMAP_HUES,
	heatmapColor,
	ms,
	withAlpha,
} from "./palette";

describe("palette", () => {
	test("microsoft four map to hsl vars", () => {
		expect(ms.blue).toBe("hsl(var(--ms-blue))");
		expect(ms.green).toBe("hsl(var(--ms-green))");
		expect(ms.yellow).toBe("hsl(var(--ms-yellow))");
		expect(ms.red).toBe("hsl(var(--ms-red))");
	});

	test("chart-1 is primary brand blue", () => {
		expect(chart.primary).toBe("hsl(var(--chart-1))");
		expect(chartPrimary).toBe(chart.primary);
	});

	test("ordered chart colors length", () => {
		expect(CHART_COLORS).toHaveLength(8);
		expect(CHART_TOKENS).toHaveLength(8);
	});

	test("withAlpha", () => {
		expect(withAlpha("chart-1", 0.12)).toBe("hsl(var(--chart-1) / 0.12)");
	});

	test("heatmap levels 1..4 map to defined hue tokens", () => {
		expect(heatmapColor(1)).toBe("hsl(var(--heatmap-green-1))");
		expect(heatmapColor(2)).toBe("hsl(var(--heatmap-green-2))");
		expect(heatmapColor(3)).toBe("hsl(var(--heatmap-green-3))");
		expect(heatmapColor(4)).toBe("hsl(var(--heatmap-green-4))");
	});

	test("heatmap level 0 and out-of-range fall back to muted", () => {
		expect(heatmapColor(0)).toBe("hsl(var(--muted))");
		expect(heatmapColor(5)).toBe("hsl(var(--muted))");
		expect(heatmapColor(-1)).toBe("hsl(var(--muted))");
		expect(heatmapColor(1.5)).toBe("hsl(var(--muted))");
	});

	test("heatmap honours non-default hue", () => {
		expect(heatmapColor(3, "blue")).toBe("hsl(var(--heatmap-blue-3))");
		expect(HEATMAP_HUES).toEqual(["green", "red", "blue", "orange"]);
	});
});
