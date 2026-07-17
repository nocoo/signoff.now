import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1 } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import {
	tagsArchiveRoute,
	tagsCreateRoute,
	tagsListRoute,
	tagsPatchRoute,
	tagsRestoreRoute,
} from "./tags.js";

const tag = {
	id: "g1",
	name: "fe",
	color: "#3B82F6",
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
	app.get("/api/tags", tagsListRoute);
	app.post("/api/tags", tagsCreateRoute);
	app.patch("/api/tags/:id", tagsPatchRoute);
	app.post("/api/tags/:id/archive", tagsArchiveRoute);
	app.post("/api/tags/:id/restore", tagsRestoreRoute);
	return app;
}

describe("tags routes", () => {
	test("crud happy paths + invalid body", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM tags", results: [tag] }],
			firstBySql: [{ match: "FROM tags WHERE id", row: tag }],
			runChanges: 1,
		});
		const app = mount(db);
		expect((await app.request("http://x/api/tags")).status).toBe(200);
		expect(
			(
				await app.request("http://x/api/tags", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "fe", color: "#3B82F6" }),
				})
			).status,
		).toBe(201);
		expect(
			(
				await app.request("http://x/api/tags", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "[]",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/tags/g1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "frontend" }),
				})
			).status,
		).toBe(200);
		expect(
			(await app.request("http://x/api/tags/g1/archive", { method: "POST" }))
				.status,
		).toBe(200);
		expect(
			(await app.request("http://x/api/tags/g1/restore", { method: "POST" }))
				.status,
		).toBe(200);
	});

	test("create 409 and patch not found", async () => {
		const dbConflict = createMockD1({ runError: new Error("unique") });
		expect(
			(
				await mount(dbConflict).request("http://x/api/tags", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "x", color: "#FFFFFF" }),
				})
			).status,
		).toBe(409);

		const dbMissing = createMockD1({
			firstBySql: [{ match: "FROM tags WHERE id", row: null }],
		});
		expect(
			(
				await mount(dbMissing).request("http://x/api/tags/x", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "y" }),
				})
			).status,
		).toBe(404);
	});

	test("archive 404 restore 409", async () => {
		expect(
			(
				await mount(createMockD1({ runChanges: 0 })).request(
					"http://x/api/tags/x/archive",
					{ method: "POST" },
				)
			).status,
		).toBe(404);
		expect(
			(
				await mount(createMockD1({ runError: new Error("u") })).request(
					"http://x/api/tags/x/restore",
					{ method: "POST" },
				)
			).status,
		).toBe(409);
	});

	test("create invalid json and missing name", async () => {
		const app = mount(createMockD1());
		expect(
			(
				await app.request("http://x/api/tags", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/tags", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ color: "#FFFFFF" }),
				})
			).status,
		).toBe(400);
	});

	test("patch invalid json body and patch 409", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM tags WHERE id", row: tag }],
			runError: new Error("u"),
		});
		const app = mount(db);
		expect(
			(
				await app.request("http://x/api/tags/g1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/tags/g1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "z" }),
				})
			).status,
		).toBe(409);
	});

	test("restore 404", async () => {
		expect(
			(
				await mount(createMockD1({ runChanges: 0 })).request(
					"http://x/api/tags/x/restore",
					{ method: "POST" },
				)
			).status,
		).toBe(404);
	});
});
