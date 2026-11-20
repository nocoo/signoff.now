export const HEATMAP_HUES = ["green", "red", "blue", "orange"] as const;
export type HeatmapHue = (typeof HEATMAP_HUES)[number];

const HEATMAP_COLOR_SCALES: Record<
	HeatmapHue,
	readonly [string, string, string, string, string]
> = {
	green: [
		"hsl(var(--basalt-muted))",
		"hsl(var(--basalt-heatmap-green-1))",
		"hsl(var(--basalt-heatmap-green-2))",
		"hsl(var(--basalt-heatmap-green-3))",
		"hsl(var(--basalt-heatmap-green-4))",
	],
	red: [
		"hsl(var(--basalt-muted))",
		"hsl(var(--basalt-heatmap-red-1))",
		"hsl(var(--basalt-heatmap-red-2))",
		"hsl(var(--basalt-heatmap-red-3))",
		"hsl(var(--basalt-heatmap-red-4))",
	],
	blue: [
		"hsl(var(--basalt-muted))",
		"hsl(var(--basalt-heatmap-blue-1))",
		"hsl(var(--basalt-heatmap-blue-2))",
		"hsl(var(--basalt-heatmap-blue-3))",
		"hsl(var(--basalt-heatmap-blue-4))",
	],
	orange: [
		"hsl(var(--basalt-muted))",
		"hsl(var(--basalt-heatmap-orange-1))",
		"hsl(var(--basalt-heatmap-orange-2))",
		"hsl(var(--basalt-heatmap-orange-3))",
		"hsl(var(--basalt-heatmap-orange-4))",
	],
};

/** Maps the API's discrete 0–4 heat level onto Basalt's official scale. */
export function heatmapColor(level: number, hue: HeatmapHue = "green"): string {
	if (!Number.isInteger(level) || level < 1 || level > 4) {
		return HEATMAP_COLOR_SCALES[hue][0];
	}
	return HEATMAP_COLOR_SCALES[hue][level];
}
