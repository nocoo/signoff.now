/**
 * Read-only Dashboard summary (08 §3).
 *
 * The subtle part is which table each number comes from. `scores.breakdown_json`
 * holds the POST-fold contribution for one `(developer_id, day_key)`, so summing
 * it across days is correct — those rows are disjoint. Counting activities and
 * multiplying by weights is NOT: it re-inflates everything 06 §3.1 suppresses
 * (same-day `pr.active`, same-day `wi.updated`, `merged` over `created`,
 * `merged` excluding `closed`), and the Dashboard would then disagree with the
 * heatmap for the same person.
 */

import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { loadSettings } from "./settings.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 92;
const DEFAULT_SPAN_DAYS = 28;
const TOP_DEVELOPERS = 10;

export type StatsSummary = {
	pipelineConfigVersion: number;
	scoresStale: boolean;
	staleReason: string | null;
	window: { from: string; to: string };
	totals: { activities: number; score: number; activeDevelopers: number };
	byType: { type: string; count: number; score: number }[];
	topDevelopers: {
		developerId: string;
		name: string;
		score: number;
		activityCount: number;
	}[];
	daily: { dayKey: string; score: number; activityCount: number }[];
	lastIngestAt: number | null;
};

/** `YYYY-MM-DD` for an instant, in the configured timezone (01 §4.7). */
export function dayKeyIn(timeZone: string, atMs: number): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(atMs));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Shift a `YYYY-MM-DD` by whole days, staying in date space. */
export function shiftDayKey(dayKey: string, days: number): string {
	const ms = Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000;
	return new Date(ms).toISOString().slice(0, 10);
}

export function spanDays(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
		return Number.NaN;
	}
	return (b - a) / 86_400_000 + 1;
}

/**
 * Resolve the window.
 *
 * The default is computed in the settings timezone rather than UTC or the
 * browser's, so "last 28 days" means the same window for everyone (01 §4.7).
 */
export function resolveWindow(
	q: { from?: string; to?: string },
	timeZone: string,
	nowMs: number,
): { from: string; to: string } | { error: string } {
	if (q.from === undefined && q.to === undefined) {
		const to = dayKeyIn(timeZone, nowMs);
		return { from: shiftDayKey(to, -(DEFAULT_SPAN_DAYS - 1)), to };
	}
	const from = q.from ?? "";
	const to = q.to ?? "";
	if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
		return { error: "from and to must both be YYYY-MM-DD" };
	}
	const span = spanDays(from, to);
	if (Number.isNaN(span)) {
		return { error: "to must not precede from" };
	}
	if (span > MAX_SPAN_DAYS) {
		return { error: `window must be at most ${MAX_SPAN_DAYS} days` };
	}
	return { from, to };
}

/** Empty body used when scores are stale — never partial numbers (06 §7.1). */
function staleBody(
	settings: {
		pipelineConfigVersion: number;
		scoresStaleReason: string | null;
	},
	window: { from: string; to: string },
	lastIngestAt: number | null,
): StatsSummary {
	return {
		pipelineConfigVersion: settings.pipelineConfigVersion,
		scoresStale: true,
		staleReason: settings.scoresStaleReason,
		window,
		totals: { activities: 0, score: 0, activeDevelopers: 0 },
		byType: [],
		topDevelopers: [],
		daily: [],
		lastIngestAt,
	};
}

