import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1 } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import {
	developersArchiveRoute,
	developersCreateRoute,
	developersListRoute,
	developersPatchRoute,
	developersRestoreRoute,
} from "./developers.js";

const sampleDev = {
	id: "id-1",
	name: "Ada",
	alias: "ada",
	created_at: 1,
	updated_at: 1,
	archived_at: null as number | null,
};

function mount(db: D1Database) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: db };
		return next();
	});
	app.get("/api/developers", developersListRoute);
	app.post("/api/developers", developersCreateRoute);
	app.patch("/api/developers/:id", developersPatchRoute);
	app.post("/api/developers/:id/archive", developersArchiveRoute);
	app.post("/api/developers/:id/restore", developersRestoreRoute);
	return app;
}

describe("developers routes", () => {
	test("list", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM developers", results: [sampleDev] }],
		});
		const res = await mount(db).request("http://x/api/developers");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: { alias: string }[] };
		expect(body.items[0]?.alias).toBe("ada");
	});

	test("create 201", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
		});
		const res = await mount(db).request("http://x/api/developers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Ada", alias: "ada" }),
		});
		expect(res.status).toBe(201);
	});

	test("create 400 invalid body", async () => {
		const res = await mount(createMockD1()).request("http://x/api/developers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "null",
		});
		expect(res.status).toBe(400);
	});

	test("create 409 on unique conflict", async () => {
		const db = createMockD1({ batchError: new Error("unique") });
		const res = await mount(db).request("http://x/api/developers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Ada", alias: "ada" }),
		});
		expect(res.status).toBe(409);
	});

	test("patch not found", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: null }],
		});
		const res = await mount(db).request("http://x/api/developers/x", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "B" }),
		});
		expect(res.status).toBe(404);
	});

	test("patch name only", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
			runChanges: 1,
		});
		const res = await mount(db).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Ada Lovelace" }),
		});
		expect(res.status).toBe(200);
	});

	test("archive 404 when no row", async () => {
		const db = createMockD1({
			batchResults: [
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
			],
		});
		const res = await mount(db).request(
			"http://x/api/developers/missing/archive",
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
	});

	test("archive ok", async () => {
		const db = createMockD1({
			batchResults: [
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
			],
		});
		const res = await mount(db).request(
			"http://x/api/developers/id-1/archive",
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
	});

	test("restore ok", async () => {
		const db = createMockD1({
			batchResults: [
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
			],
		});
		const res = await mount(db).request(
			"http://x/api/developers/id-1/restore",
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
	});

	test("create missing name", async () => {
		const res = await mount(createMockD1()).request("http://x/api/developers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ alias: "x" }),
		});
		expect(res.status).toBe(400);
	});

	test("patch alias change uses batch", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
			batchResults: [
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
				{ success: true, meta: { changes: 1 } } as D1Result,
			],
		});
		const res = await mount(db).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ alias: "ada2" }),
		});
		expect(res.status).toBe(200);
	});

	test("patch invalid body", async () => {
		const res = await mount(
			createMockD1({
				firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
			}),
		).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: "null",
		});
		expect(res.status).toBe(400);
	});

	test("restore conflict", async () => {
		const db = createMockD1({ batchError: new Error("unique") });
		const res = await mount(db).request(
			"http://x/api/developers/id-1/restore",
			{ method: "POST" },
		);
		expect(res.status).toBe(409);
	});

	test("list includeArchived", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM developers", results: [sampleDev] }],
		});
		const res = await mount(db).request(
			"http://x/api/developers?includeArchived=1",
		);
		expect(res.status).toBe(200);
	});

	test("create invalid json", async () => {
		const res = await mount(createMockD1()).request("http://x/api/developers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		expect(res.status).toBe(400);
	});

	test("patch invalid json and invalid alias", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
		});
		const app = mount(db);
		expect(
			(
				await app.request("http://x/api/developers/id-1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/developers/id-1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ alias: "bad@x" }),
				})
			).status,
		).toBe(400);
	});

	test("patch name with zero changes", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
			runChanges: 0,
		});
		const res = await mount(db).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Ada" }),
		});
		expect(res.status).toBe(404);
	});

	test("patch alias conflict", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM developers WHERE id", row: sampleDev }],
			batchError: new Error("unique"),
		});
		const res = await mount(db).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ alias: "other" }),
		});
		expect(res.status).toBe(409);
	});

	test("patch after update returns not found if reloaded archived", async () => {
		const archived = { ...sampleDev, archived_at: 9 };
		let n = 0;
		const db = createMockD1({ runChanges: 1 });
		const base = db.prepare.bind(db);
		db.prepare = ((sql: string) => {
			const stmt = base(sql) as {
				bind: (...a: unknown[]) => {
					first: () => Promise<unknown>;
					run: () => Promise<D1Result>;
				};
			};
			const origBind = stmt.bind.bind(stmt);
			stmt.bind = (...a: unknown[]) => {
				const b = origBind(...a);
				b.first = async () => {
					n += 1;
					return n === 1 ? sampleDev : archived;
				};
				b.run = async () =>
					({ success: true, meta: { changes: 1 } }) as D1Result;
				return b;
			};
			return stmt;
		}) as typeof db.prepare;
		const res = await mount(db).request("http://x/api/developers/id-1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "X" }),
		});
		expect(res.status).toBe(404);
	});

	test("archive/restore missing id via direct call", async () => {
		const json = (body: unknown, status = 200) =>
			new Response(JSON.stringify(body), { status });
		const c = {
			req: { param: () => undefined },
			env: { DB: createMockD1() },
			json,
		};
		// @ts-expect-error minimal context
		const a = await developersArchiveRoute(c);
		expect(a.status).toBe(400);
		// @ts-expect-error minimal context
		const r = await developersRestoreRoute(c);
		expect(r.status).toBe(400);
	});

	test("restore 404", async () => {
		const db = createMockD1({
			batchResults: [
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
				{ success: true, meta: { changes: 0 } } as D1Result,
			],
		});
		const res = await mount(db).request(
			"http://x/api/developers/id-1/restore",
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
	});
});
