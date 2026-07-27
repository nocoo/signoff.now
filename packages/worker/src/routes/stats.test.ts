/**
 * The invariants matter more than the individual numbers here: a Dashboard
 * whose totals disagree with its own breakdown, or with the heatmap, is worse
 * than one showing nothing — a manager cannot tell which figure to believe.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1.ts";
import type { AppEnv } from "../types.js";
import {
	dayKeyIn,
	resolveWindow,
	type StatsSummary,
	shiftDayKey,
	spanDays,
	statsSummaryRoute,
} from "./stats.ts";

let sqlite: SqliteD1;

function mount(db: D1Database) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: db } as AppEnv["Bindings"];
		return next();
	});
	app.get("/api/stats/summary", statsSummaryRoute);
	return app;
}

const DEV_A = "01K0STATSDEVA0000000000000";
const DEV_B = "01K0STATSDEVB0000000000000";

function seedDeveloper(id: string, name: string, alias: string) {
	sqlite.raw
		.query("INSERT INTO developers (id, name, alias) VALUES (?,?,?)")
		.run(id, name, alias);
}

/** Insert a score row exactly as the ingest write path would. */
function seedScore(opts: {
	developerId: string;
	dayKey: string;
	breakdown: Record<string, number>;
	activityCount: number;
	configVersion?: number;
}) {
	const total = Object.values(opts.breakdown).reduce((a, b) => a + b, 0);
	sqlite.raw
		.query(
			`INSERT INTO scores
         (developer_id, day_key, config_version, total, breakdown_json, activity_count, computed_at)
       VALUES (?,?,?,?,?,?, unixepoch())`,
		)
		.run(
			opts.developerId,
			opts.dayKey,
			opts.configVersion ?? 1,
			total,
			JSON.stringify(opts.breakdown),
			opts.activityCount,
		);
}

let activitySeq = 0;
function seedActivity(opts: {
	developerId: string;
	dayKey: string;
	type: string;
	configVersion?: number;
}) {
	activitySeq++;
	sqlite.raw
		.query(
			`INSERT INTO activities
         (id, developer_id, type, occurred_at, day_key, config_version,
          provider, org, project, external_ref, source_ids_json)
       VALUES (?,?,?,?,?,?,'ado','acme','Alpha',?,'{"prRepoGuid":"11111111-1111-4111-8111-111111111111","prId":1}')`,
		)
		.run(
			`a${activitySeq}`,
			opts.developerId,
			opts.type,
			1_784_737_800 + activitySeq,
			opts.dayKey,
			opts.configVersion ?? 1,
			`ref-${activitySeq}`,
		);
}

async function summary(query = ""): Promise<StatsSummary> {
	const res = await mount(sqlite.db).request(
		`http://x/api/stats/summary${query}`,
	);
	expect(res.status).toBe(200);
	return (await res.json()) as StatsSummary;
}

beforeEach(() => {
	sqlite = createSqliteD1();
	activitySeq = 0;
});

describe("window helpers", () => {
	test("dayKeyIn uses the given timezone, not UTC", () => {
		// 2026-07-01T16:00Z is already the 2nd in Shanghai.
		const at = Date.parse("2026-07-01T16:00:00Z");
		expect(dayKeyIn("UTC", at)).toBe("2026-07-01");
		expect(dayKeyIn("Asia/Shanghai", at)).toBe("2026-07-02");
	});

	test("shiftDayKey moves whole days", () => {
		expect(shiftDayKey("2026-07-01", -1)).toBe("2026-06-30");
		expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
	});

	test("spanDays counts inclusively", () => {
		expect(spanDays("2026-07-01", "2026-07-01")).toBe(1);
		expect(spanDays("2026-07-01", "2026-07-28")).toBe(28);
		expect(Number.isNaN(spanDays("2026-07-28", "2026-07-01"))).toBe(true);
		expect(Number.isNaN(spanDays("nonsense", "2026-07-01"))).toBe(true);
	});

	test("the default window is 28 days in the configured timezone", () => {
		const now = Date.parse("2026-07-26T16:30:00Z");
		const w = resolveWindow({}, "Asia/Shanghai", now);
		// 16:30Z is already the 27th in Shanghai; using UTC would silently give
		// everyone a different window.
		expect(w).toEqual({ from: "2026-06-30", to: "2026-07-27" });
	});

	test("an explicit window is honoured", () => {
		expect(
			resolveWindow({ from: "2026-07-01", to: "2026-07-10" }, "UTC", 0),
		).toEqual({ from: "2026-07-01", to: "2026-07-10" });
	});

	test("malformed, inverted and oversized windows are rejected", () => {
		expect(resolveWindow({ from: "nope", to: "2026-07-10" }, "UTC", 0)).toEqual(
			{ error: "from and to must both be YYYY-MM-DD" },
		);
		expect(
			resolveWindow({ from: "2026-07-10", to: "2026-07-01" }, "UTC", 0),
		).toEqual({ error: "to must not precede from" });
		expect(
			resolveWindow({ from: "2026-01-01", to: "2026-12-31" }, "UTC", 0),
		).toHaveProperty("error");
	});

	test("a lone bound is rejected rather than half-defaulted", () => {
		expect(resolveWindow({ from: "2026-07-01" }, "UTC", 0)).toHaveProperty(
			"error",
		);
	});
});

