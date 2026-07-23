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

function asRecord(raw: unknown, label: string): Record<string, unknown> {
	if (!raw || typeof raw !== "object") {
		throw new Error(`Invalid ${label} payload`);
	}
	return raw as Record<string, unknown>;
}

function parseStaleReason(raw: unknown): string | null {
	if (raw === null || raw === undefined) {
		return null;
	}
	return String(raw);
}

export function parseHeatmapRow(raw: unknown): HeatmapRow {
	const r = asRecord(raw, "heatmap row");
	return {
		developerId: String(r.developerId ?? ""),
		dayKey: String(r.dayKey ?? ""),
		total: Number(r.total ?? 0),
		activityCount: Number(r.activityCount ?? 0),
	};
}

/** Runtime parse for GET /api/activity/heatmap (06 §7 / project MVVM). */
export function parseHeatmapResponse(raw: unknown): HeatmapResponse {
	const r = asRecord(raw, "heatmap");
	const rowsRaw = Array.isArray(r.rows) ? r.rows : [];
	return {
		pipelineConfigVersion: Number(r.pipelineConfigVersion ?? 0),
		scoresStale: Boolean(r.scoresStale),
		staleReason: parseStaleReason(r.staleReason),
		rows: rowsRaw.map(parseHeatmapRow),
	};
}

export function parseTimelineItem(raw: unknown): TimelineItem {
	const r = asRecord(raw, "timeline item");
	return {
		id: String(r.id ?? ""),
		type: String(r.type ?? ""),
		occurredAt: Number(r.occurredAt ?? 0),
		dayKey: String(r.dayKey ?? ""),
		org: String(r.org ?? ""),
		project: String(r.project ?? ""),
		repoId:
			r.repoId === null || r.repoId === undefined ? null : String(r.repoId),
		meta: r.meta ?? {},
	};
}

/** Runtime parse for GET /api/activity/timeline. */
export function parseTimelineResponse(raw: unknown): TimelineResponse {
	const r = asRecord(raw, "timeline");
	const itemsRaw = Array.isArray(r.items) ? r.items : [];
	return {
		pipelineConfigVersion: Number(r.pipelineConfigVersion ?? 0),
		scoresStale: Boolean(r.scoresStale),
		staleReason: parseStaleReason(r.staleReason),
		items: itemsRaw.map(parseTimelineItem),
		nextCursor:
			r.nextCursor === null || r.nextCursor === undefined
				? null
				: String(r.nextCursor),
	};
}

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
