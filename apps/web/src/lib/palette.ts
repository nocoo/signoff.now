// Chart / visualization palette — CSS custom properties from index.css.
// Microsoft four lead the sequential set (blue · green · yellow · red).

const v = (token: string) => `hsl(var(--${token}))`;

export const withAlpha = (token: string, alpha: number) =>
	`hsl(var(--${token}) / ${alpha})`;

export const ms = {
	blue: v("ms-blue"),
	green: v("ms-green"),
	yellow: v("ms-yellow"),
	red: v("ms-red"),
} as const;

export const chart = {
	primary: v("chart-1"),
	green: v("chart-2"),
	yellow: v("chart-3"),
	red: v("chart-4"),
	teal: v("chart-5"),
	cobalt: v("chart-6"),
	jade: v("chart-7"),
	purple: v("chart-8"),
} as const;

export const CHART_COLORS = Object.values(chart);

export const CHART_TOKENS = [
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"chart-6",
	"chart-7",
	"chart-8",
] as const;

export const HEATMAP_HUES = ["green", "red", "blue", "orange"] as const;

export type HeatmapHue = (typeof HEATMAP_HUES)[number];

/**
 * Level 0 has no token (empty day) and falls back to --muted; levels 1..4 map
 * onto the `--heatmap-{hue}-{1..4}` scale defined in index.css.
 */
export function heatmapColor(level: number, hue: HeatmapHue = "green"): string {
	if (!Number.isInteger(level) || level < 1 || level > 4) {
		return v("muted");
	}
	return v(`heatmap-${hue}-${level}`);
}

export const chartAxis = v("chart-axis");
export const chartPositive = chart.green;
export const chartNegative = v("destructive");
export const chartPrimary = chart.primary;
