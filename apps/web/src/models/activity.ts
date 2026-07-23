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
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Invalid ${label} payload`);
	}
	return raw as Record<string, unknown>;
}

function requireString(raw: unknown, field: string): string {
	if (typeof raw !== "string") {
		throw new Error(`Invalid ${field}: expected string`);
	}
	return raw;
}

function requireNumber(raw: unknown, field: string): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new Error(`Invalid ${field}: expected number`);
	}
	return raw;
}

function requireBoolean(raw: unknown, field: string): boolean {
	if (typeof raw !== "boolean") {
		throw new Error(`Invalid ${field}: expected boolean`);
	}
	return raw;
}

function requireArray(raw: unknown, field: string): unknown[] {
	if (!Array.isArray(raw)) {
		throw new Error(`Invalid ${field}: expected array`);
	}
	return raw;
}

function parseStaleReason(raw: unknown): string | null {
	if (raw === null) {
		return null;
	}
	if (typeof raw !== "string") {
		throw new Error("Invalid staleReason: expected string or null");
	}
	return raw;
}

export function parseHeatmapRow(raw: unknown): HeatmapRow {
	const r = asRecord(raw, "heatmap row");
	return {
		developerId: requireString(r.developerId, "heatmapRow.developerId"),
		dayKey: requireString(r.dayKey, "heatmapRow.dayKey"),
		total: requireNumber(r.total, "heatmapRow.total"),
		activityCount: requireNumber(r.activityCount, "heatmapRow.activityCount"),
	};
}

/** Strict runtime parse for GET /api/activity/heatmap (06 §7 / project MVVM). */
export function parseHeatmapResponse(raw: unknown): HeatmapResponse {
	const r = asRecord(raw, "heatmap");
	return {
		pipelineConfigVersion: requireNumber(
			r.pipelineConfigVersion,
			"pipelineConfigVersion",
		),
		scoresStale: requireBoolean(r.scoresStale, "scoresStale"),
		staleReason: parseStaleReason(r.staleReason),
		rows: requireArray(r.rows, "rows").map(parseHeatmapRow),
	};
}

export function parseTimelineItem(raw: unknown): TimelineItem {
	const r = asRecord(raw, "timeline item");
	let repoId: string | null;
	if (r.repoId === null) {
		repoId = null;
	} else if (typeof r.repoId === "string") {
		repoId = r.repoId;
	} else {
		throw new Error("Invalid timelineItem.repoId: expected string or null");
	}
	return {
		id: requireString(r.id, "timelineItem.id"),
		type: requireString(r.type, "timelineItem.type"),
		occurredAt: requireNumber(r.occurredAt, "timelineItem.occurredAt"),
		dayKey: requireString(r.dayKey, "timelineItem.dayKey"),
		org: requireString(r.org, "timelineItem.org"),
		project: requireString(r.project, "timelineItem.project"),
		repoId,
		meta: "meta" in r ? r.meta : {},
	};
}

/** Strict runtime parse for GET /api/activity/timeline. */
export function parseTimelineResponse(raw: unknown): TimelineResponse {
	const r = asRecord(raw, "timeline");
	let nextCursor: string | null;
	if (r.nextCursor === null) {
		nextCursor = null;
	} else if (typeof r.nextCursor === "string") {
		nextCursor = r.nextCursor;
	} else {
		throw new Error("Invalid nextCursor: expected string or null");
	}
	return {
		pipelineConfigVersion: requireNumber(
			r.pipelineConfigVersion,
			"pipelineConfigVersion",
		),
		scoresStale: requireBoolean(r.scoresStale, "scoresStale"),
		staleReason: parseStaleReason(r.staleReason),
		items: requireArray(r.items, "items").map(parseTimelineItem),
		nextCursor,
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
