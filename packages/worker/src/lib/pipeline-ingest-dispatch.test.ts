/**
 * 06 §5.4 Phase 0 dispatch matrix + §5.3.2 concurrent chunk 0, exercised
 * against real SQLite (see test/sqlite-d1.ts) rather than the substring mock,
 * because every branch here depends on rows written by a previous call.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { IngestBody } from "@signoff/domain";
import {
	createSqliteD1,
	type SqliteD1,
	seedDevAndRepo,
} from "../test/sqlite-d1.ts";
import { processIngestChunk } from "./pipeline-ingest-write.ts";
import type { AppSettings } from "./settings.ts";

const DEV = "01K0INTEG06DEV0000000000000";
const REPO = "01K0INTEG06REPO000000000000";
const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const RUN = "01JAY7B4HXTMRP0VQZ0FKZH5E9";
const ORG = "integ-org";
const PROJECT = "Integ Project";

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
			windowTo: "2026-07-23",
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
				matchedUniqueName: "integ@example.com",
				sourceIds: { prRepoGuid: REPO_GUID, prId: 1001 },
			},
		],
		unmatchedIdentities: [],
		...over,
	} as IngestBody;
}

let sqlite: SqliteD1;

beforeEach(() => {
	sqlite = createSqliteD1();
	seedDevAndRepo(sqlite, {
		developerId: DEV,
		alias: "integ",
		repoId: REPO,
		org: ORG,
		project: PROJECT,
		repoName: "integ-repo",
		repoGuid: REPO_GUID,
		projectGuid: PROJ_GUID,
	});
});

function countRows(table: string): number {
	const row = sqlite.raw
		.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`)
		.get();
	return row?.n ?? 0;
}

describe("06 §5.4 Phase 0 dispatch matrix", () => {
	test("new chunk writes activities, scores and chunk state", async () => {
		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.body.activities.upserted).toBe(1);
		expect(res.body.finalized).toBe(false);
		expect(countRows("activities")).toBe(1);
		expect(countRows("scores")).toBe(1);

		const score = sqlite.raw
			.query<{ total: number; activity_count: number }, []>(
				"SELECT total, activity_count FROM scores",
			)
			.get();
		expect(score?.total).toBe(10);
		expect(score?.activity_count).toBe(1);

		const chunk = sqlite.raw
			.query<{ status: string }, []>("SELECT status FROM ingest_chunks")
			.get();
		expect(chunk?.status).toBe("completed");
	});

	test("completed non-final chunk replay is a no-op", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("ok");
		expect(countRows("activities")).toBe(1);
		expect(countRows("scores")).toBe(1);
	});

	test("prepared chunk resumes without double-counting seen_count", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		// Force the chunk back to `prepared` as if Phase 2/3 had been interrupted.
		sqlite.raw.query("UPDATE ingest_chunks SET status = 'prepared'").run();
		const before = sqlite.raw
			.query<{ stats_json: string }, []>("SELECT stats_json FROM ingest_runs")
			.get();

		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("ok");
		expect(countRows("activities")).toBe(1);
		const after = sqlite.raw
			.query<{ stats_json: string }, []>("SELECT stats_json FROM ingest_runs")
			.get();
		expect(after?.stats_json).toBe(before?.stats_json as string);
		const chunk = sqlite.raw
			.query<{ status: string }, []>("SELECT status FROM ingest_chunks")
			.get();
		expect(chunk?.status).toBe("completed");
	});

	test("completed final chunk with unfinalized run runs Phase 4", async () => {
		await processIngestChunk(sqlite.db, body({ isFinalChunk: true }), settings);
		// Roll the run back to `chunked` while the chunk stays `completed`.
		sqlite.raw
			.query("UPDATE ingest_runs SET status = 'chunked', finished_at = NULL")
			.run();

		const res = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);

		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.body.finalized).toBe(true);
		const run = sqlite.raw
			.query<{ status: string }, []>("SELECT status FROM ingest_runs")
			.get();
		expect(run?.status).toBe("finalized");
	});

	test("already finalized run replaying its final chunk stays finalized", async () => {
		await processIngestChunk(sqlite.db, body({ isFinalChunk: true }), settings);
		const res = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);

		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		expect(res.body.finalized).toBe(true);
		expect(countRows("activities")).toBe(1);
	});

	test("digest drift on the same chunk index → 409", async () => {
		await processIngestChunk(sqlite.db, body(), settings);

		const drifted = body();
		drifted.activities[0]!.occurredAt = 1_784_740_000;
		const res = await processIngestChunk(sqlite.db, drifted, settings);

		expect(res.kind).toBe("conflict");
		expect(countRows("activities")).toBe(1);
	});

	test("chunk index gap → 400", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 2 }),
			settings,
		);

		expect(res.kind).toBe("bad_request");
	});

	test("new chunk against an already finalized run → 409", async () => {
		await processIngestChunk(sqlite.db, body({ isFinalChunk: true }), settings);
		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 1 }),
			settings,
		);

		expect(res.kind).toBe("conflict");
	});

	test("runMeta drift on a later chunk → 409", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		const res = await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				runMeta: {
					startedAt: 1_784_737_800,
					source: "fixture",
					windowFrom: "2026-07-01",
					windowTo: "2026-07-24",
					mode: "incremental",
				},
			}),
			settings,
		);

		expect(res.kind).toBe("conflict");
	});

	test("unknown run with a non-zero chunkIndex → 400", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 1 }),
			settings,
		);

		expect(res.kind).toBe("bad_request");
		expect(countRows("ingest_runs")).toBe(0);
	});

	test("existing run whose config_version drifted from settings → 409", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		sqlite.raw.query("UPDATE ingest_runs SET config_version = 2").run();

		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 1 }),
			settings,
		);

		expect(res.kind).toBe("conflict");
	});

	test("final chunk on a run already finalized under a drifted settings version → conflict", async () => {
		await processIngestChunk(sqlite.db, body({ isFinalChunk: true }), settings);
		// Chunk stays completed, run rolled back, but settings moved on.
		sqlite.raw
			.query("UPDATE ingest_runs SET status = 'chunked', finished_at = NULL")
			.run();
		sqlite.raw
			.query(
				"UPDATE settings SET value = '2' WHERE key = 'pipeline_config_version'",
			)
			.run();

		const res = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);

		expect(res.kind).toBe("conflict");
	});
});

describe("06 §5.3.2 concurrent chunk 0", () => {
	test("two chunk-0 writers with different runMeta: exactly one run row wins", async () => {
		const a = body({
			runMeta: {
				startedAt: 1_784_737_800,
				source: "fixture",
				windowFrom: "2026-07-01",
				windowTo: "2026-07-23",
				mode: "incremental",
			},
		});
		const b = body({
			runMeta: {
				startedAt: 1_784_737_999,
				source: "fixture",
				windowFrom: "2026-07-02",
				windowTo: "2026-07-24",
				mode: "full_rematch",
			},
		});

		const [ra, rb] = await Promise.all([
			processIngestChunk(sqlite.db, a, settings),
			processIngestChunk(sqlite.db, b, settings),
		]);

		// Exactly one ingest_runs row exists and its runMeta is not a blend.
		expect(countRows("ingest_runs")).toBe(1);
		const run = sqlite.raw
			.query<{ mode: string; run_meta_json: string }, []>(
				"SELECT mode, run_meta_json FROM ingest_runs",
			)
			.get();
		const meta = JSON.parse(run?.run_meta_json ?? "{}") as {
			windowTo: string;
			mode: string;
		};
		expect(run?.mode).toBe(meta.mode);
		expect([a.runMeta.windowTo, b.runMeta.windowTo]).toContain(meta.windowTo);

		// The loser must not have silently written under the winner's run.
		const kinds = [ra.kind, rb.kind].sort();
		expect(kinds).toContain("ok");
		expect(countRows("activities")).toBe(1);
	});
});
