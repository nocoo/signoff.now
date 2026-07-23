export type HeatmapRow = {
	developerId: string;
	dayKey: string;
	total: number;
	activityCount: number;
};

export type HeatmapResponse = {
	pipelineConfigVersion: number;
	scoresStale: boolean;
	staleReason: string | null;
	rows: HeatmapRow[];
};

export type TimelineItem = {
	id: string;
	type: string;
	occurredAt: number;
	dayKey: string;
	org: string;
	project: string;
	repoId: string | null;
	meta: unknown;
};

export type TimelineResponse = {
	pipelineConfigVersion: number;
	scoresStale: boolean;
	staleReason: string | null;
	items: TimelineItem[];
	nextCursor: string | null;
};

/** Map total score to basalt heatmap intensity 0–4. */
export function heatmapLevel(total: number, max: number): number {
	if (total <= 0 || max <= 0) {
		return 0;
	}
	const r = total / max;
	if (r < 0.25) {
		return 1;
	}
	if (r < 0.5) {
		return 2;
	}
	if (r < 0.75) {
		return 3;
	}
	return 4;
}
