import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type Project,
	projectSchema,
	scanRunSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { Hono } from "hono";
import app from "../index.js";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1.js";
import type { AppEnv, Bindings } from "../types.js";
import { projectsScanRoute } from "./workbench.js";

let sqlite: SqliteD1;
let env: Bindings;
const body = {
	provider: "ado",
	name: "Test Platform",
	organization: "northstar",
	projectKey: "Platform",
	description: "Shared services",
	owner: "Maya Chen",
	enabled: true,
};
beforeEach(() => {
	sqlite = createSqliteD1();
	env = { DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" };
});
afterEach(() => sqlite.close());

const request = (
	path: string,
	method = "GET",
	payload?: unknown,
	overrides: Partial<Bindings> = {},
) =>
	app.request(
		`http://localhost${path}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
		},
		{ ...env, ...overrides },
	);
async function create(extra: Record<string, unknown> = {}): Promise<Project> {
	const response = await request("/api/projects", "POST", {
		...body,
		...extra,
	});
	expect(response.status).toBe(201);
	return projectSchema.parse(await response.json());
}
async function snapshot() {
	const response = await request("/api/workbench");
	expect(response.headers.get("cache-control")).toBe("no-store");
	return workbenchSchema.parse(await response.json());
}
async function scannedProject() {
	const project = await create();
	const response = await request(`/api/projects/${project.id}/scan`, "POST", {
		revision: project.revision,
	});
	expect(response.status).toBe(200);
	expect(scanRunSchema.parse(await response.json()).pullRequestCount).toBe(6);
	return (await snapshot()).projects[0]!;
}

describe("project CRUD with actual SQLite", () => {
	test("persists edits, scans, source changes, and deletion through the real API", async () => {
		expect((await snapshot()).projects).toEqual([]);
		const project = await scannedProject();
		const initial = await snapshot();
		expect(initial.demoMode).toBe(true);
		expect(initial.pullRequests).toHaveLength(6);
		let response = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			name: "Renamed Platform",
			description: "Updated description",
		});
		expect(response.status).toBe(200);
		let updated = projectSchema.parse(await response.json());
		expect(updated.owner).toBe(project.owner);
		expect((await snapshot()).pullRequests).toEqual(initial.pullRequests);
		response = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: updated.revision,
			projectKey: "Another Project",
		});
		expect(response.status).toBe(200);
		updated = projectSchema.parse(await response.json());
		expect(updated.lastScannedAt).toBeNull();
		expect(updated.scanState).toBe("never");
		expect((await snapshot()).pullRequests).toEqual([]);
		expect((await snapshot()).scans).toEqual([]);
		await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: updated.revision,
		});
		updated = (await snapshot()).projects[0]!;
		response = await request(`/api/projects/${project.id}`, "DELETE", {
			revision: updated.revision,
		});
		expect(response.status).toBe(200);
		const empty = await snapshot();
		expect(empty.projects).toEqual([]);
		expect(empty.pullRequests).toEqual([]);
		expect(empty.scans).toEqual([]);
	});
	test("rejects duplicate identities case-insensitively and rolls back source-change invalidation", async () => {
		const project = await scannedProject();
		expect(
			(
				await request("/api/projects", "POST", {
					...body,
					organization: "NORTHSTAR",
					projectKey: "platform",
				})
			).status,
		).toBe(409);
		await create({ projectKey: "Other" });
		const before = await snapshot();
		const response = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			projectKey: "Other",
		});
		expect(response.status).toBe(409);
		expect((await snapshot()).pullRequests).toEqual(before.pullRequests);
		expect((await snapshot()).scans).toEqual(before.scans);
	});
	test("CAS rejects stale forms without deleting a newer snapshot", async () => {
		const project = await scannedProject();
		const before = await snapshot();
		sqlite.beforeBatch("DELETE FROM pull_requests", () => {
			sqlite.raw
				.query(
					"UPDATE projects SET name = 'Concurrent edit', revision = revision + 1 WHERE id = ?",
				)
				.run(project.id);
		});
		const response = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			projectKey: "Changed source",
		});
		expect(response.status).toBe(409);
		const after = await snapshot();
		expect(after.projects[0]!.name).toBe("Concurrent edit");
		expect(after.pullRequests).toEqual(before.pullRequests);
		expect(after.scans).toEqual(before.scans);
		expect(
			(
				await request(`/api/projects/${project.id}`, "DELETE", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
		expect(
			(
				await request(`/api/projects/${project.id}`, "PATCH", {
					revision: project.revision,
					name: "Late edit",
				})
			).status,
		).toBe(409);
	});
	test("requires valid bounded bodies and writable ADO fields", async () => {
		for (const invalid of [
			{},
			{ ...body, provider: "github" },
			{ ...body, source: "demo" },
			{ ...body, name: " " },
			{ ...body, owner: 4 },
		]) {
			expect((await request("/api/projects", "POST", invalid)).status).toBe(
				400,
			);
		}
		expect(
			(
				await request("/api/projects", "POST", {
					...body,
					description: "x".repeat(9000),
				})
			).status,
		).toBe(413);
		const malformed = await app.request(
			"http://localhost/api/projects",
			{ method: "POST", headers: { host: "localhost" }, body: "{" },
			env,
		);
		expect(malformed.status).toBe(400);
		for (const [path, method, payload] of [
			["/api/projects/missing", "PATCH", { revision: 1, name: "Missing" }],
			["/api/projects/missing/scan", "POST", { revision: 1 }],
		] as const)
			expect((await request(path, method, payload)).status).toBe(404);
		for (const method of ["PATCH", "DELETE"]) {
			expect((await request("/api/projects/missing", method, {})).status).toBe(
				400,
			);
			expect(
				(
					await request("/api/projects/missing", method, {
						revision: 1,
						extra: "x".repeat(9000),
					})
				).status,
			).toBe(413);
			expect((await request("/api/projects/missing", method)).status).toBe(400);
		}
		expect(
			(await request("/api/projects/missing", "PATCH", { revision: 1 })).status,
		).toBe(400);
		expect(
			(await request("/api/projects/missing", "DELETE", { revision: 1 }))
				.status,
		).toBe(409);
	});
});

describe("local-only demo scanning", () => {
	test("advances persisted stages and records each scan", async () => {
		const project = await scannedProject();
		const before = await snapshot();
		const response = await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		expect(response.status).toBe(200);
		expect(
			scanRunSchema.parse(await response.json()).advancedStages,
		).toBeGreaterThan(0);
		const after = await snapshot();
		expect(after.scans).toHaveLength(2);
		expect(after.projects[0]!.revision).toBe(project.revision + 1);
		expect(after.pullRequests).not.toEqual(before.pullRequests);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
	});
	test("rejects scans without explicit local mode and never touches CLI data", async () => {
		const project = await scannedProject();
		const before = await snapshot();
		expect(
			(
				await request(
					`/api/projects/${project.id}/scan`,
					"POST",
					{ revision: project.revision },
					{ SIGNOFF_DEMO_MODE: undefined },
				)
			).status,
		).toBe(403);
		const isolated = new Hono<AppEnv>().post(
			"/api/projects/:id/scan",
			projectsScanRoute,
		);
		expect(
			(
				await isolated.request(
					`https://signoff.hexly.ai/api/projects/${project.id}/scan`,
					{ method: "POST", headers: { host: "signoff.hexly.ai" } },
					env,
				)
			).status,
		).toBe(403);
		sqlite.raw
			.query("UPDATE projects SET source = 'cli' WHERE id = ?")
			.run(project.id);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
		expect((await snapshot()).pullRequests).toEqual(before.pullRequests);
		const created = await request(
			"/api/projects",
			"POST",
			{ ...body, projectKey: "CLI Project" },
			{ SIGNOFF_DEMO_MODE: undefined },
		);
		expect(projectSchema.parse(await created.json()).source).toBe("cli");
		expect(
			(await request(`/api/projects/${project.id}/scan`, "POST", {})).status,
		).toBe(400);
		expect(
			(await request(`/api/projects/${project.id}/scan`, "POST")).status,
		).toBe(400);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: 1,
					extra: "x".repeat(9000),
				})
			).status,
		).toBe(413);
	});
	test("keeps paused projects unchanged", async () => {
		const project = await create({ enabled: false });
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
		expect((await snapshot()).pullRequests).toEqual([]);
	});
	test.each([
		"edit",
		"delete",
		"cli",
	])("does not write snapshots after a concurrent %s", async (change) => {
		const project = await scannedProject();
		const before = await snapshot();
		sqlite.beforeBatch("INSERT INTO pull_requests", () => {
			if (change === "delete")
				sqlite.raw.query("DELETE FROM projects WHERE id = ?").run(project.id);
			else
				sqlite.raw
					.query(
						`UPDATE projects SET revision = revision + 1${change === "cli" ? ", source = 'cli'" : ""} WHERE id = ?`,
					)
					.run(project.id);
		});
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
		const after = await snapshot();
		expect(after.pullRequests).toEqual(
			change === "delete" ? [] : before.pullRequests,
		);
		expect(after.scans).toEqual(change === "delete" ? [] : before.scans);
	});
	test("rejects all workbench routes on the pipeline-token host", async () => {
		for (const [method, path] of [
			["GET", "/api/workbench"],
			["POST", "/api/projects"],
			["PATCH", "/api/projects/p1"],
			["DELETE", "/api/projects/p1"],
			["POST", "/api/projects/p1/scan"],
		]) {
			const response = await app.request(
				`https://signoff-ingest.hexly.ai${path}`,
				{
					method,
					headers: {
						host: "signoff-ingest.hexly.ai",
						authorization: "Bearer test-pipeline-token",
					},
				},
				{ ...env, SIGNOFF_PIPELINE_WRITE_TOKEN: "test-pipeline-token" },
			);
			expect(response.status).toBe(403);
		}
		expect((await snapshot()).projects).toEqual([]);
	});
});
