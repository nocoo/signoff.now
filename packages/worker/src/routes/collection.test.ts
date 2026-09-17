import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	adoPullId,
	type CollectorClaim,
	collectorClaimSchema,
} from "@signoff/domain/collection";
import { demoWorkspace } from "@signoff/domain/demo";
import {
	collectionJobSchema,
	collectorStatusSchema,
	type Project,
	type PullRequest,
	projectSchema,
	pullRequestSchema,
	scanRunSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import app from "../index.js";
import { setAccessJwtVerifierForTests } from "../middleware/access-auth.js";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1.js";
import type { Bindings } from "../types.js";

let sqlite: SqliteD1;
let env: Bindings;
const fields = {
	provider: "ado",
	name: "Intent",
	organization: "intentional",
	projectKey: "intent",
	description: "Live collection",
	owner: "Maya Chen",
	enabled: true,
};
const template = demoWorkspace(1_789_632_000).pullRequests.find(
	(pull) => pull.coverage === "complete" && pull.state === "open",
)!;

beforeEach(() => {
	sqlite = createSqliteD1();
	env = { DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" };
});
afterEach(() => {
	setAccessJwtVerifierForTests(null);
	sqlite.close();
});

const request = (
	path: string,
	method = "GET",
	payload?: unknown,
	overrides: Partial<Bindings> = {},
	host = "localhost",
) =>
	app.request(
		`http://${host}${path}`,
		{
			method,
			headers: {
				host,
				"content-type": "application/json",
				...(overrides.CF_ACCESS_AUD
					? { "cf-access-jwt-assertion": "test.jwt" }
					: {}),
			},
			...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
		},
		{ ...env, ...overrides },
	);

async function create(extra: Record<string, unknown> = {}): Promise<Project> {
	const response = await request("/api/projects", "POST", {
		...fields,
		...extra,
	});
	expect(response.status).toBe(201);
	return projectSchema.parse(await response.json());
}

async function snapshot() {
	const response = await request("/api/workbench");
	return workbenchSchema.parse(await response.json());
}

function livePull(
	project: Project,
	extra: Partial<PullRequest> = {},
): PullRequest {
	const repository = extra.repository ?? {
		id: "repo-whiteboard",
		name: "whiteboard-app",
	};
	const number = extra.number ?? template.number;
	const externalId = extra.externalId ?? String(number);
	const timestamp = Math.floor(Date.now() / 1000);
	return pullRequestSchema.parse({
		...template,
		coverage: "complete",
		createdAt: timestamp - 3600,
		updatedAt: timestamp - 60,
		observedAt: timestamp,
		...extra,
		projectId: extra.projectId ?? project.id,
		number,
		externalId,
		repository,
		id:
			extra.id ??
			adoPullId(extra.projectId ?? project.id, repository.id, externalId),
	});
}

async function enqueue(project: Project) {
	const response = await request(`/api/projects/${project.id}/scan`, "POST", {
		revision: project.revision,
	});
	expect(response.status).toBe(200);
	return collectionJobSchema.parse(await response.json());
}

async function claim(): Promise<CollectorClaim> {
	const response = await request("/api/collector/claim", "POST");
	expect(response.status).toBe(200);
	return collectorClaimSchema.parse(await response.json());
}

describe("local collector ingest", () => {
	test("publishes a claimed snapshot atomically and hides staging", async () => {
		const project = await create({ repositories: ["whiteboard-app"] });
		expect((await request("/api/collector/claim", "POST")).status).toBe(200);
		expect(
			await (await request("/api/collector/claim", "POST")).json(),
		).toBeNull();
		const heartbeat = await request("/api/collector/heartbeat", "POST", {
			state: "ready",
			message: "az account is active",
		});
		expect(heartbeat.status).toBe(200);
		expect(collectorStatusSchema.parse(await heartbeat.json()).state).toBe(
			"ready",
		);
		const job = await enqueue(project);
		const first = await claim();
		expect(first.job.id).toBe(job.id);
		expect(first.project.id).toBe(project.id);
		expect(first.leaseToken).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(
			await (await request("/api/collector/claim", "POST")).json(),
		).toBeNull();
		const pull = livePull(project);
		const second = livePull(project, {
			number: pull.number + 1,
			title: "Second change",
		});
		const staged = await request(
			`/api/collector/jobs/${first.job.id}/batch`,
			"POST",
			{ leaseToken: first.leaseToken, pulls: [pull, second] },
		);
		expect(staged.status).toBe(200);
		expect((await snapshot()).pullRequests).toEqual([]);
		const progress = await request(
			`/api/collector/jobs/${first.job.id}/progress`,
			"POST",
			{
				leaseToken: first.leaseToken,
				completedPulls: 2,
				totalPulls: 2,
				message: "Uploaded two pull requests",
			},
		);
		expect(progress.status).toBe(200);
		expect(
			collectionJobSchema.parse(await progress.json()).completedPulls,
		).toBe(2);
		const finished = await request(
			`/api/collector/jobs/${first.job.id}/complete`,
			"POST",
			{
				leaseToken: first.leaseToken,
				state: "complete",
				pullRequestCount: 2,
				message: "Collected 2 pull requests",
			},
		);
		expect(finished.status).toBe(200);
		const scan = scanRunSchema.parse(await finished.json());
		expect(scan.source).toBe("cli");
		expect(scan.state).toBe("complete");
		expect(scan.pullRequestCount).toBe(2);
		const board = await snapshot();
		expect(board.pullRequests.map((item) => item.id).sort()).toEqual(
			[pull.id, second.id].sort(),
		);
		expect(board.projects[0]?.scanState).toBe("complete");
		expect(board.projects[0]?.revision).toBe(project.revision + 1);
		expect(board.scans[0]?.id).toBe(scan.id);
		expect(board.collector?.state).toBe("ready");
		expect(board.collectionJobs?.[0]?.state).toBe("complete");
		expect(JSON.stringify(board)).not.toContain(first.leaseToken);
		expect(
			sqlite.raw
				.query(
					"SELECT COUNT(*) AS count FROM collection_staging WHERE job_id = ?",
				)
				.get(first.job.id),
		).toEqual({ count: 0 });
		const emptyProject = await create({
			projectKey: "empty",
			repositories: [],
		});
		const emptyJob = await enqueue(emptyProject);
		const emptyClaim = await claim();
		expect(emptyClaim.job.id).toBe(emptyJob.id);
		const empty = await request(
			`/api/collector/jobs/${emptyClaim.job.id}/complete`,
			"POST",
			{
				leaseToken: emptyClaim.leaseToken,
				state: "complete",
				pullRequestCount: 0,
				message: "No active PRs",
			},
		);
		expect(empty.status).toBe(200);
		expect(scanRunSchema.parse(await empty.json()).pullRequestCount).toBe(0);
		expect(
			(await snapshot()).projects.find((row) => row.id === emptyProject.id)
				?.scanState,
		).toBe("complete");
	});

	test("rejects invalid chunks, foreign scope, and incomplete publish", async () => {
		const project = await create({ repositories: ["whiteboard-app"] });
		const job = await enqueue(project);
		const held = await claim();
		const pull = livePull(project);
		const tooBig = await request(
			`/api/collector/jobs/${held.job.id}/batch`,
			"POST",
			{
				leaseToken: held.leaseToken,
				pulls: Array.from({ length: 21 }, (_, index) =>
					livePull(project, { number: pull.number + index }),
				),
			},
		);
		expect(tooBig.status).toBe(400);
		for (const [status, payload] of [
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { id: "not-ado" })],
				},
			],
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { externalId: "999" })],
				},
			],
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [livePull(project), livePull(project)],
				},
			],
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { projectId: crypto.randomUUID() })],
				},
			],
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [
						livePull(project, {
							repository: { id: "other-repo", name: "billing-api" },
						}),
					],
				},
			],
			[
				400,
				{
					leaseToken: held.leaseToken,
					pulls: [
						livePull(project, {
							createdAt: 50,
							updatedAt: 10,
							observedAt: 80,
						}),
					],
				},
			],
		] as const) {
			expect(
				(
					await request(
						`/api/collector/jobs/${held.job.id}/batch`,
						"POST",
						payload,
					)
				).status,
			).toBe(status);
		}
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [pull],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 2,
					message: "count mismatch",
				})
			).status,
		).toBe(409);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { coverage: "partial" })],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "partial claimed complete",
				})
			).status,
		).toBe(409);
		expect((await snapshot()).pullRequests).toEqual([]);
		expect(job.id).toBe(held.job.id);
	});

	test("reclaims expired leases, ignores stale tokens, and keeps prior snapshots", async () => {
		const project = await create();
		await enqueue(project);
		const first = await claim();
		const prior = livePull(project, { number: 11 });
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/batch`, "POST", {
					leaseToken: first.leaseToken,
					pulls: [prior],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/complete`, "POST", {
					leaseToken: first.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "first snapshot",
				})
			).status,
		).toBe(200);
		const current = (await snapshot()).projects[0]!;
		expect((await snapshot()).pullRequests).toHaveLength(1);
		const next = await enqueue(current);
		const held = await claim();
		expect(held.job.id).toBe(next.id);
		const staged = livePull(project, { number: 12, title: "Interrupted" });
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [staged],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: crypto.randomUUID(),
					pulls: [staged],
				})
			).status,
		).toBe(409);
		sqlite.raw
			.query("UPDATE collection_jobs SET lease_expires_at = ? WHERE id = ?")
			.run(Math.floor(Date.now() / 1000) - 1, held.job.id);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/progress`, "POST", {
					leaseToken: held.leaseToken,
					completedPulls: 1,
					totalPulls: 1,
					message: "expired",
				})
			).status,
		).toBe(409);
		const reclaimed = await claim();
		expect(reclaimed.job.id).toBe(held.job.id);
		expect(reclaimed.leaseToken).not.toBe(held.leaseToken);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "stale lease",
				})
			).status,
		).toBe(409);
		expect(
			(
				await request(
					`/api/collector/jobs/${reclaimed.job.id}/complete`,
					"POST",
					{
						leaseToken: reclaimed.leaseToken,
						state: "complete",
						pullRequestCount: 0,
						message: "reclaimed empty",
					},
				)
			).status,
		).toBe(200);
		expect((await snapshot()).pullRequests).toEqual([]);
		const restored = (await snapshot()).projects[0]!;
		await enqueue(restored);
		const running = await claim();
		expect(
			(
				await request(`/api/collector/jobs/${running.job.id}/batch`, "POST", {
					leaseToken: running.leaseToken,
					pulls: [livePull(project, { number: 13 })],
				})
			).status,
		).toBe(200);
		expect((await snapshot()).pullRequests).toEqual([]);
	});

	test("records auth failure until ready, and forbidden without reviving", async () => {
		const project = await create();
		await enqueue(project);
		const held = await claim();
		const auth = await request(
			`/api/collector/jobs/${held.job.id}/fail`,
			"POST",
			{
				leaseToken: held.leaseToken,
				kind: "auth_required",
				message: "az login is required",
			},
		);
		expect(auth.status).toBe(200);
		expect(collectionJobSchema.parse(await auth.json()).state).toBe(
			"auth_required",
		);
		const afterAuth = await snapshot();
		expect(afterAuth.projects[0]?.scanState).toBe("failed");
		expect(afterAuth.projects[0]?.scanMessage).toBe("az login is required");
		expect(afterAuth.pullRequests).toEqual([]);
		expect(
			await (await request("/api/collector/claim", "POST")).json(),
		).toBeNull();
		expect(
			(
				await request("/api/collector/heartbeat", "POST", {
					state: "ready",
					message: "logged in",
				})
			).status,
		).toBe(200);
		const recovered = await claim();
		expect(recovered.job.id).toBe(held.job.id);
		expect(recovered.job.state).toBe("running");
		expect(
			(
				await request(
					`/api/collector/jobs/${recovered.job.id}/complete`,
					"POST",
					{
						leaseToken: recovered.leaseToken,
						state: "complete",
						pullRequestCount: 0,
						message: "recovered empty",
					},
				)
			).status,
		).toBe(200);
		const forbiddenProject = await create({ projectKey: "secret" });
		await enqueue(forbiddenProject);
		const blocked = await claim();
		expect(
			(
				await request(`/api/collector/jobs/${blocked.job.id}/fail`, "POST", {
					leaseToken: blocked.leaseToken,
					kind: "forbidden",
					message: "Repository is not readable",
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${blocked.job.id}/fail`, "POST", {
					leaseToken: blocked.leaseToken,
					kind: "forbidden",
					message: "again",
				})
			).status,
		).toBe(409);
		expect(
			(await snapshot()).projects.find((row) => row.id === forbiddenProject.id)
				?.scanState,
		).toBe("failed");
		expect(
			(
				await request("/api/collector/heartbeat", "POST", {
					state: "ready",
					message: "still logged in",
				})
			).status,
		).toBe(200);
		expect(
			await (await request("/api/collector/claim", "POST")).json(),
		).toBeNull();
	});

	test("rejects collector and scan calls from Access and machine hosts", async () => {
		const project = await create();
		setAccessJwtVerifierForTests(async () => ({
			email: "ada@example.com",
			name: "Ada",
			service: false,
		}));
		const access = {
			CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
			CF_ACCESS_AUD: "aud-tag",
		};
		for (const [method, path] of [
			["POST", "/api/collector/heartbeat"],
			["POST", "/api/collector/claim"],
			["POST", `/api/collector/jobs/${crypto.randomUUID()}/progress`],
			["POST", `/api/collector/jobs/${crypto.randomUUID()}/batch`],
			["POST", `/api/collector/jobs/${crypto.randomUUID()}/complete`],
			["POST", `/api/collector/jobs/${crypto.randomUUID()}/fail`],
			["POST", `/api/projects/${project.id}/scan`],
		] as const) {
			expect(
				(
					await request(
						path,
						method,
						{
							revision: 1,
							state: "ready",
							message: "x",
							leaseToken: crypto.randomUUID(),
						},
						access,
						"signoff.hexly.ai",
					)
				).status,
			).toBe(403);
			expect(
				(
					await app.request(
						`https://signoff-ingest.hexly.ai${path}`,
						{
							method,
							headers: {
								host: "signoff-ingest.hexly.ai",
								authorization: "Bearer test-pipeline-token",
								"content-type": "application/json",
							},
							body: JSON.stringify({ revision: 1 }),
						},
						{ ...env, SIGNOFF_PIPELINE_WRITE_TOKEN: "test-pipeline-token" },
					)
				).status,
			).toBe(403);
		}
		expect((await snapshot()).projects).toHaveLength(1);
	});

	test("rejects oversized, malformed, missing, and raced collector mutations", async () => {
		const project = await create();
		await enqueue(project);
		const held = await claim();
		const missing = crypto.randomUUID();
		expect(
			(await request("/api/collector/heartbeat", "POST", { state: "ready" }))
				.status,
		).toBe(400);
		expect(
			(await request(`/api/collector/jobs/${held.job.id}/progress`, "POST", {}))
				.status,
		).toBe(400);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
				})
			).status,
		).toBe(400);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/fail`, "POST", {
					leaseToken: held.leaseToken,
				})
			).status,
		).toBe(400);
		const malformed = await app.request(
			"http://localhost/api/collector/heartbeat",
			{ method: "POST", headers: { host: "localhost" }, body: "{" },
			env,
		);
		expect(malformed.status).toBe(400);
		expect(
			(
				await request("/api/collector/heartbeat", "POST", {
					state: "ready",
					message: "x".repeat(9000),
				})
			).status,
		).toBe(413);
		expect(
			(
				await app.request(
					`http://localhost/api/collector/jobs/${held.job.id}/batch`,
					{
						method: "POST",
						headers: {
							host: "localhost",
							"content-type": "application/json",
							"content-length": "600000",
						},
						body: "{}",
					},
					env,
				)
			).status,
		).toBe(413);
		expect(
			(
				await request(`/api/collector/jobs/${missing}/progress`, "POST", {
					leaseToken: held.leaseToken,
					completedPulls: 0,
					totalPulls: 0,
					message: "gone",
				})
			).status,
		).toBe(404);
		expect(
			(
				await request(`/api/collector/jobs/${missing}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project)],
				})
			).status,
		).toBe(404);
		expect(
			(
				await request(`/api/collector/jobs/${missing}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 0,
					message: "gone",
				})
			).status,
		).toBe(404);
		expect(
			(
				await request(`/api/collector/jobs/${missing}/fail`, "POST", {
					leaseToken: held.leaseToken,
					kind: "unavailable",
					message: "gone",
				})
			).status,
		).toBe(404);
		sqlite.beforeBatch("INSERT INTO collection_staging", () => {
			sqlite.raw
				.query("UPDATE projects SET enabled = 0 WHERE id = ?")
				.run(project.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project)],
				})
			).status,
		).toBe(409);
		sqlite.raw
			.query("UPDATE projects SET enabled = 1 WHERE id = ?")
			.run(project.id);
		sqlite.raw
			.query("UPDATE projects SET enabled = 0 WHERE id = ?")
			.run(project.id);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/progress`, "POST", {
					leaseToken: held.leaseToken,
					completedPulls: 1,
					totalPulls: 1,
					message: "paused",
				})
			).status,
		).toBe(409);
		sqlite.raw
			.query("UPDATE projects SET enabled = 1 WHERE id = ?")
			.run(project.id);
		sqlite.beforeBatch("DELETE FROM pull_requests", () => {
			sqlite.raw
				.query("UPDATE projects SET revision = revision + 1 WHERE id = ?")
				.run(project.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 0,
					message: "raced revision",
				})
			).status,
		).toBe(409);
		sqlite.raw
			.query(
				"UPDATE projects SET enabled = 1, revision = revision + 1 WHERE id = ?",
			)
			.run(project.id);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/fail`, "POST", {
					leaseToken: held.leaseToken,
					kind: "unavailable",
					message: "revision moved",
				})
			).status,
		).toBe(409);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 0,
					message: "revision moved",
				})
			).status,
		).toBe(409);
	});
	test("stale fail and complete batches cannot ride another terminal write in the same second", async () => {
		const project = await create();
		await enqueue(project);
		const first = await claim();
		const prior = livePull(project, { number: 21 });
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/batch`, "POST", {
					leaseToken: first.leaseToken,
					pulls: [prior],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/complete`, "POST", {
					leaseToken: first.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "published",
				})
			).status,
		).toBe(200);
		const current = (await snapshot()).projects[0]!;
		expect((await snapshot()).pullRequests).toHaveLength(1);
		await enqueue(current);
		const held = await claim();
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { number: 22 })],
				})
			).status,
		).toBe(200);
		const collide = (state: string, message: string) => {
			const at = Math.floor(Date.now() / 1000);
			sqlite.raw
				.query(
					`UPDATE collection_jobs
					 SET state = ?, message = ?, updated_at = ?, completed_at = ?, lease_token = NULL, lease_expires_at = NULL
					 WHERE id = ?`,
				)
				.run(state, message, at, at, held.job.id);
			sqlite.raw
				.query(
					`UPDATE projects
					 SET revision = revision + 1, scan_state = 'never', scan_message = NULL, updated_at = ?
					 WHERE id = ?`,
				)
				.run(at, current.id);
		};
		sqlite.beforeBatch("scan_state = 'failed'", () =>
			collide("failed", "earlier fail"),
		);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/fail`, "POST", {
					leaseToken: held.leaseToken,
					kind: "unavailable",
					message: "stale fail",
				})
			).status,
		).toBe(409);
		const board = await snapshot();
		expect(board.pullRequests.map((item) => item.id)).toEqual([prior.id]);
		expect(board.projects[0]?.scanState).toBe("never");
		expect(board.projects[0]?.scanMessage).toBeNull();
		expect(board.scans[0]?.state).toBe("complete");
		expect(JSON.stringify(board)).not.toContain(held.leaseToken);
		const paused = (await snapshot()).projects[0]!;
		await enqueue(paused);
		const pauseClaim = await claim();
		sqlite.beforeBatch("scan_state = 'failed'", () => {
			sqlite.raw
				.query("UPDATE projects SET enabled = 0 WHERE id = ?")
				.run(paused.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${pauseClaim.job.id}/fail`, "POST", {
					leaseToken: pauseClaim.leaseToken,
					kind: "unavailable",
					message: "paused",
				})
			).status,
		).toBe(409);
		expect((await snapshot()).pullRequests.map((item) => item.id)).toEqual([
			prior.id,
		]);
		sqlite.raw
			.query("UPDATE projects SET enabled = 1 WHERE id = ?")
			.run(paused.id);
		sqlite.beforeBatch("scan_state = 'failed'", () => {
			sqlite.raw.query("DELETE FROM projects WHERE id = ?").run(paused.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${pauseClaim.job.id}/fail`, "POST", {
					leaseToken: pauseClaim.leaseToken,
					kind: "unavailable",
					message: "deleted",
				})
			).status,
		).toBe(409);
	});
	test("scope edit, reclaim, and pause races keep prior snapshots off the success path", async () => {
		const project = await create({ repositories: ["whiteboard-app"] });
		await enqueue(project);
		const first = await claim();
		const prior = livePull(project);
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/batch`, "POST", {
					leaseToken: first.leaseToken,
					pulls: [prior],
				})
			).status,
		).toBe(200);
		expect(
			(
				await request(`/api/collector/jobs/${first.job.id}/complete`, "POST", {
					leaseToken: first.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "scope base",
				})
			).status,
		).toBe(200);
		const current = (await snapshot()).projects[0]!;
		await enqueue(current);
		const held = await claim();
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project, { number: prior.number + 1 })],
				})
			).status,
		).toBe(200);
		sqlite.beforeBatch("scan_state = 'failed'", () => {
			const at = Math.floor(Date.now() / 1000);
			sqlite.raw
				.query("DELETE FROM pull_requests WHERE project_id = ?")
				.run(current.id);
			sqlite.raw
				.query("DELETE FROM scan_runs WHERE project_id = ?")
				.run(current.id);
			sqlite.raw
				.query(
					`UPDATE collection_jobs
					 SET state = 'failed', message = 'Project changed', updated_at = ?, completed_at = ?, lease_token = NULL, lease_expires_at = NULL
					 WHERE id = ?`,
				)
				.run(at, at, held.job.id);
			sqlite.raw
				.query(
					`UPDATE projects
					 SET revision = revision + 1, repositories_json = ?, scan_state = 'never', scan_message = NULL, updated_at = ?
					 WHERE id = ?`,
				)
				.run(JSON.stringify(["platform-sdk"]), at, current.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/fail`, "POST", {
					leaseToken: held.leaseToken,
					kind: "forbidden",
					message: "stale after scope edit",
				})
			).status,
		).toBe(409);
		let board = await snapshot();
		expect(board.pullRequests).toEqual([]);
		expect(board.scans).toEqual([]);
		expect(board.projects[0]?.scanState).toBe("never");
		expect(board.projects[0]?.scanMessage).toBeNull();
		const scoped = board.projects[0]!;
		await enqueue(scoped);
		const reclaimed = await claim();
		const stolen = crypto.randomUUID();
		sqlite.beforeBatch("scan_state = 'failed'", () => {
			sqlite.raw
				.query(
					`UPDATE collection_jobs
					 SET lease_token = ?, lease_expires_at = ?
					 WHERE id = ?`,
				)
				.run(stolen, Math.floor(Date.now() / 1000) + 120, reclaimed.job.id);
		});
		expect(
			(
				await request(`/api/collector/jobs/${reclaimed.job.id}/fail`, "POST", {
					leaseToken: reclaimed.leaseToken,
					kind: "unavailable",
					message: "old lease",
				})
			).status,
		).toBe(409);
		const row = sqlite.raw
			.query<{ lease_token: string; state: string }, [string]>(
				"SELECT lease_token, state FROM collection_jobs WHERE id = ?",
			)
			.get(reclaimed.job.id);
		expect(row?.lease_token).toBe(stolen);
		expect(row?.state).toBe("running");
		sqlite.raw
			.query("UPDATE collection_jobs SET lease_token = ? WHERE id = ?")
			.run(reclaimed.leaseToken, reclaimed.job.id);
		sqlite.beforeBatch("DELETE FROM pull_requests", () => {
			const at = Math.floor(Date.now() / 1000);
			sqlite.raw
				.query(
					`UPDATE collection_jobs
					 SET state = 'failed', message = 'lost', updated_at = ?, completed_at = ?, lease_token = NULL, lease_expires_at = NULL
					 WHERE id = ?`,
				)
				.run(at, at, reclaimed.job.id);
		});
		expect(
			(
				await request(
					`/api/collector/jobs/${reclaimed.job.id}/complete`,
					"POST",
					{
						leaseToken: reclaimed.leaseToken,
						state: "complete",
						pullRequestCount: 0,
						message: "should not publish",
					},
				)
			).status,
		).toBe(409);
		board = await snapshot();
		expect(board.projects[0]?.scanState).toBe("never");
		expect(board.scans).toEqual([]);
		expect(board.pullRequests).toEqual([]);
		expect(JSON.stringify(board)).not.toContain("leaseToken");
		expect(JSON.stringify(board)).not.toContain(stolen);
	});
	test("stale project edits do not publish or block the next scan", async () => {
		const project = await create({ repositories: ["whiteboard-app"] });
		await enqueue(project);
		const held = await claim();
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/batch`, "POST", {
					leaseToken: held.leaseToken,
					pulls: [livePull(project)],
				})
			).status,
		).toBe(200);
		const edited = projectSchema.parse(
			await (
				await request(`/api/projects/${project.id}`, "PATCH", {
					revision: project.revision,
					repositories: ["platform-sdk"],
				})
			).json(),
		);
		expect(edited.revision).toBe(project.revision + 1);
		expect(
			(
				await request(`/api/collector/jobs/${held.job.id}/complete`, "POST", {
					leaseToken: held.leaseToken,
					state: "complete",
					pullRequestCount: 1,
					message: "stale revision",
				})
			).status,
		).toBe(409);
		expect((await snapshot()).pullRequests).toEqual([]);
		const queued = await enqueue(edited);
		expect(queued.revision).toBe(edited.revision);
		expect(queued.id).not.toBe(held.job.id);
		expect(queued.state).toBe("queued");
	});
});
