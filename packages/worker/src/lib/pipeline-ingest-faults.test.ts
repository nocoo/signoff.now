/**
 * Defensive failure paths of the multi-phase write: corrupt persisted state,
 * concurrent run inserts, and settings versions that move mid-ingest. These are
 * the branches that turn into silent data corruption if they ever stop firing,
 * so they are driven with real SQLite plus targeted fault injection.
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

const DEV = "01K0FAULT06DEV0000000000000";
const REPO = "01K0FAULT06REPO000000000000";
const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const RUN = "01JAY7B4HXTMRP0VQZ0FKZH5F1";
const ORG = "fault-org";
const PROJECT = "Fault Project";

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
		alias: "fault",
		repoId: REPO,
		org: ORG,
		project: PROJECT,
		repoName: "fault-repo",
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
				matchedUniqueName: "fault@example.com",
				sourceIds: { prRepoGuid: REPO_GUID, prId: 1 },
			},
		],
		unmatchedIdentities: [],
		...over,
	} as IngestBody;
}

/** A wi.* activity, used where repoId must be null. */
function wiBody(over: Partial<IngestBody> = {}): IngestBody {
	return body({
		activities: [
			{
				type: "wi.created",
				occurredAt: 1_784_737_800,
				provider: "ado",
				org: ORG,
				project: PROJECT,
				repoId: null,
				developerId: DEV,
				matchedUniqueName: "fault@example.com",
				sourceIds: { projectGuid: PROJ_GUID, wiId: 5 },
			},
		],
		...over,
	} as Partial<IngestBody>);
}

