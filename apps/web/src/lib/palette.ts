import { heatmapColorScales } from "@nocoo/basalt/charts/heatmap-calendar";

export const HEATMAP_HUES = ["green", "red", "blue", "orange"] as const;
export type HeatmapHue = (typeof HEATMAP_HUES)[number];

/** Maps the API's discrete 0–4 heat level onto Basalt's official scale. */
export function heatmapColor(level: number, hue: HeatmapHue = "green"): string {
	if (!Number.isInteger(level) || level < 1 || level > 4) {
		return heatmapColorScales[hue][0];
	}
	return heatmapColorScales[hue][level];
}
