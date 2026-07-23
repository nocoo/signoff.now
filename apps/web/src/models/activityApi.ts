import { apiFetch } from "@/lib/api";
import {
	type HeatmapResponse,
	parseHeatmapResponse,
	parseTimelineResponse,
	type TimelineResponse,
} from "./activity";

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
	const raw = await apiFetch<unknown>(`/api/activity/heatmap?${q}`);
	return parseHeatmapResponse(raw);
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
	const raw = await apiFetch<unknown>(`/api/activity/timeline?${q}`);
	return parseTimelineResponse(raw);
}
