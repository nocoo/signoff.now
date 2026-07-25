/**
 * 05 §5.5 server-side rejection matrix. The Worker never trusts client-supplied
 * identity/repo linkage: every mismatch must surface as 422 with nothing
 * written. Exercised against real SQLite so the row lookups are genuine.
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

const DEV = "01K0REJECT06DEV000000000000";
const REPO = "01K0REJECT06REPO00000000000";
const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const RUN = "01JAY7B4HXTMRP0VQZ0FKZH5R1";
const ORG = "reject-org";
const PROJECT = "Reject Project";

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
		alias: "reject",
		repoId: REPO,
		org: ORG,
		project: PROJECT,
		repoName: "reject-repo",
		repoGuid: REPO_GUID,
		projectGuid: PROJ_GUID,
	});
});

type ActivityInput = IngestBody["activities"][number];

function withActivity(a: ActivityInput, over: Partial<IngestBody> = {}) {
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
		activities: [a],
		unmatchedIdentities: [],
		...over,
	} as IngestBody;
}

const prMerged = (over: Record<string, unknown> = {}): ActivityInput =>
	({
		type: "pr.merged",
		occurredAt: 1_784_737_800,
		provider: "ado",
		org: ORG,
		project: PROJECT,
		repoId: REPO,
		developerId: DEV,
		matchedUniqueName: "reject@example.com",
		sourceIds: { prRepoGuid: REPO_GUID, prId: 1 },
		...over,
	}) as ActivityInput;

const wiCreated = (over: Record<string, unknown> = {}): ActivityInput =>
	({
		type: "wi.created",
		occurredAt: 1_784_737_800,
		provider: "ado",
		org: ORG,
		project: PROJECT,
		repoId: null,
		developerId: DEV,
		matchedUniqueName: "reject@example.com",
		sourceIds: { projectGuid: PROJ_GUID, wiId: 7 },
		...over,
	}) as ActivityInput;

/**
 * Nothing at all may be persisted by a rejected chunk — not just activities and
 * scores, but run/chunk bookkeeping and unmatched identities too. A partial
 * write here would strand a run in `chunked` forever.
 */
function nothingWritten(): void {
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
}

describe("05 §5.5 server-side rejection matrix", () => {
	test("unknown developerId → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ developerId: "01K0NOSUCHDEV00000000000000" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("archived developer → 422", async () => {
		sqlite.raw
			.query("UPDATE developers SET archived_at = unixepoch() WHERE id = ?")
			.run(DEV);
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged()),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("matchedUniqueName not derivable from alias+suffix → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ matchedUniqueName: "someone@other.com" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("matchedUniqueName casing is accepted (case-insensitive match)", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ matchedUniqueName: "REJECT@Example.COM" })),
			settings,
		);
		expect(res.kind).toBe("ok");
	});

	test("unknown repoId → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ repoId: "01K0NOSUCHREPO0000000000000" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("disabled repo → 422", async () => {
		sqlite.raw.query("UPDATE repos SET enabled = 0 WHERE id = ?").run(REPO);
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged()),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("archived repo → 422", async () => {
		sqlite.raw
			.query("UPDATE repos SET archived_at = unixepoch() WHERE id = ?")
			.run(REPO);
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged()),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("prRepoGuid not matching repos.external_id → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(
				prMerged({
					sourceIds: {
						prRepoGuid: "99999999-9999-4999-8999-999999999999",
						prId: 1,
					},
				}),
			),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("org mismatch against the repo row → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ org: "other-org" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("project mismatch against the repo row → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ project: "Other Project" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("provider mismatch against the repo row → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(prMerged({ provider: "github" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("wi.* org mismatch → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(wiCreated({ org: "other-org" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("wi.* project mismatch → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(wiCreated({ project: "Other Project" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("wi.* provider mismatch → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(wiCreated({ provider: "github" })),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("wi.* projectGuid unknown for org/project → 422", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(
				wiCreated({
					sourceIds: {
						projectGuid: "88888888-8888-4888-8888-888888888888",
						wiId: 7,
					},
				}),
			),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
		nothingWritten();
	});

	test("wi.* with a valid projectGuid is accepted", async () => {
		const res = await processIngestChunk(
			sqlite.db,
			withActivity(wiCreated()),
			settings,
		);
		expect(res.kind).toBe("ok");
		const score = sqlite.raw
			.query<{ total: number }, []>("SELECT total FROM scores")
			.get();
		expect(score?.total).toBe(3);
	});

	test("external_ref owned by another developer → 422 in incremental mode", async () => {
		const other = "01K0OTHERDEV000000000000000";
		sqlite.raw
			.query("INSERT INTO developers (id, name, alias) VALUES (?, ?, ?)")
			.run(other, "Other", "other");
		await processIngestChunk(sqlite.db, withActivity(prMerged()), settings);

		const res = await processIngestChunk(
			sqlite.db,
			withActivity(
				prMerged({
					developerId: other,
					matchedUniqueName: "other@example.com",
				}),
				{ runId: "01JAY7B4HXTMRP0VQZ0FKZH5R2" },
			),
			settings,
		);
		expect(res.kind).toBe("unprocessable");
	});

	test("full_rematch may reassign an external_ref to another developer", async () => {
		const other = "01K0OTHERDEV000000000000000";
		sqlite.raw
			.query("INSERT INTO developers (id, name, alias) VALUES (?, ?, ?)")
			.run(other, "Other", "other");
		await processIngestChunk(sqlite.db, withActivity(prMerged()), settings);

		const res = await processIngestChunk(
			sqlite.db,
			withActivity(
				prMerged({
					developerId: other,
					matchedUniqueName: "other@example.com",
				}),
				{
					runId: "01JAY7B4HXTMRP0VQZ0FKZH5R3",
					runMeta: {
						startedAt: 1_784_737_800,
						source: "fixture",
						windowFrom: "2026-07-01",
						windowTo: "2026-07-23",
						mode: "full_rematch",
					},
				},
			),
			settings,
		);
		expect(res.kind).toBe("ok");

		// The activity moved...
		const rows = sqlite.raw
			.query<{ developer_id: string; n: number }, []>(
				"SELECT developer_id, COUNT(*) AS n FROM activities GROUP BY developer_id",
			)
			.all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.developer_id).toBe(other);

		// ...and the original owner must not keep a stale score for that day.
		const scores = sqlite.raw
			.query<{ developer_id: string; total: number }, []>(
				"SELECT developer_id, total FROM scores ORDER BY developer_id",
			)
			.all();
		expect(scores).toHaveLength(1);
		expect(scores[0]?.developer_id).toBe(other);
		expect(scores[0]?.total).toBe(10);
	});

	test("request version not equal to settings version → 409", async () => {
		const res = await processIngestChunk(sqlite.db, withActivity(prMerged()), {
			...settings,
			pipelineConfigVersion: 2,
		});
		expect(res.kind).toBe("conflict");
		nothingWritten();
	});

	test("invalid timezone in settings → 500", async () => {
		const res = await processIngestChunk(sqlite.db, withActivity(prMerged()), {
			...settings,
			timezone: "Not/AZone",
		});
		expect(res.kind).toBe("server_error");
		nothingWritten();
	});
});
