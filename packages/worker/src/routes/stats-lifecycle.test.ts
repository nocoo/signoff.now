/**
 * The in-flight guard, driven through a REAL ingest rather than hand-inserted
 * rows (08 §3.3).
 *
 * Inserting a `prepared` chunk directly asserts the guard's SQL. It does not
 * assert that the state it keys on is the state a live ingest actually passes
 * through — so a write path that stopped using `prepared`, or a run that fails
 * somewhere else entirely, would leave those tests green while the Dashboard
 * published contradictory numbers.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { IngestBody } from "@signoff/domain";
import { Hono } from "hono";
import { processIngestChunk } from "../lib/pipeline-ingest-write.ts";
import type { AppSettings } from "../lib/settings.ts";
import {
	createSqliteD1,
	type SqliteD1,
	seedDevAndRepo,
} from "../test/sqlite-d1.ts";
import type { AppEnv } from "../types.js";
import { activityHeatmapRoute } from "./activity.ts";
import { type StatsSummary, statsSummaryRoute } from "./stats.ts";

const DEV = "01K0LIFEDEV000000000000000";
const REPO = "01K0LIFEREPO00000000000000";
const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const RUN = "01JAY7B4HXTMRP0VQZ0FKZH5F1";
const ORG = "life-org";
const PROJECT = "Life Project";
const WINDOW = "?from=2026-07-01&to=2026-07-31";

const settings: AppSettings = {
	timezone: "Asia/Shanghai",
	emailSuffixes: ["example.com"],
	activityWeights: {
		"pr.merged": 10,
		"pr.closed": 2,
		"pr.created": 2,
		"pr.vote": 3,
		"pr.active": 2,
		"wi.created": 3,
		"wi.updated": 1,
		"wi.closed": 5,
	},
	pipelineConfigVersion: 1,
	scoresStale: false,
	scoresStaleReason: null,
	updatedAt: {},
};

let sqlite: SqliteD1;

beforeEach(() => {
	sqlite = createSqliteD1();
	seedDevAndRepo(sqlite, {
		developerId: DEV,
		alias: "life",
		repoId: REPO,
		org: ORG,
		project: PROJECT,
		repoName: "life-repo",
		repoGuid: REPO_GUID,
		projectGuid: PROJ_GUID,
	});
});

function body(over: Partial<IngestBody> = {}): IngestBody {
	return {
		pipelineConfigVersion: 1,
		runId: RUN,
		chunkIndex: 0,
		isFinalChunk: false,
		runMeta: {
			startedAt: 1_784_737_800,
			source: "fixture",
			windowFrom: "2026-07-01",
			windowTo: "2026-07-31",
			mode: "incremental",
		},
		activities: [
			{
				type: "pr.merged",
				occurredAt: 1_784_737_800,
				provider: "ado",
				org: ORG,
				project: PROJECT,
				repoId: REPO,
				developerId: DEV,
				matchedUniqueName: "life@example.com",
				sourceIds: { prRepoGuid: REPO_GUID, prId: 1 },
			},
		],
		unmatchedIdentities: [],
		...over,
	} as IngestBody;
}

async function summary(): Promise<StatsSummary> {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: sqlite.db } as AppEnv["Bindings"];
		return next();
	});
	app.get("/api/stats/summary", statsSummaryRoute);
	const res = await app.request(`/api/stats/summary${WINDOW}`);
	return (await res.json()) as StatsSummary;
}

const chunkStatuses = () =>
	sqlite.raw
		.query("SELECT chunk_index, status FROM ingest_chunks ORDER BY chunk_index")
		.all() as { chunk_index: number; status: string }[];

type HeatmapBody = {
	rows: { developerId: string; total: number; activityCount: number }[];
};

/** The other endpoint a manager reaches for the same person's numbers. */
async function heatmap(): Promise<HeatmapBody> {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: sqlite.db } as AppEnv["Bindings"];
		return next();
	});
	app.get("/api/activity/heatmap", activityHeatmapRoute);
	const res = await app.request(
		`/api/activity/heatmap?devs=${DEV}&from=2026-07-01&to=2026-07-31`,
	);
	return (await res.json()) as HeatmapBody;
}

