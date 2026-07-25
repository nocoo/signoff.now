import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1, DEFAULT_SETTINGS_ROWS } from "../test/mock-d1.js";
import { createSqliteD1, seedDevAndRepo } from "../test/sqlite-d1.js";
import type { AppEnv } from "../types.js";
import {
	pipelineBootstrapRoute,
	pipelineIngestRoute,
	pipelineRecomputeCompleteRoute,
} from "./pipeline.js";

function mount(db: D1Database) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: db };
		return next();
	});
	app.get("/api/pipeline/bootstrap", pipelineBootstrapRoute);
	app.post("/api/pipeline/ingest", pipelineIngestRoute);
	app.post("/api/pipeline/recompute/complete", pipelineRecomputeCompleteRoute);
	return app;
}

const validIngest = {
	pipelineConfigVersion: 1,
	runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
	chunkIndex: 0,
	isFinalChunk: true,
	runMeta: {
		startedAt: 1720000000,
		source: "fixture",
		windowFrom: "2026-06-01",
		windowTo: "2026-07-01",
		mode: "full_rematch",
	},
	activities: [
		{
			type: "pr.merged",
			occurredAt: 1720000123,
			provider: "ado",
			org: "acme",
			project: "Alpha",
			repoId: "repo-1",
			developerId: "dev-1",
			matchedUniqueName: "ada@example.com",
			sourceIds: {
				prRepoGuid: "11111111-1111-4111-8111-111111111111",
				prId: 1001,
			},
		},
	],
	unmatchedIdentities: [],
};

describe("pipelineBootstrapRoute", () => {
	test("returns snapshot from one batch", async () => {
		const db = createMockD1({
			allBySql: [
				{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS },
				{
					match: "FROM developers",
					results: [{ id: "d1", name: "Ada", alias: "ada" }],
				},
				{
					match: "FROM repos",
					results: [
						{
							id: "r1",
							provider: "ado",
							org: "o",
							project: "p",
							name: "n",
							external_id: "g",
							project_external_id: "pg",
							enabled: 1,
						},
					],
				},
			],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/bootstrap");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			settings: { pipelineConfigVersion: number };
			developers: { alias: string }[];
			repos: { externalId: string; projectExternalId: string | null }[];
		};
		expect(body.settings.pipelineConfigVersion).toBe(1);
		expect(body.developers[0]?.alias).toBe("ada");
		expect(body.repos[0]?.externalId).toBe("g");
		expect(body.repos[0]?.projectExternalId).toBe("pg");
	});
});

describe("pipelineIngestRoute", () => {
	test("200 writes activities and scores through the real schema", async () => {
		const sqlite = createSqliteD1();
		seedDevAndRepo(sqlite, {
			developerId: "dev-1",
			alias: "ada",
			repoId: "repo-1",
			org: "acme",
			project: "Alpha",
			repoName: "alpha-repo",
			repoGuid: "11111111-1111-4111-8111-111111111111",
			projectGuid: "22222222-2222-4222-8222-222222222222",
		});

		const app = mount(sqlite.db);
		const res = await app.request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validIngest),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			runId: string;
			finalized: boolean;
			activities: { upserted: number; rejected: number };
			scores: { recomputed: number };
		};
		expect(body.runId).toBe(validIngest.runId);
		expect(body.finalized).toBe(true);
		expect(body.activities.upserted).toBe(1);
		expect(body.activities.rejected).toBe(0);
		expect(body.scores.recomputed).toBe(1);

		const score = sqlite.raw
			.query<{ total: number; day_key: string }, []>(
				"SELECT total, day_key FROM scores",
			)
			.get();
		expect(score?.total).toBe(10);

		const run = sqlite.raw
			.query<{ status: string }, []>("SELECT status FROM ingest_runs")
			.get();
		expect(run?.status).toBe("finalized");
		sqlite.close();
	});

	test("409 on version conflict", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...validIngest, pipelineConfigVersion: 99 }),
		});
		expect(res.status).toBe(409);
	});

	test("400 invalid json", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "not-json",
		});
		expect(res.status).toBe(400);
	});

	test("400 invalid schema body", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const res = await mount(db).request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pipelineConfigVersion: 1 }),
		});
		expect(res.status).toBe(400);
	});
});

describe("pipelineRecomputeCompleteRoute", () => {
	test("ok when cas changes=1", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
			firstBySql: [
				{
					match: "FROM ingest_runs",
					row: {
						status: "finalized",
						mode: "full_rematch",
						config_version: 1,
					},
				},
			],
			batchResults: [
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
			],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/recompute/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pipelineConfigVersion: 1,
				runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
				ok: true,
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { runId: string };
		expect(body.runId).toBe("01JAY7B4HXTMRP0VQZ0FKZH5S8");
	});

	test("409 when cas changes=0", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
			firstBySql: [
				{
					match: "FROM ingest_runs",
					row: {
						status: "finalized",
						mode: "full_rematch",
						config_version: 1,
					},
				},
			],
			batchResults: [
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
			],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/recompute/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pipelineConfigVersion: 1,
				runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
				ok: true,
			}),
		});
		expect(res.status).toBe(409);
	});

	test("400 when ok is not true", async () => {
		const db = createMockD1();
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/recompute/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pipelineConfigVersion: 1,
				runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
				ok: false,
			}),
		});
		expect(res.status).toBe(400);
	});

	test("400 missing runId", async () => {
		const res = await mount(createMockD1()).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pipelineConfigVersion: 1, ok: true }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("400 missing version on complete", async () => {
		const res = await mount(createMockD1()).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ok: true, runId: "x" }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("400 invalid json on complete", async () => {
		const res = await mount(createMockD1()).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{",
			},
		);
		expect(res.status).toBe(400);
	});

	test("400 null body on complete", async () => {
		const res = await mount(createMockD1()).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "null",
			},
		);
		expect(res.status).toBe(400);
	});
});

