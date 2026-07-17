import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1 } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import {
	teamsArchiveRoute,
	teamsCreateRoute,
	teamsListRoute,
	teamsPatchRoute,
	teamsRestoreRoute,
} from "./teams.js";

const team = {
	id: "t1",
	name: "Core",
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
	app.get("/api/teams", teamsListRoute);
	app.post("/api/teams", teamsCreateRoute);
	app.patch("/api/teams/:id", teamsPatchRoute);
	app.post("/api/teams/:id/archive", teamsArchiveRoute);
	app.post("/api/teams/:id/restore", teamsRestoreRoute);
	return app;
}

describe("teams routes", () => {
	test("list + create + patch + archive + restore", async () => {
		const db = createMockD1({
			allBySql: [{ match: "FROM teams", results: [team] }],
			firstBySql: [{ match: "FROM teams WHERE id", row: team }],
			runChanges: 1,
		});
		const app = mount(db);
		expect((await app.request("http://x/api/teams")).status).toBe(200);
		expect(
			(
				await app.request("http://x/api/teams", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "Core" }),
				})
			).status,
		).toBe(201);
		expect(
			(
				await app.request("http://x/api/teams", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "null",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/teams/t1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "Core2" }),
				})
			).status,
		).toBe(200);
		expect(
			(await app.request("http://x/api/teams/t1/archive", { method: "POST" }))
				.status,
		).toBe(200);
		expect(
			(await app.request("http://x/api/teams/t1/restore", { method: "POST" }))
				.status,
		).toBe(200);
	});

	test("archive 404", async () => {
		const db = createMockD1({ runChanges: 0 });
		const res = await mount(db).request("http://x/api/teams/x/archive", {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});

	test("create 409 unique", async () => {
		const db = createMockD1({ runError: new Error("unique") });
		const res = await mount(db).request("http://x/api/teams", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "X" }),
		});
		expect(res.status).toBe(409);
	});

	test("patch 404", async () => {
		const db = createMockD1({ runChanges: 0 });
		const res = await mount(db).request("http://x/api/teams/x", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Y" }),
		});
		expect(res.status).toBe(404);
	});

	test("restore 409", async () => {
		const db = createMockD1({ runError: new Error("unique") });
		const res = await mount(db).request("http://x/api/teams/t1/restore", {
			method: "POST",
		});
		expect(res.status).toBe(409);
	});

	test("create missing name", async () => {
		const res = await mount(createMockD1()).request("http://x/api/teams", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("invalid json and patch invalid body", async () => {
		const app = mount(createMockD1());
		expect(
			(
				await app.request("http://x/api/teams", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/teams/t1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/teams/t1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "null",
				})
			).status,
		).toBe(400);
	});

	test("patch 409 and restore 404", async () => {
		expect(
			(
				await mount(createMockD1({ runError: new Error("u") })).request(
					"http://x/api/teams/t1",
					{
						method: "PATCH",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ name: "Z" }),
					},
				)
			).status,
		).toBe(409);
		expect(
			(
				await mount(createMockD1({ runChanges: 0 })).request(
					"http://x/api/teams/t1/restore",
					{ method: "POST" },
				)
			).status,
		).toBe(404);
	});
});
