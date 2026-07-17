import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { DEFAULT_ACTIVITY_WEIGHTS } from "../lib/settings.js";
import { settingsPutCasOutcome } from "../lib/settings-cas.js";
import { createMockD1, DEFAULT_SETTINGS_ROWS } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import {
	loadSettings,
	settingsGetRoute,
	settingsPutRoute,
} from "./settings.js";

function mount(db: D1Database) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: db };
		return next();
	});
	app.get("/api/settings", settingsGetRoute);
	app.put("/api/settings", settingsPutRoute);
	return app;
}

describe("settingsGetRoute", () => {
	test("returns AppSettings", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const res = await mount(db).request("http://x/api/settings");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { timezone: string };
		expect(body.timezone).toBe("UTC");
	});
});

describe("settingsPutRoute", () => {
	const validBody = {
		expectedVersion: 1,
		timezone: "Asia/Shanghai",
		emailSuffixes: ["example.com"],
		activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
	};

	test("none when unchanged", async () => {
		const rows = DEFAULT_SETTINGS_ROWS.map((r) =>
			r.key === "timezone" ? { ...r, value: '"Asia/Shanghai"' } : r,
		);
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: rows }],
		});
		const res = await mount(db).request("http://x/api/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validBody),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { recomputeKind: string };
		expect(body.recomputeKind).toBe("none");
	});

	test("409 when cas bump changes !== 1", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
			batchResults: Array.from({ length: 6 }, () => ({
				success: true,
				meta: { changes: 0 },
			})) as D1Result[],
		});
		const res = await mount(db).request("http://x/api/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validBody),
		});
		expect(res.status).toBe(409);
	});

	test("200 when cas bump changes === 1", async () => {
		const afterRows = DEFAULT_SETTINGS_ROWS.map((r) => {
			if (r.key === "pipeline_config_version") {
				return { ...r, value: "2" };
			}
			if (r.key === "timezone") {
				return { ...r, value: '"Asia/Shanghai"' };
			}
			if (r.key === "scores_stale") {
				return { ...r, value: "true" };
			}
			return r;
		});
		let loads = 0;
		const db = createMockD1({
			batchResults: Array.from({ length: 6 }, () => ({
				success: true,
				meta: { changes: 1 },
			})) as D1Result[],
		});
		const basePrepare = db.prepare.bind(db);
		db.prepare = ((sql: string) => {
			const stmt = basePrepare(sql) as {
				bind: (...a: unknown[]) => unknown;
				all: () => Promise<D1Result>;
			};
			const origBind = stmt.bind.bind(stmt);
			stmt.bind = (...a: unknown[]) => {
				const bound = origBind(...a) as typeof stmt;
				bound.all = async () => {
					loads += 1;
					return {
						success: true,
						results: loads === 1 ? DEFAULT_SETTINGS_ROWS : afterRows,
						meta: { changes: 0 },
					} as D1Result;
				};
				return bound;
			};
			stmt.all = async () => {
				loads += 1;
				return {
					success: true,
					results: loads === 1 ? DEFAULT_SETTINGS_ROWS : afterRows,
					meta: { changes: 0 },
				} as D1Result;
			};
			return stmt;
		}) as typeof db.prepare;

		const res = await mount(db).request("http://x/api/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validBody),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			recomputeRequired: boolean;
			settings: { pipelineConfigVersion: number };
		};
		expect(body.recomputeRequired).toBe(true);
		expect(body.settings.pipelineConfigVersion).toBe(2);
	});

	test("400 invalid json / payload", async () => {
		const db = createMockD1();
		const app = mount(db);
		expect(
			(
				await app.request("http://x/api/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: "not-json{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: "null",
				})
			).status,
		).toBe(400);
	});

	test("409 unchanged with wrong expectedVersion", async () => {
		const rows = DEFAULT_SETTINGS_ROWS.map((r) =>
			r.key === "timezone" ? { ...r, value: '"Asia/Shanghai"' } : r,
		);
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: rows }],
		});
		const res = await mount(db).request("http://x/api/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...validBody, expectedVersion: 9 }),
		});
		expect(res.status).toBe(409);
	});
});

describe("loadSettings", () => {
	test("parses rows", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS }],
		});
		const s = await loadSettings(db);
		expect(s.pipelineConfigVersion).toBe(1);
		expect(settingsPutCasOutcome(1)).toBe("ok");
	});
});
