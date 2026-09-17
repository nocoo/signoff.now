import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	collectionJobSchema,
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
async function insertDemoProject(
	extra: Record<string, unknown> = {},
): Promise<Project> {
	const id = crypto.randomUUID();
	const timestamp = Math.floor(Date.now() / 1000);
	sqlite.raw
		.query(
			`INSERT INTO projects (id, provider, name, organization, project_key, description, owner, enabled, source, revision, created_at, updated_at)
			 VALUES (?, 'ado', ?, ?, ?, ?, ?, ?, 'demo', 1, ?, ?)`,
		)
		.run(
			id,
			body.name,
			String(extra.organization ?? body.organization),
			String(extra.projectKey ?? body.projectKey),
			body.description,
			body.owner,
			extra.enabled === false ? 0 : 1,
			timestamp,
			timestamp,
		);
	const project = (await snapshot()).projects.find((row) => row.id === id);
	expect(project).toBeDefined();
	return project!;
}
async function scannedProject() {
	const project = await insertDemoProject();
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
	test("creates CLI projects even in demo mode and stores repository scope", async () => {
		const project = await create({
			repositories: ["api-gateway", "platform-sdk"],
		});
		expect(project.source).toBe("cli");
		expect(project.repositories).toEqual(["api-gateway", "platform-sdk"]);
		const board = await snapshot();
		expect(board.collector).toBeNull();
		expect(board.collectionJobs).toEqual([]);
		expect(board.projects[0]?.source).toBe("cli");
		expect(board.projects[0]?.repositories).toEqual([
			"api-gateway",
			"platform-sdk",
		]);
	});
	test("scope edits clear snapshots and history using the old revision", async () => {
		const project = await create({ repositories: ["api-gateway"] });
		const pull = {
			id: "ado:scope:repo:1",
			projectId: project.id,
			externalId: "1",
			number: 1,
			repository: { id: "repo", name: "api-gateway" },
			title: "Scope fixture",
			description: "",
			author: { id: "maya", name: "Maya Chen" },
			sourceBranch: "feature/scope",
			targetBranch: "main",
			state: "open",
			draft: false,
			mergeable: "clear",
			coverage: "complete",
			createdAt: 10,
			updatedAt: 20,
			observedAt: 30,
			requiredApprovals: 0,
			reviewers: [],
			policies: [],
			builds: [],
			labels: [],
			filesChanged: null,
			additions: null,
			deletions: null,
			comments: null,
			activity: [],
		};
		sqlite.raw
			.query(
				`INSERT INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot)
				 VALUES (?, ?, 'repo', '1', 'open', 20, ?)`,
			)
			.run(pull.id, project.id, JSON.stringify(pull));
		sqlite.raw
			.query(
				`INSERT INTO scan_runs (id, project_id, source, state, started_at, completed_at, pull_request_count, advanced_stages, message)
				 VALUES (?, ?, 'cli', 'complete', 20, 20, 1, 0, 'prior')`,
			)
			.run(crypto.randomUUID(), project.id);
		sqlite.raw
			.query(
				`INSERT INTO collection_jobs (id, project_id, revision, state, requested_at, updated_at, completed_pulls, message)
				 VALUES (?, ?, ?, 'queued', 20, 20, 0, 'waiting')`,
			)
			.run(crypto.randomUUID(), project.id, project.revision);
		const renamed = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			name: "Still scoped",
		});
		expect(renamed.status).toBe(200);
		expect((await snapshot()).pullRequests).toHaveLength(1);
		const scoped = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: projectSchema.parse(await renamed.json()).revision,
			repositories: ["platform-sdk"],
		});
		expect(scoped.status).toBe(200);
		const after = await snapshot();
		expect(after.projects[0]?.repositories).toEqual(["platform-sdk"]);
		expect(after.pullRequests).toEqual([]);
		expect(after.scans).toEqual([]);
		expect(
			after.collectionJobs?.filter((job) =>
				["queued", "running", "auth_required"].includes(job.state),
			),
		).toEqual([]);
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
	test("enqueues one CLI collection job per revision and returns it again", async () => {
		const project = await create();
		expect(project.source).toBe("cli");
		const first = await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		expect(first.status).toBe(200);
		const job = collectionJobSchema.parse(await first.json());
		expect(job.state).toBe("queued");
		expect(job.projectId).toBe(project.id);
		expect(job.revision).toBe(project.revision);
		const again = await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		expect(again.status).toBe(200);
		expect(collectionJobSchema.parse(await again.json()).id).toBe(job.id);
		const paused = await create({
			projectKey: "Paused",
			enabled: false,
		});
		expect(
			(
				await request(`/api/projects/${paused.id}/scan`, "POST", {
					revision: paused.revision,
				})
			).status,
		).toBe(409);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision + 1,
				})
			).status,
		).toBe(409);
		const board = await snapshot();
		expect(board.collectionJobs).toHaveLength(1);
		expect(board.collectionJobs?.[0]?.id).toBe(job.id);
		expect(JSON.stringify(board)).not.toContain("leaseToken");
		expect(JSON.stringify(board)).not.toContain("lease_token");
	});
	test("CLI scan fails closed when the project changes during enqueue", async () => {
		const project = await create({ projectKey: "StaleEnqueue" });
		sqlite.beforeBatch("INSERT INTO collection_jobs", () => {
			sqlite.raw
				.query("UPDATE projects SET revision = revision + 1 WHERE id = ?")
				.run(project.id);
		});
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
	});
	test("returns the competing CLI job when insert loses the unique slot", async () => {
		const project = await create({ projectKey: "Race" });
		const competing = crypto.randomUUID();
		const timestamp = Math.floor(Date.now() / 1000);
		sqlite.beforeBatch("INSERT INTO collection_jobs", () => {
			sqlite.raw
				.query(
					`INSERT INTO collection_jobs (id, project_id, revision, state, requested_at, updated_at, completed_pulls, message)
					 VALUES (?, ?, ?, 'queued', ?, ?, 0, 'waiting')`,
				)
				.run(competing, project.id, project.revision, timestamp, timestamp);
		});
		const response = await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		expect(response.status).toBe(200);
		expect(collectionJobSchema.parse(await response.json()).id).toBe(competing);
	});
	test("refuses demo scans that already exceed the sample cap", async () => {
		const project = await insertDemoProject({ projectKey: "Overflow" });
		for (let index = 0; index < 41; index++) {
			const pull = {
				id: `${project.id}-pr-${index}`,
				projectId: project.id,
				externalId: String(index + 1),
				number: index + 1,
				repository: { id: "repo", name: "services" },
				title: "Overflow",
				description: "",
				author: { id: "maya", name: "Maya Chen" },
				sourceBranch: "feature/overflow",
				targetBranch: "main",
				state: "open",
				draft: false,
				mergeable: "clear",
				coverage: "complete",
				createdAt: 10,
				updatedAt: 20,
				observedAt: 30,
				requiredApprovals: 0,
				reviewers: [],
				policies: [],
				builds: [],
				labels: [],
				filesChanged: null,
				additions: null,
				deletions: null,
				comments: null,
				activity: [],
			};
			sqlite.raw
				.query(
					`INSERT INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot)
					 VALUES (?, ?, 'repo', ?, 'open', 20, ?)`,
				)
				.run(pull.id, project.id, String(index + 1), JSON.stringify(pull));
		}
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(400);
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
