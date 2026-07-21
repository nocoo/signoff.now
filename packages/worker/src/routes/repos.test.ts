import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMockD1 } from "../test/mock-d1.js";
import type { AppEnv } from "../types.js";
import {
	reposArchiveRoute,
	reposCreateRoute,
	reposListRoute,
	reposPatchRoute,
	reposRestoreRoute,
} from "./repos.js";

const repo = {
	id: "r1",
	provider: "ado",
	org: "o",
	project: "p",
	name: "n",
	remote_url: null as string | null,
	external_id: "guid",
	project_external_id: null as string | null,
	enabled: 1,
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
	app.get("/api/repos", reposListRoute);
	app.post("/api/repos", reposCreateRoute);
	app.patch("/api/repos/:id", reposPatchRoute);
	app.post("/api/repos/:id/archive", reposArchiveRoute);
	app.post("/api/repos/:id/restore", reposRestoreRoute);
	return app;
}

describe("repos routes", () => {
	test("list create patch archive restore", async () => {
		const archived = { ...repo, archived_at: 99 as number | null };
		const db = createMockD1({
			allBySql: [{ match: "FROM repos", results: [repo] }],
			firstBySql: [{ match: "FROM repos WHERE id", row: repo }],
			runChanges: 1,
		});
		const app = mount(db);
		expect((await app.request("http://x/api/repos")).status).toBe(200);
		expect(
			(
				await app.request("http://x/api/repos", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						org: "o",
						project: "p",
						name: "n",
						externalId: "guid",
					}),
				})
			).status,
		).toBe(201);
		expect(
			(
				await app.request("http://x/api/repos", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ org: "o", project: "p", name: "n" }),
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/repos/r1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "n2", externalId: "guid" }),
				})
			).status,
		).toBe(200);
		expect(
			(await app.request("http://x/api/repos/r1/archive", { method: "POST" }))
				.status,
		).toBe(200);

		const restoreDb = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: archived }],
			runChanges: 1,
		});
		expect(
			(
				await mount(restoreDb).request("http://x/api/repos/r1/restore", {
					method: "POST",
				})
			).status,
		).toBe(200);
	});

	test("create 409 patch not found archive 404", async () => {
		expect(
			(
				await mount(createMockD1({ runError: new Error("u") })).request(
					"http://x/api/repos",
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							org: "o",
							project: "p",
							name: "n",
							externalId: "g",
						}),
					},
				)
			).status,
		).toBe(409);
		expect(
			(
				await mount(
					createMockD1({
						firstBySql: [{ match: "FROM repos WHERE id", row: null }],
					}),
				).request("http://x/api/repos/x", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "n", externalId: "g" }),
				})
			).status,
		).toBe(404);
		expect(
			(
				await mount(createMockD1({ runChanges: 0 })).request(
					"http://x/api/repos/x/archive",
					{ method: "POST" },
				)
			).status,
		).toBe(404);
	});

	test("invalid json body", async () => {
		expect(
			(
				await mount(createMockD1()).request("http://x/api/repos", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
	});

	test("patch invalid body and 409", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: repo }],
			runError: new Error("u"),
		});
		const app = mount(db);
		expect(
			(
				await app.request("http://x/api/repos/r1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "{",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/repos/r1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: "null",
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("http://x/api/repos/r1", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "n2", externalId: "guid" }),
				})
			).status,
		).toBe(409);
	});

	test("restore 404 and 409", async () => {
		expect(
			(
				await mount(
					createMockD1({
						firstBySql: [{ match: "FROM repos WHERE id", row: null }],
					}),
				).request("http://x/api/repos/r1/restore", { method: "POST" })
			).status,
		).toBe(404);
		const archived = { ...repo, archived_at: 99 as number | null };
		expect(
			(
				await mount(
					createMockD1({
						firstBySql: [{ match: "FROM repos WHERE id", row: archived }],
						runError: new Error("u"),
					}),
				).request("http://x/api/repos/r1/restore", { method: "POST" })
			).status,
		).toBe(409);
	});

	test("project GUID conflict → 409 on create (atomic WHERE)", async () => {
		const db = createMockD1({ runChanges: 0 });
		const res = await mount(db).request("http://x/api/repos", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				org: "o",
				project: "p",
				name: "n2",
				externalId: "guid2",
				projectExternalId: "other-pg",
			}),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Project GUID conflict");
	});

	test("create with projectExternalId succeeds when consistent", async () => {
		const created = {
			...repo,
			project_external_id: "pg-1",
		};
		const db = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: created }],
			runChanges: 1,
		});
		const res = await mount(db).request("http://x/api/repos", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				org: "o",
				project: "p",
				name: "n",
				externalId: "guid",
				projectExternalId: "pg-1",
			}),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { projectExternalId: string };
		expect(body.projectExternalId).toBe("pg-1");
	});

	test("patch project GUID conflict → 409", async () => {
		const db = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: repo }],
			runChanges: 0,
		});
		const res = await mount(db).request("http://x/api/repos/r1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				externalId: "guid",
				projectExternalId: "other-pg",
			}),
		});
		expect(res.status).toBe(409);
	});

	test("restore conflicts when GUID gate fails (atomic)", async () => {
		const archived = {
			...repo,
			id: "r-old",
			project_external_id: "pg-old",
			archived_at: 99,
		};
		const db = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: archived }],
			runChanges: 0,
		});
		const res = await mount(db).request("http://x/api/repos/r-old/restore", {
			method: "POST",
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Project GUID conflict");
	});

	test("rejects non-string projectExternalId with 400", async () => {
		const res = await mount(createMockD1()).request("http://x/api/repos", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				org: "o",
				project: "p",
				name: "n",
				externalId: "guid",
				projectExternalId: 123,
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/string or null/);
	});

	test("patch rejects non-string projectExternalId without clearing", async () => {
		const withGuid = { ...repo, project_external_id: "pg-keep" };
		const db = createMockD1({
			firstBySql: [{ match: "FROM repos WHERE id", row: withGuid }],
		});
		const res = await mount(db).request("http://x/api/repos/r1", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ projectExternalId: 123, externalId: "guid" }),
		});
		expect(res.status).toBe(400);
	});
});
