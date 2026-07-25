/**
 * 06 §5.4 Phase 0 dispatch matrix + §5.3.2 concurrent chunk 0, exercised
 * against real SQLite (see test/sqlite-d1.ts) rather than the substring mock,
 * because every branch here depends on rows written by a previous call.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { IngestBody } from "@signoff/domain";
import {
	createConcurrentSqliteD1,
	createSqliteD1,
	type SqliteD1,
	seedDevAndRepo,
	seedRaw,
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

/**
 * Full picture of everything an ingest may touch. Rejected dispatches must
 * leave this byte-identical — a 409 that still moved a row is worse than a
 * crash, because nothing downstream would notice.
 */
function snapshot(): string {
	const dump = (sql: string) => JSON.stringify(sqlite.raw.query(sql).all());
	return [
		dump("SELECT * FROM activities ORDER BY external_ref"),
		dump("SELECT * FROM scores ORDER BY developer_id, day_key"),
		dump("SELECT * FROM ingest_runs ORDER BY id"),
		dump("SELECT * FROM ingest_chunks ORDER BY run_id, chunk_index"),
		dump("SELECT * FROM unmatched_identities ORDER BY unique_name"),
	].join("|");
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

	test("completed non-final chunk replay rewrites nothing", async () => {
		await processIngestChunk(sqlite.db, body(), settings);

		// Fingerprint the persisted state, then make every row distinguishable so
		// a replay that re-runs Phase 1–3 cannot pass unnoticed.
		sqlite.raw.query("UPDATE activities SET ingested_at = 1").run();
		sqlite.raw.query("UPDATE scores SET computed_at = 1, total = 999").run();
		sqlite.raw.query("UPDATE ingest_chunks SET finished_at = 1").run();

		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		// A true no-op reports zero work rather than replaying the chunk.
		expect(res.body.activities.upserted).toBe(0);
		expect(res.body.scores.recomputed).toBe(0);

		expect(countRows("activities")).toBe(1);
		expect(countRows("scores")).toBe(1);
		const act = sqlite.raw
			.query<{ ingested_at: number }, []>("SELECT ingested_at FROM activities")
			.get();
		const score = sqlite.raw
			.query<{ computed_at: number; total: number }, []>(
				"SELECT computed_at, total FROM scores",
			)
			.get();
		const chunk = sqlite.raw
			.query<{ finished_at: number }, []>(
				"SELECT finished_at FROM ingest_chunks",
			)
			.get();
		expect(act?.ingested_at).toBe(1);
		expect(chunk?.finished_at).toBe(1);
		// The deliberately-wrong score survives: no recomputation happened.
		expect(score?.computed_at).toBe(1);
		expect(score?.total).toBe(999);
	});

	test("prepared chunk resumes into the score phase without re-inserting activities", async () => {
		await processIngestChunk(sqlite.db, body(), settings);

		// Model an interruption after Phase 1 but before Phase 3 completed: the
		// activity row exists, the chunk is prepared, and the score is missing.
		sqlite.raw
			.query("UPDATE ingest_chunks SET status = 'prepared', finished_at = NULL")
			.run();
		sqlite.raw.query("DELETE FROM scores").run();
		sqlite.raw.query("UPDATE activities SET ingested_at = 1").run();
		const statsBefore = sqlite.raw
			.query<{ stats_json: string | null }, []>(
				"SELECT stats_json FROM ingest_runs",
			)
			.get()?.stats_json;

		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("ok");
		// Resuming must rebuild the score the interruption lost...
		expect(countRows("scores")).toBe(1);
		const score = sqlite.raw
			.query<{ total: number; activity_count: number }, []>(
				"SELECT total, activity_count FROM scores",
			)
			.get();
		expect(score?.total).toBe(10);
		expect(score?.activity_count).toBe(1);

		// ...without re-running Phase 1: the activity keeps its original stamp
		// and no duplicate row appears.
		expect(countRows("activities")).toBe(1);
		const act = sqlite.raw
			.query<{ ingested_at: number }, []>("SELECT ingested_at FROM activities")
			.get();
		expect(act?.ingested_at).toBe(1);

		// Run-level counters must not be double-counted by the resume.
		const statsAfter = sqlite.raw
			.query<{ stats_json: string | null }, []>(
				"SELECT stats_json FROM ingest_runs",
			)
			.get()?.stats_json;
		expect(statsAfter).toBe(statsBefore ?? null);

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
		const first = await processIngestChunk(sqlite.db, body(), settings);
		expect(first.kind).toBe("ok");
		const before = snapshot();

		const drifted = body();
		drifted.activities[0]!.occurredAt = 1_784_740_000;
		const res = await processIngestChunk(sqlite.db, drifted, settings);

		expect(res.kind).toBe("conflict");
		expect(snapshot()).toBe(before);
	});

	// The digest guard must hold at every index, not just the first few. Driving
	// several indices makes an `index < N` regression visible wherever N sits.
	for (const target of [1, 2, 3]) {
		test(`digest drift on chunk index ${target} → 409`, async () => {
			const chunkAt = (index: number, occurredAt: number) =>
				body({
					chunkIndex: index,
					activities: [
						{
							type: "pr.created",
							occurredAt,
							provider: "ado",
							org: ORG,
							project: PROJECT,
							repoId: REPO,
							developerId: DEV,
							matchedUniqueName: "integ@example.com",
							sourceIds: { prRepoGuid: REPO_GUID, prId: 2000 + index },
						},
					],
				} as Partial<IngestBody>);

			await processIngestChunk(sqlite.db, body(), settings);
			for (let i = 1; i <= target; i++) {
				const r = await processIngestChunk(
					sqlite.db,
					chunkAt(i, 1_784_737_900 + i),
					settings,
				);
				expect(r.kind).toBe("ok");
			}
			const before = snapshot();

			// Same index, different payload → different digest.
			const res = await processIngestChunk(
				sqlite.db,
				chunkAt(target, 1_784_999_000 + target),
				settings,
			);

			expect(res.kind).toBe("conflict");
			expect(snapshot()).toBe(before);
		});
	}

	test("chunk index gap → 400", async () => {
		const first = await processIngestChunk(sqlite.db, body(), settings);
		expect(first.kind).toBe("ok");
		// The run exists and chunk 0 landed, so index 2 can only be a gap — not
		// the separate "unknown run" branch.
		expect(countRows("ingest_runs")).toBe(1);
		expect(countRows("ingest_chunks")).toBe(1);
		const before = snapshot();

		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 2 }),
			settings,
		);

		expect(res.kind).toBe("bad_request");
		expect(snapshot()).toBe(before);
	});

	test("new chunk against an already finalized run → 409", async () => {
		const first = await processIngestChunk(
			sqlite.db,
			body({ isFinalChunk: true }),
			settings,
		);
		expect(first.kind).toBe("ok");
		const before = snapshot();

		const res = await processIngestChunk(
			sqlite.db,
			body({ chunkIndex: 1 }),
			settings,
		);

		expect(res.kind).toBe("conflict");
		expect(snapshot()).toBe(before);
	});

	test("runMeta drift on a later chunk → 409", async () => {
		const first = await processIngestChunk(sqlite.db, body(), settings);
		expect(first.kind).toBe("ok");
		const before = snapshot();

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
		expect(snapshot()).toBe(before);
	});

	test("prepared resume does not double-count unmatched seen_count", async () => {
		// `seen_count = seen_count + 1` is the one genuinely non-idempotent write
		// in Phase 1, so a resume that re-runs it corrupts the tally silently.
		const withUnmatched = body({
			unmatchedIdentities: [
				{ uniqueName: "ghost@example.com", sampleOrg: ORG },
			],
		} as Partial<IngestBody>);

		await processIngestChunk(sqlite.db, withUnmatched, settings);
		const first = sqlite.raw
			.query<{ seen_count: number }, []>(
				"SELECT seen_count FROM unmatched_identities WHERE unique_name = 'ghost@example.com'",
			)
			.get();
		expect(first?.seen_count).toBe(1);

		// Interrupt after Phase 1, then resume the same chunk.
		sqlite.raw
			.query("UPDATE ingest_chunks SET status = 'prepared', finished_at = NULL")
			.run();
		const res = await processIngestChunk(sqlite.db, withUnmatched, settings);
		expect(res.kind).toBe("ok");

		const after = sqlite.raw
			.query<{ seen_count: number }, []>(
				"SELECT seen_count FROM unmatched_identities WHERE unique_name = 'ghost@example.com'",
			)
			.get();
		expect(after?.seen_count).toBe(1);
		expect(countRows("unmatched_identities")).toBe(1);
	});

	test("a distinct chunk seeing the same identity increments seen_count", async () => {
		// The positive half of the contract: `seen_count + 1` must actually fire
		// for genuinely new sightings, or the unmatched report is useless.
		const ghost = { uniqueName: "ghost@example.com", sampleOrg: ORG };

		await processIngestChunk(
			sqlite.db,
			body({ unmatchedIdentities: [ghost] } as Partial<IngestBody>),
			settings,
		);
		await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				unmatchedIdentities: [ghost],
				activities: [
					{
						type: "pr.created",
						occurredAt: 1_784_737_900,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "integ@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 1002 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);

		// Seed a high count: any cap (MIN(seen_count + 1, N)) becomes visible,
		// and the assertion below pins "exactly one increment per new chunk"
		// rather than a small absolute number a cap could coincide with.
		sqlite.raw
			.query(
				"UPDATE unmatched_identities SET seen_count = 41 WHERE unique_name = 'ghost@example.com'",
			)
			.run();

		// A third distinct chunk.
		await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 2,
				unmatchedIdentities: [ghost],
				activities: [
					{
						type: "pr.created",
						occurredAt: 1_784_738_000,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "integ@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 1003 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);

		const row = sqlite.raw
			.query<{ seen_count: number }, []>(
				"SELECT seen_count FROM unmatched_identities WHERE unique_name = 'ghost@example.com'",
			)
			.get();
		expect(row?.seen_count).toBe(42);
		expect(countRows("unmatched_identities")).toBe(1);
	});

	test("replaying a completed chunk does not double-count unmatched seen_count", async () => {
		const withUnmatched = body({
			unmatchedIdentities: [
				{ uniqueName: "ghost@example.com", sampleOrg: ORG },
			],
		} as Partial<IngestBody>);

		await processIngestChunk(sqlite.db, withUnmatched, settings);
		await processIngestChunk(sqlite.db, withUnmatched, settings);

		const row = sqlite.raw
			.query<{ seen_count: number }, []>(
				"SELECT seen_count FROM unmatched_identities WHERE unique_name = 'ghost@example.com'",
			)
			.get();
		expect(row?.seen_count).toBe(1);
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
	const WINNER_META: IngestBody["runMeta"] = {
		startedAt: 1_784_737_800,
		source: "fixture",
		windowFrom: "2026-07-01",
		windowTo: "2026-07-23",
		mode: "incremental",
	};

	const LOSER_META: IngestBody["runMeta"] = {
		startedAt: 1_784_737_999,
		source: "ado",
		windowFrom: "2026-07-02",
		windowTo: "2026-07-24",
		mode: "full_rematch",
	};

	/**
	 * 06 forbids `ON CONFLICT DO UPDATE` on `ingest_runs`: a losing writer must
	 * never rewrite the winner's mode / runMeta / config_version.
	 *
	 * This is asserted structurally rather than behaviourally on purpose. The
	 * run INSERT and the chunk-0 INSERT ride the same Phase 1 batch, so a stale
	 * loser always finds BOTH rows committed — the duplicate chunk key would
	 * roll its batch back even if the run statement had been weakened to an
	 * upsert. That makes the ban unobservable at runtime, and an unobservable
	 * rule is exactly the kind that rots. Reading the SQL is the honest check.
	 */
	test("run and chunk 0 are inserted by one batch, and the run never upserts", async () => {
		// Record actual batch membership, not just which statements were prepared:
		// splitting Phase 1 across two batches would break the atomic co-commit
		// that makes the upsert ban enforceable at all.
		const batches: string[][] = [];
		const recording = new Proxy(sqlite.db, {
			get(target, prop, receiver) {
				if (prop === "batch") {
					return async (stmts: { sql?: string }[]) => {
						batches.push(stmts.map((st) => st.sql ?? ""));
						return (target.batch as (s: unknown[]) => Promise<D1Result[]>)(
							stmts,
						);
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});

		const res = await processIngestChunk(
			recording as D1Database,
			body({ runMeta: WINNER_META }),
			settings,
		);
		expect(res.kind).toBe("ok");

		const isRunInsert = (sql: string) =>
			/INSERT\s+INTO\s+ingest_runs/i.test(sql);
		const isChunkInsert = (sql: string) =>
			/INSERT\s+INTO\s+ingest_chunks/i.test(sql);

		const phase1 = batches.find((b) => b.some(isRunInsert));
		expect(phase1).toBeDefined();
		// Same batch → a stale loser hits the chunk primary key and rolls back.
		expect(phase1?.some(isChunkInsert)).toBe(true);
		// And nothing else may insert either row in a separate batch.
		expect(batches.filter((b) => b.some(isRunInsert))).toHaveLength(1);
		expect(batches.filter((b) => b.some(isChunkInsert))).toHaveLength(1);

		// 06 forbids upserting `ingest_runs`: a loser must never rewrite the
		// winner's mode / runMeta. Strip comments before matching so
		// `ON /*x*/ CONFLICT` cannot slip through.
		const runInsert = (phase1 ?? [])
			.find(isRunInsert)
			?.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/--[^\n]*/g, " ");
		expect(runInsert).toBeDefined();
		expect(runInsert).not.toMatch(/ON\s+CONFLICT/i);
		expect(runInsert).not.toMatch(/INSERT\s+OR\s+(REPLACE|IGNORE)/i);
	});

	test("a committed winner leaves a stale loser no way in", async () => {
		// The realistic race outcome: the winner's Phase 1 batch committed run
		// AND chunk 0 atomically, so whatever the loser does next, it must not
		// disturb any of it.
		const winner = await processIngestChunk(
			sqlite.db,
			body({ runMeta: WINNER_META }),
			settings,
		);
		expect(winner.kind).toBe("ok");
		const before = snapshot();

		const res = await processIngestChunk(
			sqlite.db,
			body({ runMeta: LOSER_META }),
			settings,
		);

		expect(res.kind).toBe("conflict");
		expect(snapshot()).toBe(before);
		const run = sqlite.raw
			.query<{ run_meta_json: string; mode: string }, []>(
				"SELECT run_meta_json, mode FROM ingest_runs",
			)
			.get();
		expect(JSON.parse(run?.run_meta_json ?? "{}")).toEqual(WINNER_META);
		expect(run?.mode).toBe(WINNER_META.mode);
	});

	test("a loser matching the winner's payload is absorbed idempotently", async () => {
		// Same digest, same runMeta: the second writer is a duplicate delivery,
		// not a conflict, and must not double-write.
		await processIngestChunk(
			sqlite.db,
			body({ runMeta: WINNER_META }),
			settings,
		);
		const before = snapshot();

		const res = await processIngestChunk(
			sqlite.db,
			body({ runMeta: WINNER_META }),
			settings,
		);

		expect(res.kind).toBe("ok");
		expect(snapshot()).toBe(before);
	});

	test("two writers held past Phase 0 on independent connections", async () => {
		const cx = createConcurrentSqliteD1(2);
		seedRaw(cx.raw, {
			developerId: DEV,
			alias: "integ",
			repoId: REPO,
			org: ORG,
			project: PROJECT,
			repoName: "integ-repo",
			repoGuid: REPO_GUID,
			projectGuid: PROJ_GUID,
		});

		try {
			cx.barrierBeforeBatch("INSERT INTO ingest_runs", 2);
			const [ra, rb] = await Promise.all([
				processIngestChunk(
					cx.connections[0] as D1Database,
					body({ runMeta: WINNER_META }),
					settings,
				),
				processIngestChunk(
					cx.connections[1] as D1Database,
					body({ runMeta: LOSER_META }),
					settings,
				),
			]);

			// Self-check: if the barrier ever stops holding both writers, this
			// test silently degrades into two sequential calls.
			expect(cx.barrierArrivals()).toBe(2);
			expect([ra.kind, rb.kind].filter((k) => k === "ok")).toHaveLength(1);

			const runs = cx.raw
				.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ingest_runs")
				.get();
			expect(runs?.n).toBe(1);
			const chunks = cx.raw
				.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ingest_chunks")
				.get();
			expect(chunks?.n).toBe(1);

			const stored = JSON.parse(
				cx.raw
					.query<{ run_meta_json: string }, []>(
						"SELECT run_meta_json FROM ingest_runs",
					)
					.get()?.run_meta_json ?? "{}",
			);
			// Whole-object equality: no field may come from the other racer.
			expect([WINNER_META, LOSER_META]).toContainEqual(stored);
		} finally {
			cx.close();
		}
	});
});