describe("the in-flight guard over a real ingest", () => {
	test("a run frozen between activities and scores blanks the numbers", async () => {
		// Phase 1 commits activities; Phase 3 commits scores; they are separate
		// batches. Crash in between and the two tables disagree — which is the
		// entire reason the guard exists.
		sqlite.beforeBatch("INSERT INTO scores", () => {
			throw new Error("crash between phase 1 and phase 3");
		});
		const res = await processIngestChunk(sqlite.db, body(), settings);
		expect(res.kind).not.toBe("ok");

		// Verify the state we are actually testing, rather than assuming it.
		expect(chunkStatuses()).toEqual([{ chunk_index: 0, status: "prepared" }]);
		const activityCount = (
			sqlite.raw.query("SELECT COUNT(*) AS n FROM activities").get() as {
				n: number;
			}
		).n;
		const scoreCount = (
			sqlite.raw.query("SELECT COUNT(*) AS n FROM scores").get() as {
				n: number;
			}
		).n;
		expect(activityCount).toBe(1);
		expect(scoreCount).toBe(0);

		const body1 = await summary();
		expect(body1.scoresStale).toBe(true);
		expect(body1.staleReason).toContain(RUN);
		// Without the guard this would report 1 activity and 0 score.
		expect(body1.totals).toEqual({
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		});
		expect(body1.byType).toEqual([]);
	});

	test("resuming the frozen run clears the guard and the numbers return", async () => {
		// The prepared chunk is resumable by design: the same digest jumps
		// straight to the score phase. So "unsettled" must be recoverable, not a
		// terminal state the Dashboard never leaves.
		let armed = true;
		sqlite.beforeBatch("INSERT INTO scores", () => {
			if (armed) {
				throw new Error("crash between phase 1 and phase 3");
			}
		});
		const frozen = await processIngestChunk(sqlite.db, body(), settings);
		expect(frozen.kind).not.toBe("ok");
		expect((await summary()).scoresStale).toBe(true);

		armed = false;
		const res = await processIngestChunk(sqlite.db, body(), settings);
		expect(res.kind).toBe("ok");
		expect(chunkStatuses()).toEqual([{ chunk_index: 0, status: "completed" }]);

		const after = await summary();
		expect(after.scoresStale).toBe(false);
		expect(after.totals.activities).toBe(1);
		expect(after.totals.score).toBe(10);
	});

	test("a completed chunk publishes even though the run is still chunked", async () => {
		// Between chunks there is nothing half-written. A guard keyed on the run
		// would blank a long multi-chunk ingest for its whole duration.
		const res = await processIngestChunk(sqlite.db, body(), settings);
		expect(res.kind).toBe("ok");
		const run = sqlite.raw
			.query("SELECT status FROM ingest_runs WHERE id = ?")
			.get(RUN) as { status: string };
		expect(run.status).toBe("chunked");
		expect(chunkStatuses()).toEqual([{ chunk_index: 0, status: "completed" }]);

		const published = await summary();
		expect(published.scoresStale).toBe(false);
		expect(published.totals.score).toBe(10);
	});

	test("one frozen chunk of a multi-chunk run blanks the whole summary", async () => {
		// Partial data is still contradictory data, even when earlier chunks
		// completed cleanly.
		const first = await processIngestChunk(sqlite.db, body(), settings);
		expect(first.kind).toBe("ok");
		sqlite.beforeBatch("INSERT INTO scores", () => {
			throw new Error("crash on the second chunk");
		});
		const second = await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				activities: [
					{
						type: "pr.created",
						occurredAt: 1_784_740_000,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "life@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 2 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);
		expect(second.kind).not.toBe("ok");

		expect(chunkStatuses()).toEqual([
			{ chunk_index: 0, status: "completed" },
			{ chunk_index: 1, status: "prepared" },
		]);
		const blanked = await summary();
		expect(blanked.scoresStale).toBe(true);
		expect(blanked.totals.score).toBe(0);
	});

	test("a finalized run publishes and leaves no prepared chunk behind", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);
		expect(res.kind).toBe("ok");
		const run = sqlite.raw
			.query("SELECT status FROM ingest_runs WHERE id = ?")
			.get(RUN) as { status: string };
		expect(run.status).toBe("finalized");
		expect(chunkStatuses().every((c) => c.status === "completed")).toBe(true);

		const published = await summary();
		expect(published.scoresStale).toBe(false);
		expect(published.totals.score).toBe(10);
		expect(published.lastIngestAt).not.toBeNull();
	});

	test("settings moving during the aggregates suppress the mixed result", async () => {
		// The version is read before the batch and re-read after. If an operator
		// changes weights in between, half these numbers belong to the old
		// configuration and half to the new one — a blend that is true of
		// neither, and that no reader could detect from the page.
		const ok = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);
		expect(ok.kind).toBe("ok");
		expect((await summary()).totals.score).toBe(10);

		sqlite.beforeBatch("FROM scores", () => {
			sqlite.raw
				.query(
					"UPDATE settings SET value = '2' WHERE key = 'pipeline_config_version'",
				)
				.run();
		});

		const mid = await summary();
		expect(mid.scoresStale).toBe(true);
		expect(mid.pipelineConfigVersion).toBe(2);
		expect(mid.totals.score).toBe(0);
	});

	test("stale being switched on mid-aggregate also suppresses", async () => {
		const ok = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);
		expect(ok.kind).toBe("ok");

		sqlite.beforeBatch("FROM scores", () => {
			sqlite.raw
				.query("UPDATE settings SET value = 'true' WHERE key = 'scores_stale'")
				.run();
		});

		const mid = await summary();
		expect(mid.scoresStale).toBe(true);
		expect(mid.totals.score).toBe(0);
	});
	test("the same ingest gives the heatmap and the Dashboard the same score", async () => {
		// 08 §5.3's last invariant, and the one a manager hits first: they click
		// a name on the Dashboard, land on the heatmap, and compare. Two
		// endpoints, two query shapes, one number — a mismatch means one of them
		// is lying and there is no way to tell which.
		const first = await processIngestChunk(sqlite.db, body(), settings);
		expect(first.kind).toBe("ok");
		const second = await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				isFinalChunk: true,
				activities: [
					{
						type: "wi.closed",
						occurredAt: 1_784_824_200,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: null,
						developerId: DEV,
						matchedUniqueName: "life@example.com",
						sourceIds: { projectGuid: PROJ_GUID, wiId: 7 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);
		expect(second.kind).toBe("ok");

		const dash = await summary();
		const heat = await heatmap();
		expect(heat.rows.length).toBeGreaterThan(0);

		const heatTotal = heat.rows.reduce((n, r) => n + r.total, 0);
		const heatCount = heat.rows.reduce((n, r) => n + r.activityCount, 0);
		expect(heatTotal).toBe(dash.totals.score);
		expect(heatCount).toBe(dash.totals.activities);
		const dashDev = dash.topDevelopers.find((d) => d.developerId === DEV);
		expect(dashDev?.score).toBe(heatTotal);
	});
});
