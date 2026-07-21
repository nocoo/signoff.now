import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1, DEFAULT_SETTINGS_ROWS } from "../test/mock-d1.js";
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
	test("501 never reports accepted persistence", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const app = mount(db);
		const res = await app.request("http://x/api/pipeline/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validIngest),
		});
		expect(res.status).toBe(501);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBe("Not Implemented");
		expect(body).not.toHaveProperty("accepted");
		expect(body).not.toHaveProperty("ok", true);
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