describe("statsSummaryRoute", () => {
	test("an empty database reports zeroes, not an error", async () => {
		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.totals).toEqual({
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		});
		expect(body.byType).toEqual([]);
		expect(body.daily).toEqual([]);
		expect(body.lastIngestAt).toBeNull();
		expect(body.scoresStale).toBe(false);
	});

	test("400 for a malformed window", async () => {
		const res = await mount(sqlite.db).request(
			"http://x/api/stats/summary?from=nope&to=2026-07-10",
		);
		expect(res.status).toBe(400);
	});

	test("totals, daily and byType all reconcile", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedDeveloper(DEV_B, "Bob", "bob");
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10, "pr.vote": 3 },
			activityCount: 4,
		});
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-03",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		seedScore({
			developerId: DEV_B,
			dayKey: "2026-07-03",
			breakdown: { "wi.closed": 5 },
			activityCount: 2,
		});
		for (const [type, n] of [
			["pr.merged", 2],
			["pr.vote", 3],
			["wi.closed", 2],
		] as const) {
			for (let i = 0; i < n; i++) {
				seedActivity({ developerId: DEV_A, dayKey: "2026-07-02", type });
			}
		}

		const body = await summary("?from=2026-07-01&to=2026-07-10");

		expect(body.totals.score).toBe(28);
		expect(body.totals.activities).toBe(7);
		expect(body.totals.activeDevelopers).toBe(2);

		// The invariants a manager would notice first if they broke.
		expect(body.daily.reduce((n, d) => n + d.score, 0)).toBe(body.totals.score);
		expect(body.daily.reduce((n, d) => n + d.activityCount, 0)).toBe(
			body.totals.activities,
		);
		expect(body.byType.reduce((n, t) => n + t.score, 0)).toBe(
			body.totals.score,
		);
	});

	test("byType score comes from the folded breakdown, not count × weight", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		// Five same-day pr.active events fold to ONE weight of 2 (06 §3.1 D2).
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.active": 2 },
			activityCount: 5,
		});
		for (let i = 0; i < 5; i++) {
			seedActivity({
				developerId: DEV_A,
				dayKey: "2026-07-02",
				type: "pr.active",
			});
		}

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		const active = body.byType.find((t) => t.type === "pr.active");
		// count is raw events...
		expect(active?.count).toBe(5);
		// ...score is the folded contribution. count × weight would be 10 and
		// would exceed totals.score, so the page would contradict itself.
		expect(active?.score).toBe(2);
		expect(body.totals.score).toBe(2);
	});

	test("a type suppressed by folding still shows its raw count", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		// merged suppresses created for the same PR/day, so only merged scores.
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 2,
		});
		seedActivity({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			type: "pr.merged",
		});
		seedActivity({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			type: "pr.created",
		});

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		const created = body.byType.find((t) => t.type === "pr.created");
		expect(created?.count).toBe(1);
		expect(created?.score).toBe(0);
		expect(body.byType.reduce((n, t) => n + t.score, 0)).toBe(
			body.totals.score,
		);
	});

	test("only the requested window and config version are counted", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedDeveloper(DEV_B, "Bob", "bob");
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		// Outside the window.
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-08-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		// Right day, stale config version.
		seedScore({
			developerId: DEV_B,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
			configVersion: 2,
		});

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.totals.score).toBe(10);
		expect(body.totals.activeDevelopers).toBe(1);
	});

	test("top developers are ranked and named, with a stable tie-break", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedDeveloper(DEV_B, "Bob", "bob");
		seedScore({
			developerId: DEV_B,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.topDevelopers.map((d) => d.name)).toEqual(["Ada", "Bob"]);
		expect(body.topDevelopers[0]?.developerId).toBe(DEV_A);
	});

	test("activeDevelopers counts people with events, even at zero score", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		// An all-zero-weight configuration still means the person was active.
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: {},
			activityCount: 3,
		});
		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.totals.activeDevelopers).toBe(1);
		expect(body.totals.score).toBe(0);
		expect(body.totals.activities).toBe(3);
	});

	test("stale scores return an empty body and the reason, running no aggregates", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		sqlite.raw
			.query("UPDATE settings SET value = 'true' WHERE key = 'scores_stale'")
			.run();
		sqlite.raw
			.query(
				`UPDATE settings SET value = '"email_suffixes updated"' WHERE key = 'scores_stale_reason'`,
			)
			.run();

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.scoresStale).toBe(true);
		expect(body.staleReason).toBe("email_suffixes updated");
		// Numbers exist in the table, but publishing them under a changed
		// configuration would be misleading.
		expect(body.totals).toEqual({
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		});
		expect(body.byType).toEqual([]);
		expect(body.topDevelopers).toEqual([]);
		expect(body.daily).toEqual([]);
	});

	test("lastIngestAt reports only finalized runs of this config", async () => {
		const run = (id: string, status: string, finished: number, v = 1) =>
			sqlite.raw
				.query(
					`INSERT INTO ingest_runs
             (id, started_at, finished_at, status, config_version, mode, run_meta_json)
           VALUES (?,?,?,?,?,'incremental','{}')`,
				)
				.run(id, 1, finished, status, v);
		run("01JRUNFINAL0000000000000A", "finalized", 1_784_700_000);
		// A run still in flight, and one from another config version: neither
		// means "we have collected".
		run("01JRUNCHUNKED000000000000", "chunked", 1_784_900_000);
		run("01JRUNOTHERVERSION0000000", "finalized", 1_784_800_000, 2);

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.lastIngestAt).toBe(1_784_700_000);
	});

	test("an ingest in flight reports unsettled rather than mismatched numbers", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		// Activities land in Phase 1 and Scores in Phase 3, in SEPARATE batches.
		// A snapshot between them sees more activities than scores, so byType
		// count and totals.activities would contradict each other on the page.
		seedActivity({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			type: "pr.merged",
		});
		sqlite.raw
			.query(
				`INSERT INTO ingest_runs
           (id, started_at, status, config_version, mode, run_meta_json)
         VALUES ('01JRUNINFLIGHT0000000000', 1, 'chunked', 1, 'incremental', '{}')`,
			)
			.run();

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.scoresStale).toBe(true);
		expect(body.staleReason).toContain("ingest is in progress");
		expect(body.totals).toEqual({
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		});
	});

	test("a finalized run does not count as in flight", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedScore({
			developerId: DEV_A,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});
		sqlite.raw
			.query(
				`INSERT INTO ingest_runs
           (id, started_at, finished_at, status, config_version, mode, run_meta_json)
         VALUES ('01JRUNDONE00000000000000', 1, 2, 'finalized', 1, 'incremental', '{}')`,
			)
			.run();

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.scoresStale).toBe(false);
		expect(body.totals.score).toBe(10);
	});

	test("stale still reports when data was last collected", async () => {
		sqlite.raw
			.query(
				`INSERT INTO ingest_runs
           (id, started_at, finished_at, status, config_version, mode, run_meta_json)
         VALUES ('01JRUNSTALE0000000000000', 1, 1784700000, 'finalized', 1, 'incremental', '{}')`,
			)
			.run();
		sqlite.raw
			.query("UPDATE settings SET value = 'true' WHERE key = 'scores_stale'")
			.run();

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.scoresStale).toBe(true);
		// "When did we last collect" is operational metadata, not a statistic,
		// so it survives the stale short-circuit.
		expect(body.lastIngestAt).toBe(1_784_700_000);
	});

	test("daily is ordered and one row per day", async () => {
		seedDeveloper(DEV_A, "Ada", "ada");
		seedDeveloper(DEV_B, "Bob", "bob");
		for (const day of ["2026-07-05", "2026-07-02"]) {
			seedScore({
				developerId: DEV_A,
				dayKey: day,
				breakdown: { "pr.merged": 10 },
				activityCount: 1,
			});
		}
		seedScore({
			developerId: DEV_B,
			dayKey: "2026-07-02",
			breakdown: { "pr.merged": 10 },
			activityCount: 1,
		});

		const body = await summary("?from=2026-07-01&to=2026-07-10");
		expect(body.daily.map((d) => d.dayKey)).toEqual([
			"2026-07-02",
			"2026-07-05",
		]);
		// Both developers on the 2nd are summed into one row.
		expect(body.daily[0]?.score).toBe(20);
	});
});