describe("write path defensive failures", () => {
	test("source_ids_json holding a JSON scalar → 500 shape mismatch", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		// json_valid() accepts scalars, so `"nope"` passes the 0006 CHECK while
		// still being an impossible sourceIds payload.
		sqlite.raw.query(`UPDATE activities SET source_ids_json = '"nope"'`).run();

		// Second chunk touches the same dev-day, so Phase 2 re-reads the bad row.
		const res = await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				activities: [
					{
						type: "pr.created",
						occurredAt: 1_784_737_900,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "fault@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 2 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);

		expect(res.kind).toBe("server_error");
		if (res.kind === "server_error") {
			expect(res.error).toContain("shape mismatch");
		}
	});

	test("source_ids_json that does not match its activity type → 500", async () => {
		await processIngestChunk(sqlite.db, body(), settings);
		// Valid JSON, wrong shape for pr.merged (needs prRepoGuid + prId).
		sqlite.raw
			.query(`UPDATE activities SET source_ids_json = '{"wiId":1}'`)
			.run();

		const res = await processIngestChunk(
			sqlite.db,
			body({
				chunkIndex: 1,
				activities: [
					{
						type: "pr.created",
						occurredAt: 1_784_737_900,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "fault@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 2 },
					},
				],
			} as Partial<IngestBody>),
			settings,
		);

		expect(res.kind).toBe("server_error");
		if (res.kind === "server_error") {
			expect(res.error).toContain("shape mismatch");
		}
	});

	test("duplicate run insert rolls the whole Phase 1 batch back", async () => {
		// Simulate the loser of a chunk-0 race: the row appears between Phase 0's
		// read and the Phase 1 batch, so the INSERT hits the primary key. The
		// batch also carries the activity/chunk writes, none of which may survive.
		sqlite.beforeBatch("INSERT INTO ingest_runs", () => {
			sqlite.raw
				.query(
					`INSERT INTO ingest_runs
             (id, started_at, status, config_version, mode, run_meta_json)
           VALUES (?, ?, 'chunked', 1, 'incremental', '{}')`,
				)
				.run(RUN, 1_784_737_800);
		});

		const res = await processIngestChunk(sqlite.db, body(), settings);

		expect(res.kind).toBe("server_error");
		if (res.kind === "server_error") {
			expect(res.error).toBe("Concurrent run insert race");
		}

		// Only the injected row exists; the batch's own writes rolled back.
		const runs = sqlite.raw
			.query<{ run_meta_json: string; n: number }, []>(
				"SELECT run_meta_json, COUNT(*) AS n FROM ingest_runs",
			)
			.get();
		expect(runs?.n).toBe(1);
		expect(runs?.run_meta_json).toBe("{}");
		for (const table of ["activities", "scores", "ingest_chunks"]) {
			const row = sqlite.raw
				.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`)
				.get();
			expect(`${table}=${row?.n}`).toBe(`${table}=0`);
		}
	});

	test("settings version bumped before the Phase 1 batch → CAS conflict", async () => {
		sqlite.beforeBatch("INSERT INTO activities", () => {
			sqlite.raw
				.query(
					"UPDATE settings SET value = '2' WHERE key = 'pipeline_config_version'",
				)
				.run();
		});

		const res = await processIngestChunk(sqlite.db, body(), settings);

		// Every Phase 1 statement binds the settings version, so the batch writes
		// nothing rather than landing rows under a stale config. `ingest_runs`
		// matters most: a run row committed here would be stranded in `chunked`
		// with no chunks and no way to finalize.
		expect(res.kind).toBe("conflict");
		for (const table of [
			"activities",
			"scores",
			"ingest_runs",
			"ingest_chunks",
			"unmatched_identities",
		]) {
			const row = sqlite.raw
				.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`)
				.get();
			expect(`${table}=${row?.n}`).toBe(`${table}=0`);
		}
	});

	test("a batch that fails midway leaves none of its earlier statements behind", async () => {
		// Guards the harness itself: if batch() stopped being transactional, the
		// rollback assertions elsewhere in this file would silently become
		// vacuous. Statement 1 succeeds, statement 2 violates a constraint.
		const before = sqlite.raw
			.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM developers")
			.get();

		await expect(
			sqlite.db.batch([
				sqlite.db
					.prepare("INSERT INTO developers (id, name, alias) VALUES (?,?,?)")
					.bind("01K0MIDBATCH0000000000000000", "Mid", "mid"),
				// Duplicate primary key: fails after the first insert applied.
				sqlite.db
					.prepare("INSERT INTO developers (id, name, alias) VALUES (?,?,?)")
					.bind(DEV, "Dup", "dup"),
			]),
		).rejects.toThrow();

		const after = sqlite.raw
			.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM developers")
			.get();
		expect(after?.n).toBe(before?.n as number);
	});

	test("pr.* activity with a null repoId is rejected before any write", async () => {
		// zod normally blocks this; the write path keeps its own guard because the
		// route is not the only caller. Cast through unknown: the shape is
		// deliberately illegal.
		const res = await processIngestChunk(
			sqlite.db,
			body({
				activities: [
					{
						type: "pr.merged",
						occurredAt: 1_784_737_800,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: null,
						developerId: DEV,
						matchedUniqueName: "fault@example.com",
						sourceIds: { prRepoGuid: REPO_GUID, prId: 1 },
					},
				],
			} as unknown as Partial<IngestBody>),
			settings,
		);

		expect(res.kind).toBe("unprocessable");
		if (res.kind === "unprocessable") {
			expect(res.error).toContain("repoId");
		}
	});

	test("wi.* activity carrying a repoId is rejected before any write", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			wiBody({
				activities: [
					{
						type: "wi.created",
						occurredAt: 1_784_737_800,
						provider: "ado",
						org: ORG,
						project: PROJECT,
						repoId: REPO,
						developerId: DEV,
						matchedUniqueName: "fault@example.com",
						sourceIds: { projectGuid: PROJ_GUID, wiId: 5 },
					},
				],
			} as unknown as Partial<IngestBody>),
			settings,
		);

		expect(res.kind).toBe("unprocessable");
		if (res.kind === "unprocessable") {
			expect(res.error).toContain("repoId null");
		}
	});
});
