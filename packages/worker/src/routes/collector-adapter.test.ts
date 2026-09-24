import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId, collectorClaimSchema } from "@signoff/domain/collection";
import app from "../index";
import { addObservation, enqueueDiscovery } from "../monitoring/observations";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

const ACCESS = {
	CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
	CF_ACCESS_AUD: "aud",
};
let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
const request = (path: string, body: unknown = {}, host = "localhost") =>
	app.request(
		`http://${host}/api/collector/${path}`,
		{
			method: "POST",
			headers: { host, "content-type": "application/json" },
			body: JSON.stringify(body),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", SIGNOFF_DEMO_MODE: "1" },
	);

test("idle heartbeat and watch scheduler do not discover or revive authentication backoff", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	expect(
		(await request("heartbeat", { state: "ready", message: "Idle" })).status,
	).toBe(200);
	await request("schedule");
	expect(await (await request("claim")).json()).toBeNull();
	expect((await request("schedule", { lane: "status" })).status).toBe(400);
	expect((await request("claim?lane=status")).status).toBe(400);
	expect(
		(await request("schedule", { kind: "details", lane: "unknown" })).status,
	).toBe(400);
	expect((await request("claim?lane=unknown")).status).toBe(400);
	const receipt = (
		await enqueueDiscovery(sqlite.db, project, [], PR_TEST_NOW)
	)[0]!;
	sqlite.raw
		.query(
			"UPDATE collection_jobs SET state='auth_required',not_before=? WHERE id=?",
		)
		.run(Math.floor(Date.now() / 1000) + 60, receipt.id);
	await request("heartbeat", {
		state: "ready",
		message: "Another project is ready",
	});
	expect(await (await request("claim")).json()).toBeNull();
});

test("executor endpoints publish one watched PR and its scan receipt, without exposing staging", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, { id: adoPullId(project.id, "repo-1", "1") });
	await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
	const claim = collectorClaimSchema.parse(
		await (await request("claim")).json(),
	);
	expect(claim.observation?.ref.number).toBe(1);
	const action = (name: string, data: object = {}) =>
		request(`jobs/${claim.job.id}/${name}`, {
			...data,
			leaseToken: claim.leaseToken,
		});
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(
			(await action("repositories", { repositories: [pull.repository] }))
				.status,
		).toBe(200);
		expect(
			(
				await action("progress", {
					completedPulls: 1,
					totalPulls: 1,
					message: "Collected",
				})
			).status,
		).toBe(200);
		expect(
			(await action("batch", { pulls: [{ ...pull, state: "merged" }] })).status,
		).toBe(200);
	}
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS count FROM collection_staging").get(),
	).toEqual({ count: 1 });
	expect(
		sqlite.raw
			.query("SELECT COUNT(*) AS count FROM collection_job_repositories")
			.get(),
	).toEqual({ count: 1 });
	expect(sqlite.raw.query("SELECT state FROM pull_requests").get()).toEqual({
		state: "open",
	});
	expect(
		(
			await action("publish", {
				repositoryId: pull.repository.id,
				state: "complete",
				pullRequestCount: 1,
				message: "Merged",
			})
		).status,
	).toBe(200);
	expect(
		sqlite.raw.query("SELECT active,stop_reason FROM pr_observations").get(),
	).toEqual({ active: 0, stop_reason: "completed" });
	expect(
		sqlite.raw
			.query("SELECT state FROM scan_runs WHERE id=?")
			.get(claim.job.id),
	).toEqual({ state: "complete" });
	expect(
		(
			await action("progress", {
				completedPulls: 1,
				totalPulls: 1,
				message: "Late",
			})
		).status,
	).toBe(409);
});

test("catalogue discovery fans out into separate empty and failed repository receipts", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	await enqueueDiscovery(sqlite.db, project, [], PR_TEST_NOW, "deep");
	let claim = collectorClaimSchema.parse(await (await request("claim")).json());
	const parentId = claim.job.id;
	const action = (name: string, data: object = {}) =>
		request(`jobs/${claim.job.id}/${name}`, {
			...data,
			leaseToken: claim.leaseToken,
		});
	expect(
		(
			await action("repositories", {
				repositories: [
					{ id: "empty", name: "empty" },
					{ id: "denied", name: "denied" },
				],
			})
		).status,
	).toBe(200);
	expect(await (await action("complete")).json()).toMatchObject({
		state: "complete",
	});
	const query = async (id: string) =>
		(
			await app.request(
				`http://localhost/api/query/v1/jobs/${id}`,
				{ headers: { host: "localhost" } },
				{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
			)
		).json() as Promise<{
			children: string[];
			state: string;
			repositories: {
				state: string;
				pullCount: number | null;
				error: string | null;
			}[];
		}>;
	const parent = await query(parentId);
	expect(parent.children).toHaveLength(2);
	for (let i = 0; i < 2; i++) {
		claim = collectorClaimSchema.parse(await (await request("claim")).json());
		expect(parent.children).toContain(claim.job.id);
		expect(claim.job.depth).toBe("deep");
		const id = claim.scope![0]!;
		expect(
			(await action("repositories", { repositories: [{ id, name: id }] }))
				.status,
		).toBe(200);
		if (id === "empty")
			expect(
				(
					await action("publish", {
						repositoryId: id,
						state: "complete",
						pullRequestCount: 0,
						message: "Empty repository",
					})
				).status,
			).toBe(200);
		else
			expect(
				(
					await action("repository-fail", {
						repositoryId: id,
						message: "403 forbidden",
					})
				).status,
			).toBe(200);
		expect(await (await action("complete")).json()).toMatchObject({
			state: id === "empty" ? "complete" : "failed",
		});
		expect((await query(claim.job.id)).repositories).toEqual([
			expect.objectContaining(
				id === "empty"
					? { state: "succeeded", pullCount: 0 }
					: { state: "failed", error: "403 forbidden" },
			),
		]);
	}
});

