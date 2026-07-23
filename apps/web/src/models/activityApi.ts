import { apiFetch } from "@/lib/api";
import type { HeatmapResponse, TimelineResponse } from "./activity";

export async function fetchHeatmap(opts: {
	devs: string[];
	from: string;
	to: string;
}): Promise<HeatmapResponse> {
	const q = new URLSearchParams({
		devs: opts.devs.join(","),
		from: opts.from,
		to: opts.to,
	});
	return apiFetch<HeatmapResponse>(`/api/activity/heatmap?${q}`);
}

export async function fetchTimeline(opts: {
	dev: string;
	from: string;
	to: string;
	cursor?: string | null;
}): Promise<TimelineResponse> {
	const q = new URLSearchParams({
		dev: opts.dev,
		from: opts.from,
		to: opts.to,
	});
	if (opts.cursor) {
		q.set("cursor", opts.cursor);
	}
	return apiFetch<TimelineResponse>(`/api/activity/timeline?${q}`);
}
