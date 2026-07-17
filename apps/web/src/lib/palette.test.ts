import { describe, expect, test } from "vitest";
import {
	CHART_COLORS,
	CHART_TOKENS,
	chart,
	chartPrimary,
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
});