/** GET /api/stats/summary */
export async function statsSummaryRoute(c: Context<AppEnv>) {
	const settings = await loadSettings(c.env.DB);
	const window = resolveWindow(c.req.query(), settings.timezone, Date.now());
	if ("error" in window) {
		return c.json({ error: window.error }, 400);
	}

	const version = settings.pipelineConfigVersion;
	const db = c.env.DB;

	if (settings.scoresStale) {
		// Stale short-circuits the aggregates: numbers that no longer reflect
		// the configuration are worse than none. `lastIngestAt` still comes
		// back — it answers "when did we last collect", not "what are the
		// numbers" — so this path is 2 statements, not 1.
		const last = await db
			.prepare(
				`SELECT MAX(finished_at) AS lastIngestAt FROM ingest_runs
         WHERE config_version = ? AND status = 'finalized'`,
			)
			.bind(version)
			.first<{ lastIngestAt: number | null }>();
		return c.json(staleBody(settings, window, last?.lastIngestAt ?? null), 200);
	}

	const results = await db.batch([
		db
			.prepare(
				`SELECT
           COALESCE(SUM(total), 0) AS score,
           COALESCE(SUM(activity_count), 0) AS activities,
           COUNT(DISTINCT CASE WHEN activity_count > 0 THEN developer_id END) AS activeDevelopers
         FROM scores
         WHERE config_version = ? AND day_key BETWEEN ? AND ?`,
			)
			.bind(version, window.from, window.to),
		db
			.prepare(
				`SELECT day_key AS dayKey,
                COALESCE(SUM(total), 0) AS score,
                COALESCE(SUM(activity_count), 0) AS activityCount
         FROM scores
         WHERE config_version = ? AND day_key BETWEEN ? AND ?
         GROUP BY day_key ORDER BY day_key`,
			)
			.bind(version, window.from, window.to),
		db
			.prepare(
				`SELECT type, COUNT(*) AS count
         FROM activities
         WHERE config_version = ? AND day_key BETWEEN ? AND ?
         GROUP BY type`,
			)
			.bind(version, window.from, window.to),
		db
			.prepare(
				`SELECT j.key AS type, COALESCE(SUM(j.value), 0) AS score
         FROM scores s, json_each(s.breakdown_json) j
         WHERE s.config_version = ? AND s.day_key BETWEEN ? AND ?
         GROUP BY j.key`,
			)
			.bind(version, window.from, window.to),
		db
			.prepare(
				`SELECT s.developer_id AS developerId,
                COALESCE(d.name, s.developer_id) AS name,
                COALESCE(SUM(s.total), 0) AS score,
                COALESCE(SUM(s.activity_count), 0) AS activityCount
         FROM scores s LEFT JOIN developers d ON d.id = s.developer_id
         WHERE s.config_version = ? AND s.day_key BETWEEN ? AND ?
         GROUP BY s.developer_id
         ORDER BY score DESC, s.developer_id ASC
         LIMIT ?`,
			)
			.bind(version, window.from, window.to, TOP_DEVELOPERS),
		db
			.prepare(
				`SELECT MAX(finished_at) AS lastIngestAt FROM ingest_runs
         WHERE config_version = ? AND status = 'finalized'`,
			)
			.bind(version),
		// Read inside the SAME batch as the aggregates so it describes the same
		// snapshot. A run mid-flight means Activities may already be committed
		// while their Scores are not: the ingest write path commits Phase 1 and
		// Phase 3 in separate batches, so `byType.count` (from activities) can
		// exceed `totals.activities` (from scores) for the duration.
		db
			.prepare(
				`SELECT COUNT(*) AS inFlight FROM ingest_runs
         WHERE config_version = ? AND status = 'chunked'`,
			)
			.bind(version),
	]);

	const rows = <T>(i: number): T[] => (results[i]?.results ?? []) as T[];

	const totalsRow = rows<{
		score: number;
		activities: number;
		activeDevelopers: number;
	}>(0)[0];
	const daily = rows<{
		dayKey: string;
		score: number;
		activityCount: number;
	}>(1);
	const counts = rows<{ type: string; count: number }>(2);
	const scoresByType = rows<{ type: string; score: number }>(3);
	const topDevelopers = rows<{
		developerId: string;
		name: string;
		score: number;
		activityCount: number;
	}>(4);
	const lastIngestAt =
		rows<{ lastIngestAt: number | null }>(5)[0]?.lastIngestAt ?? null;
	const inFlight = rows<{ inFlight: number }>(6)[0]?.inFlight ?? 0;

	// Counts and scores come from different tables on purpose; a type can appear
	// in one and not the other (all its events folded away, or a zero weight).
	const scoreByType = new Map(scoresByType.map((r) => [r.type, r.score]));
	const countByType = new Map(counts.map((r) => [r.type, r.count]));
	const byType = [...new Set([...countByType.keys(), ...scoreByType.keys()])]
		.map((type) => ({
			type,
			count: countByType.get(type) ?? 0,
			score: scoreByType.get(type) ?? 0,
		}))
		.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));

	if (inFlight > 0) {
		// Mid-ingest the two tables disagree by construction, so publishing
		// would show a manager numbers that contradict each other. Report it as
		// unsettled rather than guessing which figure is right.
		return c.json(
			{
				...staleBody(settings, window, lastIngestAt),
				scoresStale: true,
				staleReason: "an ingest is in progress; numbers are still settling",
			} satisfies StatsSummary,
			200,
		);
	}

	// Re-read the version after the aggregates: a settings change mid-batch
	// would otherwise let us publish a mixture of two configurations.
	const after = await loadSettings(db);
	if (
		after.pipelineConfigVersion !== version ||
		after.scoresStale !== settings.scoresStale
	) {
		return c.json(staleBody(after, window, lastIngestAt), 200);
	}

	return c.json(
		{
			pipelineConfigVersion: version,
			scoresStale: false,
			staleReason: null,
			window,
			totals: {
				activities: totalsRow?.activities ?? 0,
				score: totalsRow?.score ?? 0,
				activeDevelopers: totalsRow?.activeDevelopers ?? 0,
			},
			byType,
			topDevelopers,
			daily,
			lastIngestAt,
		} satisfies StatsSummary,
		200,
	);
}
