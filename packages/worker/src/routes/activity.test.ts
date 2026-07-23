import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1, DEFAULT_SETTINGS_ROWS } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import { activityHeatmapRoute, activityTimelineRoute } from "./activity.js";

function mount(db: D1Database) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: db };
		return next();
	});
	app.get("/api/activity/heatmap", activityHeatmapRoute);
	app.get("/api/activity/timeline", activityTimelineRoute);
	return app;
}

describe("activityHeatmapRoute", () => {
	test("400 on bad query", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const res = await mount(db).request("http://x/api/activity/heatmap");
		expect(res.status).toBe(400);
	});

	test("stale returns empty rows", async () => {
		const rows = DEFAULT_SETTINGS_ROWS.map((r) =>
			r.key === "scores_stale" ? { ...r, value: "true" } : r,
		);
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: rows }],
		});
		const res = await mount(db).request(
			"http://x/api/activity/heatmap?devs=d1&from=2026-01-01&to=2026-01-07",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			scoresStale: boolean;
			rows: unknown[];
		};
		expect(body.scoresStale).toBe(true);
		expect(body.rows).toEqual([]);
	});

	test("returns score rows", async () => {
		const db = createMockD1({
			allBySql: [
				{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS },
				{
					match: "FROM scores",
					results: [
						{
							developer_id: "d1",
							day_key: "2026-01-01",
							total: 10,
							activity_count: 1,
						},
					],
				},
			],
		});
		const res = await mount(db).request(
			"http://x/api/activity/heatmap?devs=d1&from=2026-01-01&to=2026-01-07",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			rows: { total: number }[];
			scoresStale: boolean;
		};
		expect(body.scoresStale).toBe(false);
		expect(body.rows[0]?.total).toBe(10);
	});
});

describe("activityTimelineRoute", () => {
	test("stale empty items", async () => {
		const rows = DEFAULT_SETTINGS_ROWS.map((r) =>
			r.key === "scores_stale" ? { ...r, value: "true" } : r,
		);
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: rows }],
		});
		const res = await mount(db).request(
			"http://x/api/activity/timeline?dev=d1&from=2026-01-01&to=2026-01-07",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; nextCursor: null };
		expect(body.items).toEqual([]);
		expect(body.nextCursor).toBeNull();
	});

	test("400 on bad query", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const res = await mount(db).request("http://x/api/activity/timeline");
		expect(res.status).toBe(400);
	});

	test("returns items", async () => {
		const db = createMockD1({
			allBySql: [
				{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS },
				{
					match: "FROM activities",
					results: [
						{
							id: "a1",
							type: "pr.merged",
							occurred_at: 1720000123,
							day_key: "2026-07-01",
							org: "acme",
							project: "Alpha",
							repo_id: "r1",
							meta_json: null,
						},
					],
				},
			],
		});
		const res = await mount(db).request(
			"http://x/api/activity/timeline?dev=d1&from=2026-01-01&to=2026-01-31",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: { id: string }[] };
		expect(body.items[0]?.id).toBe("a1");
	});

	test("invalid cursor", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const res = await mount(db).request(
			"http://x/api/activity/timeline?dev=d1&from=2026-01-01&to=2026-01-07&cursor=%%%",
		);
		expect(res.status).toBe(400);
	});
});