test("executor failures retain watched cache and API validation is bounded", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, { id: adoPullId(project.id, "repo-1", "1") });
	await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
	const claim = collectorClaimSchema.parse(
		await (await request("claim")).json(),
	);
	expect(
		(
			await request(`jobs/${claim.job.id}/fail`, {
				leaseToken: claim.leaseToken,
				kind: "auth_required",
				message: "Login expired",
			})
		).status,
	).toBe(200);
	expect(sqlite.raw.query("SELECT active FROM pr_observations").get()).toEqual({
		active: 1,
	});
	expect(sqlite.raw.query("SELECT state FROM pull_requests").get()).toEqual({
		state: "open",
	});
	for (const [body, status] of [
		["{", 400],
		[JSON.stringify({ message: "x".repeat(8192) }), 413],
	] as const) {
		const response = await app.request(
			"http://localhost/api/collector/heartbeat",
			{
				method: "POST",
				headers: { host: "localhost", "content-type": "application/json" },
				body,
			},
			{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
		);
		expect(response.status).toBe(status);
	}
	expect((await request("claim?kind=invalid")).status).toBe(400);
});

test("collector rejects remote hosts, malformed leases, and unplanned publication", async () => {
	expect(
		(
			await app.request(
				"https://signoff.hexly.ai/api/collector/claim",
				{ method: "POST", headers: { host: "signoff.hexly.ai" } },
				{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", ...ACCESS },
			)
		).status,
	).toBe(401);
	expect(
		(await request("jobs/missing/batch", { leaseToken: "bad", pulls: [] }))
			.status,
	).toBe(400);
	const project = seedProject(sqlite, { repositories: [] });
	await enqueueDiscovery(sqlite.db, project, [], PR_TEST_NOW);
	const claim = collectorClaimSchema.parse(
		await (await request("claim")).json(),
	);
	expect(
		(
			await request(`jobs/${claim.job.id}/complete`, {
				leaseToken: claim.leaseToken,
			})
		).status,
	).toBe(409);
});

test("adding a repo preserves watched candidates and cancels stale jobs with a receipt", async () => {
	const project = seedProject(sqlite, { repositories: ["web-app"] });
	const pull = seedPull(sqlite);
	const watching = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		PR_TEST_NOW,
	);
	const response = await app.request(
		`http://localhost/api/projects/${project.id}`,
		{
			method: "PATCH",
			headers: { host: "localhost", "content-type": "application/json" },
			body: JSON.stringify({
				revision: project.revision,
				repositories: ["web-app", "another"],
			}),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
	);
	expect(response.status).toBe(200);
	expect(sqlite.raw.query("SELECT id FROM pull_requests").get()).toEqual({
		id: pull.id,
	});
	expect(
		sqlite.raw.query("SELECT active,pull_id FROM pr_observations").get(),
	).toEqual({ active: 1, pull_id: pull.id });
	expect(
		sqlite.raw
			.query("SELECT state,cancel_reason FROM collection_jobs WHERE id=?")
			.get(watching.job!.id),
	).toEqual({ state: "canceled", cancel_reason: "scope_changed" });
});

test("deep discovery commands scope jobs by canonical repository IDs", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	seedPull(sqlite, { id: "second", repository: { id: "repo-2", name: "api" } });
	const response = await app.request(
		"http://localhost/api/commands/v1/discover",
		{
			method: "POST",
			headers: { host: "localhost", "content-type": "application/json" },
			body: JSON.stringify({
				source: "live",
				projectId: project.id,
				repositoryIds: ["repo-2"],
				depth: "deep",
			}),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
	);
	expect(response.status).toBe(202);
	const receipt = (await response.json()) as { jobs: { id: string }[] };
	expect(receipt.jobs).toHaveLength(1);
	expect(
		sqlite.raw
			.query(
				"SELECT scope_json,discovery_depth FROM collection_jobs WHERE id=?",
			)
			.get(receipt.jobs[0]!.id),
	).toEqual({ scope_json: '["repo-2"]', discovery_depth: "deep" });
});