describe("ingest route status mapping (real schema)", () => {
	function seeded() {
		const sqlite = createSqliteD1();
		seedDevAndRepo(sqlite, {
			developerId: "dev-1",
			alias: "ada",
			repoId: "repo-1",
			org: "acme",
			project: "Alpha",
			repoName: "alpha-repo",
			repoGuid: "11111111-1111-4111-8111-111111111111",
			projectGuid: "22222222-2222-4222-8222-222222222222",
		});
		return sqlite;
	}

	async function post(db: D1Database, body: unknown) {
		return mount(db).request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("422 when the developer does not exist", async () => {
		const sqlite = seeded();
		const bad = structuredClone(validIngest);
		bad.activities[0]!.developerId = "dev-missing";
		const res = await post(sqlite.db, bad);
		expect(res.status).toBe(422);
		sqlite.close();
	});

	test("400 on chunk index skip", async () => {
		const sqlite = seeded();
		await post(sqlite.db, { ...validIngest, isFinalChunk: false });
		const res = await post(sqlite.db, {
			...validIngest,
			chunkIndex: 3,
			isFinalChunk: false,
		});
		expect(res.status).toBe(400);
		sqlite.close();
	});

	test("409 when replaying a chunk index with a different digest", async () => {
		const sqlite = seeded();
		await post(sqlite.db, { ...validIngest, isFinalChunk: false });
		const drifted = structuredClone(validIngest);
		drifted.isFinalChunk = false;
		drifted.activities[0]!.occurredAt = 1720009999;
		const res = await post(sqlite.db, drifted);
		expect(res.status).toBe(409);
		sqlite.close();
	});

	test("recompute complete clears stale after a finalized full_rematch", async () => {
		const sqlite = seeded();
		sqlite.raw
			.query("UPDATE settings SET value = 'true' WHERE key = 'scores_stale'")
			.run();

		const ingested = await post(sqlite.db, validIngest);
		expect(ingested.status).toBe(200);

		const res = await mount(sqlite.db).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId: validIngest.runId,
					pipelineConfigVersion: 1,
					ok: true,
				}),
			},
		);
		expect(res.status).toBe(200);

		const stale = sqlite.raw
			.query<{ value: string }, []>(
				"SELECT value FROM settings WHERE key = 'scores_stale'",
			)
			.get();
		expect(stale?.value).toBe("false");
		sqlite.close();
	});

	test("409 when completing a run that is not full_rematch", async () => {
		const sqlite = seeded();
		await post(sqlite.db, {
			...validIngest,
			runMeta: { ...validIngest.runMeta, mode: "incremental" },
		});

		const res = await mount(sqlite.db).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId: validIngest.runId,
					pipelineConfigVersion: 1,
					ok: true,
				}),
			},
		);
		expect(res.status).toBe(409);
		sqlite.close();
	});

	test("413 when the raw body exceeds the ingest payload cap", async () => {
		const sqlite = seeded();
		const huge = structuredClone(validIngest) as typeof validIngest & {
			activities: { meta?: Record<string, unknown> }[];
		};
		huge.activities[0]!.meta = { blob: "x".repeat(600_000) };

		const res = await post(sqlite.db, huge);
		expect(res.status).toBe(413);
		sqlite.close();
	});

	test("500 when a stored activity has an unusable source_ids_json", async () => {
		const sqlite = seeded();
		await post(sqlite.db, { ...validIngest, isFinalChunk: false });
		sqlite.raw
			.query(`UPDATE activities SET source_ids_json = '"broken"'`)
			.run();

		const second = structuredClone(validIngest);
		second.chunkIndex = 1;
		second.isFinalChunk = false;
		second.activities[0]!.sourceIds.prId = 1002;
		const res = await post(sqlite.db, second);

		expect(res.status).toBe(500);
		sqlite.close();
	});

	test("409 when settings version moves before recompute complete", async () => {
		const sqlite = seeded();
		await post(sqlite.db, validIngest);
		sqlite.raw
			.query(
				"UPDATE settings SET value = '2' WHERE key = 'pipeline_config_version'",
			)
			.run();

		const res = await mount(sqlite.db).request(
			"http://x/api/pipeline/recompute/complete",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId: validIngest.runId,
					pipelineConfigVersion: 1,
					ok: true,
				}),
			},
		);
		expect(res.status).toBe(409);
		sqlite.close();
	});
});
