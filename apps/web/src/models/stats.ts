/**
 * Dashboard summary model (08 §3.4).
 *
 * Parsing is strict on purpose: a malformed field surfaces as an error banner
 * rather than as `NaN` rendered next to a person's name.
 *
 * Zero-filling `daily` lives here, not in the API (08 §3.3). The server returns
 * only days that have data; a bar sequence built from that would silently omit
 * idle days and read as continuous activity.
 */

export type StatsTotals = {
	activities: number;
	score: number;
	activeDevelopers: number;
};

export type StatsByType = { type: string; count: number; score: number };

export type StatsTopDeveloper = {
	developerId: string;
	name: string;
	score: number;
	activityCount: number;
};

export type StatsDay = {
	dayKey: string;
	score: number;
	activityCount: number;
};

export type StatsSummary = {
	pipelineConfigVersion: number;
	scoresStale: boolean;
	staleReason: string | null;
	window: { from: string; to: string };
	totals: StatsTotals;
	byType: StatsByType[];
	topDevelopers: StatsTopDeveloper[];
	daily: StatsDay[];
	lastIngestAt: number | null;
};

function asRecord(raw: unknown, label: string): Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Invalid ${label} payload`);
	}
	return raw as Record<string, unknown>;
}

function num(raw: unknown, label: string): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new Error(`Invalid ${label}: expected a number`);
	}
	return raw;
}

function str(raw: unknown, label: string): string {
	if (typeof raw !== "string") {
		throw new Error(`Invalid ${label}: expected a string`);
	}
	return raw;
}

function arr(raw: unknown, label: string): unknown[] {
	if (!Array.isArray(raw)) {
		throw new Error(`Invalid ${label}: expected an array`);
	}
	return raw;
}

function bool(raw: unknown, label: string): boolean {
	if (typeof raw !== "boolean") {
		throw new Error(`Invalid ${label}: expected a boolean`);
	}
	return raw;
}

export function parseStatsSummary(raw: unknown): StatsSummary {
	const r = asRecord(raw, "stats summary");
	const window = asRecord(r.window, "stats window");
	const totals = asRecord(r.totals, "stats totals");

	return {
		pipelineConfigVersion: num(
			r.pipelineConfigVersion,
			"pipelineConfigVersion",
		),
		// Strictly, not `=== true`. This is the flag that decides whether numbers
		// get published at all, so a malformed value must raise an error rather
		// than quietly resolve to "trustworthy" — the one direction that shows a
		// manager figures the server refused to stand behind.
		scoresStale: bool(r.scoresStale, "scoresStale"),
		staleReason: nullable(r.staleReason, str, "staleReason"),
		window: {
			from: str(window.from, "window.from"),
			to: str(window.to, "window.to"),
		},
		totals: {
			activities: num(totals.activities, "totals.activities"),
			score: num(totals.score, "totals.score"),
			activeDevelopers: num(totals.activeDevelopers, "totals.activeDevelopers"),
		},
		byType: arr(r.byType, "byType").map((v) => {
			const t = asRecord(v, "byType entry");
			return {
				type: str(t.type, "byType.type"),
				count: num(t.count, "byType.count"),
				score: num(t.score, "byType.score"),
			};
		}),
		topDevelopers: arr(r.topDevelopers, "topDevelopers").map((v) => {
			const d = asRecord(v, "topDevelopers entry");
			return {
				developerId: str(d.developerId, "topDevelopers.developerId"),
				name: str(d.name, "topDevelopers.name"),
				score: num(d.score, "topDevelopers.score"),
				activityCount: num(d.activityCount, "topDevelopers.activityCount"),
			};
		}),
		daily: arr(r.daily, "daily").map((v) => {
			const d = asRecord(v, "daily entry");
			return {
				dayKey: str(d.dayKey, "daily.dayKey"),
				score: num(d.score, "daily.score"),
				activityCount: num(d.activityCount, "daily.activityCount"),
			};
		}),
		lastIngestAt: nullable(r.lastIngestAt, num, "lastIngestAt"),
	};
}

/** `null` is a real value here; anything else must still parse strictly. */
function nullable<T>(
	raw: unknown,
	parse: (v: unknown, label: string) => T,
	label: string,
): T | null {
	return raw === null || raw === undefined ? null : parse(raw, label);
}

/** Every day in `[from, to]`, with absent days filled in as zeroes. */
export function fillDailyGaps(
	daily: readonly StatsDay[],
	window: { from: string; to: string },
): StatsDay[] {
	const start = Date.parse(`${window.from}T00:00:00Z`);
	const end = Date.parse(`${window.to}T00:00:00Z`);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return [...daily];
	}
	const byDay = new Map(daily.map((d) => [d.dayKey, d]));
	const out: StatsDay[] = [];
	for (let t = start; t <= end; t += 86_400_000) {
		const dayKey = new Date(t).toISOString().slice(0, 10);
		out.push(byDay.get(dayKey) ?? { dayKey, score: 0, activityCount: 0 });
	}
	return out;
}

/** Relative bar height (0–1) for a day, against the window's busiest day. */
export function dailyLevels(daily: readonly StatsDay[]): {
	dayKey: string;
	score: number;
	activityCount: number;
	ratio: number;
	level: number;
}[] {
	const max = daily.reduce((m, d) => Math.max(m, d.score), 0);
	return daily.map((d) => ({
		...d,
		// A flat window of equal days should read as "all full", not "all empty".
		ratio: max <= 0 ? 0 : d.score / max,
		level: max <= 0 ? 0 : ratioLevel(d.score / max),
	}));
}

/**
 * Bucket a 0–1 ratio onto the 1–4 heatmap scale, reserving 0 for a truly idle
 * day. Living here rather than in the View keeps the one judgement call in the
 * chart — where "busy" starts — inside the coverage gate.
 */
export function ratioLevel(ratio: number): number {
	if (ratio <= 0) {
		return 0;
	}
	if (ratio <= 0.25) {
		return 1;
	}
	if (ratio <= 0.5) {
		return 2;
	}
	if (ratio <= 0.75) {
		return 3;
	}
	return 4;
}

/** Share of the window's total score, for the type distribution bars. */
export function byTypeShares(
	byType: readonly StatsByType[],
): (StatsByType & { share: number })[] {
	const total = byType.reduce((n, t) => n + t.score, 0);
	return byType.map((t) => ({
		...t,
		share: total <= 0 ? 0 : t.score / total,
	}));
}

export type EmptyKind = "never-collected" | "empty-window" | "has-data";

/**
 * Tell "nothing collected yet" apart from "nothing happened in this window".
 *
 * They need different words: the first is a setup step the operator must take,
 * the second is simply a quiet fortnight.
 */
export function emptyKind(summary: StatsSummary): EmptyKind {
	if (summary.totals.activities > 0 || summary.totals.score > 0) {
		return "has-data";
	}
	return summary.lastIngestAt === null ? "never-collected" : "empty-window";
}

/** Whether the numbers can be trusted right now (08 §3.2). */
export function isTrustworthy(summary: StatsSummary): boolean {
	return !summary.scoresStale;
}

export const WINDOW_PRESETS = [7, 28, 92] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];
/** What the server falls back to when a request omits the window. */
export const DEFAULT_PRESET: WindowPreset = 28;

/** `[from, to]` for a preset, counted back from `to` inclusive. */
export function presetWindow(
	days: WindowPreset,
	todayKey: string,
): { from: string; to: string } {
	const end = Date.parse(`${todayKey}T00:00:00Z`);
	const from = new Date(end - (days - 1) * 86_400_000)
		.toISOString()
		.slice(0, 10);
	return { from, to: todayKey };
}
