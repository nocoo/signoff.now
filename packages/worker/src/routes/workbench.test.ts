import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeDemoPulls } from "@signoff/domain/demo";
import {
	collectionJobSchema,
	type Project,
	projectSchema,
	type ReadinessRule,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { Hono } from "hono";
import app from "../index.js";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	stagePulls,
} from "../monitoring/publication";
import { claimJob } from "../monitoring/scheduler";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1.js";
import type { AppEnv, Bindings } from "../types.js";
import { projectsScanRoute } from "./workbench.js";

const GATE_RULES: ReadinessRule[] = [
	{ gateId: "policy-1", label: "Review", color: "orange" },
	{ gateId: "policy-2", label: "CI", color: "blue" },
];

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

describe("project readiness settings", () => {
	test("clears source-specific requirements on scope changes and rules when moving to a different ADO project", async () => {
		const project = await create();
		const catalogue = [
			{
				id: "policy-1",
				name: "Old project CI",
				kind: "build" as const,
				definitionId: "7",
			},
		];
		sqlite.raw
			.query(
				"UPDATE projects SET merge_requirements_json = ?, readiness_rules_json = ? WHERE id = ?",
			)
			.run(JSON.stringify(catalogue), JSON.stringify(GATE_RULES), project.id);
		const unchanged = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			owner: "New owner",
		});
		const ownerEdit = projectSchema.parse(await unchanged.json());
		expect(ownerEdit.mergeRequirements).toEqual(catalogue);
		expect(ownerEdit.readinessRules).toEqual(GATE_RULES);
		const scope = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: ownerEdit.revision,
			repositories: ["new-repo"],
		});
		const scopeEdit = projectSchema.parse(await scope.json());
		expect(scopeEdit.mergeRequirements).toEqual([]);
		expect(scopeEdit.readinessRules).toEqual(GATE_RULES);
		expect(scopeEdit.readinessRevision).toBe(2);
		sqlite.raw
			.query("UPDATE projects SET merge_requirements_json = ? WHERE id = ?")
			.run(JSON.stringify(catalogue), project.id);
		const moved = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: scopeEdit.revision,
			projectKey: "Another project",
		});
		const movedProject = projectSchema.parse(await moved.json());
		expect(movedProject.mergeRequirements).toEqual([]);
		expect(movedProject.readinessRules).toEqual([]);
		expect(movedProject.readinessRevision).toBe(3);
		expect(
			(
				await request(`/api/projects/${project.id}/readiness`, "PATCH", {
					revision: 2,
					rules: GATE_RULES,
				})
			).status,
		).toBe(409);
	});
	test("an owner edit preserves scan metadata published after its project pre-read", async () => {
		const project = await create();
		sqlite.raw
			.query(
				"UPDATE projects SET scan_state = 'failed', scan_message = 'Old failure' WHERE id = ?",
			)
			.run(project.id);
		const publishedAt = Math.floor(Date.now() / 1000);
		sqlite.beforeBatch("DELETE FROM pull_requests", () => {
			sqlite.raw
				.query(
					"UPDATE projects SET last_scanned_at = ?, scan_state = 'complete', scan_message = NULL WHERE id = ?",
				)
				.run(publishedAt, project.id);
		});
		const response = await request(`/api/projects/${project.id}`, "PATCH", {
			revision: project.revision,
			owner: "New owner",
		});
		expect(response.status).toBe(200);
		const saved = projectSchema.parse(await response.json());
		expect(saved).toMatchObject({
			owner: "New owner",
			revision: project.revision + 1,
			lastScannedAt: publishedAt,
			scanState: "complete",
			scanMessage: null,
		});
		expect((await snapshot()).projects[0]).toEqual(saved);
	});
	test("persists settings separately from collection revision and retains snapshots and active jobs", async () => {
		const project = await create();
		const other = await create({ projectKey: "Other" });
		sqlite.raw
			.query("UPDATE projects SET source = 'demo' WHERE id = ?")
			.run(project.id);
		await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		sqlite.raw
			.query("UPDATE projects SET source = 'cli' WHERE id = ?")
			.run(project.id);
		const before = await snapshot();
		const current = before.projects.find((p) => p.id === project.id)!;
		await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: current.revision,
		});
		const rules = GATE_RULES.map((rule) => ({
			...rule,
			color: "purple" as const,
		}));
		const response = await request(
			`/api/projects/${project.id}/readiness`,
			"PATCH",
			{ revision: 1, rules },
		);
		expect(response.status).toBe(200);
		const saved = projectSchema.parse(await response.json());
		expect(saved).toMatchObject({
			readinessRules: rules,
			readinessRevision: 2,
			revision: current.revision,
		});
		const after = await snapshot();
		expect(after.pullRequests).toEqual(before.pullRequests);
		expect(after.scans).toEqual(before.scans);
		expect(
			after.collectionJobs?.find((job) => job.projectId === project.id)?.state,
		).toBe("queued");
		expect(
			after.projects.find((p) => p.id === other.id)?.readinessRules,
		).toEqual([]);
		expect(
			after.projects.find((p) => p.id === project.id)?.readinessRules,
		).toEqual(rules);
		// An ordinary project PATCH must not overwrite presentation settings.
		await request(`/api/projects/${project.id}`, "PATCH", {
			revision: current.revision,
			owner: "Ada Lovelace",
		});
		expect(
			(await snapshot()).projects.find((p) => p.id === project.id)
				?.readinessRules,
		).toEqual(rules);
	});

	test("rejects stale concurrent edits without changing the saved rule list", async () => {
		const project = await create();
		const responses = await Promise.all([
			request(`/api/projects/${project.id}/readiness`, "PATCH", {
				revision: 1,
				rules: GATE_RULES,
			}),
			request(`/api/projects/${project.id}/readiness`, "PATCH", {
				revision: 1,
				rules: [...GATE_RULES].reverse(),
			}),
		]);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
		const winner = projectSchema.parse(
			await responses.find((r) => r.status === 200)!.json(),
		);
		expect((await snapshot()).projects[0]?.readinessRules).toEqual(
			winner.readinessRules,
		);
		expect(winner.readinessRevision).toBe(2);
		const reset = await request(
			`/api/projects/${project.id}/readiness`,
			"PATCH",
			{ revision: 2, rules: [] },
		);
		expect(reset.status).toBe(200);
		expect((await snapshot()).projects[0]?.readinessRules).toEqual([]);
	});

	test("supports GitHub sample settings with the same contract", async () => {
		const project = await create();
		sqlite.raw
			.query(
				"UPDATE projects SET provider = 'github', source = 'demo' WHERE id = ?",
			)
			.run(project.id);
		const response = await request(
			`/api/projects/${project.id}/readiness`,
			"PATCH",
			{ revision: 1, rules: GATE_RULES },
		);
		expect(response.status).toBe(200);
		expect(projectSchema.parse(await response.json()).provider).toBe("github");
	});

	test("rejects missing projects, malformed data, invalid colors, and oversized requests", async () => {
		expect(
			(
				await request("/api/projects/missing/readiness", "PATCH", {
					revision: 1,
					rules: [],
				})
			).status,
		).toBe(409);
		const project = await create();
		for (const payload of [
			null,
			{},
			{ revision: 0, rules: [] },
			{ revision: 1, rules: [{ kind: "ready", color: "green" }] },
			{ revision: 1, rules: [], owner: "Unexpected write" },
			{
				revision: 1,
				rules: GATE_RULES.map((r) => ({ ...r, color: "invalid" })),
			},
		]) {
			expect(
				(
					await request(
						`/api/projects/${project.id}/readiness`,
						"PATCH",
						payload,
					)
				).status,
			).toBe(400);
		}
		expect(
			(
				await request(`/api/projects/${project.id}/readiness`, "PATCH", {
					revision: 1,
					rules: [],
					huge: "x".repeat(1024 * 1024),
				})
			).status,
		).toBe(413);
		expect((await snapshot()).projects[0]?.readinessRevision).toBe(1);
	});
});
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
async function executeSampleDiscovery(project: Project) {
	const response = await request(`/api/projects/${project.id}/scan`, "POST", {
		revision: project.revision,
	});
	expect(response.status).toBe(202);
	const job = collectionJobSchema.parse(await response.json());
	const now = Math.floor(Date.now() / 1000);
	const claim = (await claimJob(sqlite.db, now, { jobId: job.id }))!;
	const pulls = makeDemoPulls(project, now);
	const repos = [
		...new Map(pulls.map((pr) => [pr.repository.id, pr.repository])).values(),
	];
	await registerJobRepositories(
		sqlite.db,
		job.id,
		claim.leaseToken,
		repos,
		now,
	);
	for (const repo of repos) {
		const items = pulls.filter((pr) => pr.repository.id === repo.id);
		await stagePulls(sqlite.db, job.id, claim.leaseToken, items, now);
		await publishRepository(
			sqlite.db,
			job.id,
			claim.leaseToken,
			repo.id,
			items.length,
			"complete",
			"Discovered sample",
			now,
		);
	}
	await completeJob(sqlite.db, job.id, claim.leaseToken, now);
}
async function scannedProject() {
	const project = await insertDemoProject();
	await executeSampleDiscovery(project);
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
	test("scope edits remove out-of-scope snapshots while retaining historical scan receipts", async () => {
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
		expect(after.scans).toHaveLength(1);
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

describe("explicit discovery compatibility route", () => {
	test("discovery queues without collecting or changing watches, and publishes only in the executor", async () => {
		const project = await insertDemoProject();
		const response = await request(`/api/projects/${project.id}/scan`, "POST", {
			revision: project.revision,
		});
		expect(response.status).toBe(202);
		const pending = await snapshot();
		expect(pending.pullRequests).toEqual([]);
		expect(pending.collectionJobs?.[0]).toMatchObject({
			kind: "list",
			state: "queued",
		});
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM pr_observations").get(),
		).toEqual({ n: 0 });
		await executeSampleDiscovery(project);
		const after = await snapshot();
		expect(after.pullRequests).toHaveLength(6);
		expect(after.scans).toHaveLength(1);
		expect(after.projects[0]?.revision).toBe(project.revision);
	});
	test("requires local sample mode, valid bodies and explicit discovery", async () => {
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
		for (const value of [{}, undefined])
			expect(
				(await request(`/api/projects/${project.id}/scan`, "POST", value))
					.status,
			).toBe(400);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: 1,
					extra: "x".repeat(9000),
				})
			).status,
		).toBe(413);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
					pullIds: [before.pullRequests[0]!.id],
				})
			).status,
		).toBe(410);
		expect((await snapshot()).pullRequests).toEqual(before.pullRequests);
	});
	test("concurrent explicit requests coalesce by scope and work even with the old enabled flag off", async () => {
		const project = await create({ enabled: false });
		const responses = await Promise.all(
			[1, 2].map(() =>
				request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				}),
			),
		);
		expect(responses.map((r) => r.status)).toEqual([202, 202]);
		const jobs = await Promise.all(
			responses.map(async (r) => collectionJobSchema.parse(await r.json())),
		);
		expect(jobs[0]?.id).toBe(jobs[1]?.id);
		expect((await snapshot()).collectionJobs).toHaveLength(1);
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision + 1,
				})
			).status,
		).toBe(409);
		expect(JSON.stringify(await snapshot())).not.toContain("lease_token");
	});
	test("a project change during enqueue cannot leave a stale task", async () => {
		const project = await create();
		sqlite.beforeBatch("INSERT INTO collection_jobs", () => {
			sqlite.raw
				.query("UPDATE projects SET revision=revision+1 WHERE id=?")
				.run(project.id);
		});
		expect(
			(
				await request(`/api/projects/${project.id}/scan`, "POST", {
					revision: project.revision,
				})
			).status,
		).toBe(409);
		expect((await snapshot()).collectionJobs).toEqual([]);
	});
	test("rejects all workbench routes on the pipeline-token host", async () => {
		for (const [method, path] of [
			["GET", "/api/workbench"],
			["POST", "/api/projects"],
			["PATCH", "/api/projects/p1"],
			["PATCH", "/api/projects/p1/readiness"],
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
