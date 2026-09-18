import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedProject, seedPull } from "../test/pr-fixture";
import {
	createConcurrentSqliteD1,
	createSqliteD1,
	type SqliteD1,
} from "../test/sqlite-d1";
import {
	addObservation,
	enqueueDiscovery,
	removeObservation,
} from "./observations";
import {
	claimJob,
	failJob,
	renewJob,
	scheduleObservations,
	scheduleSummaries,
} from "./scheduler";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
async function watch(number = 1, projectId = "live-project") {
	const pull = seedPull(sqlite, {
		id: `pull-${projectId}-${number}`,
		projectId,
		externalId: String(number),
		number,
	});
	return addObservation(sqlite.db, "cli", { pullId: pull.id }, 100);
}
function finish(id: string, at: number) {
	sqlite.raw
		.query(
			"UPDATE collection_jobs SET state='complete',completed_at=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=?",
		)
		.run(at, at, id);
}
const activeCount = () =>
	(
		sqlite.raw
			.query(
				"SELECT COUNT(*) AS n FROM collection_jobs WHERE state IN ('queued','running','auth_required')",
			)
			.get() as { n: number }
	).n;

describe("observation scheduler", () => {
	test("completed status receipts expire after a day without losing watches, checks jobs, or settings", async () => {
		seedProject(sqlite, { repositories: [] });
		const item = await watch();
		sqlite.raw.exec(
			"UPDATE collection_refresh SET cooldown_seconds=0 WHERE kind='details'",
		);
		await scheduleSummaries(sqlite.db, 100);
		const status = (await claimJob(sqlite.db, 100, { lane: "status" }))!;
		finish(status.job.id, 110);
		expect(sqlite.raw.query("SELECT COUNT(*) n FROM scan_runs").get()).toEqual({
			n: 0,
		});
		await scheduleSummaries(sqlite.db, 110 + 86400);
		expect(
			sqlite.raw
				.query("SELECT id FROM collection_jobs WHERE id=?")
				.get(status.job.id),
		).not.toBeNull();
		await scheduleSummaries(sqlite.db, 111 + 86400);
		expect(
			sqlite.raw
				.query("SELECT id FROM collection_jobs WHERE id=?")
				.get(status.job.id),
		).toBeNull();
		expect(
			sqlite.raw
				.query("SELECT id FROM collection_jobs WHERE id=?")
				.get(item.job!.id),
		).not.toBeNull();
		expect(
			sqlite.raw
				.query("SELECT active FROM pr_observations WHERE id=?")
				.get(item.observation.id),
		).toEqual({ active: 1 });
		expect(
			sqlite.raw
				.query(
					"SELECT cooldown_seconds FROM collection_refresh WHERE kind='details'",
				)
				.get(),
		).toEqual({ cooldown_seconds: 0 });
		expect(
			(await claimJob(sqlite.db, 111 + 86400, { lane: "status" }))?.observation
				?.id,
		).toBe(item.observation.id);
	});
	test("a separate status lane bypasses blocked checks and cools down per watched PR after completion", async () => {
		seedProject(sqlite, { repositories: [] });
		await watch(1);
		await watch(2);
		const checks = (await claimJob(sqlite.db, 100))!;
		await scheduleSummaries(sqlite.db, 100);
		await scheduleSummaries(sqlite.db, 100);
		const status = (await claimJob(sqlite.db, 100, { lane: "status" }))!;
		expect(status.job.lane).toBe("status");
		expect(status.observation?.active).toBe(true);
		expect(await claimJob(sqlite.db, 101, { lane: "status" })).toBeNull();
		expect(checks.job.id).not.toBe(status.job.id);
		finish(status.job.id, 110);
		const second = (await claimJob(sqlite.db, 111, { lane: "status" }))!;
		finish(second.job.id, 112);
		await scheduleSummaries(sqlite.db, 139);
		expect(await claimJob(sqlite.db, 139, { lane: "status" })).toBeNull();
		await scheduleSummaries(sqlite.db, 140);
		expect(
			(await claimJob(sqlite.db, 140, { lane: "status" }))?.observation?.id,
		).toBe(status.observation?.id);
		expect(await claimJob(sqlite.db, 140)).toBeNull();
		expect(
			sqlite.raw
				.query("SELECT COUNT(*) n FROM collection_jobs WHERE kind='list'")
				.get(),
		).toEqual({ n: 0 });
	});
	test("status scheduling is empty by default, source scoped, and removal cancels both lanes", async () => {
		seedProject(sqlite, { repositories: [] });
		seedPull(sqlite);
		await scheduleSummaries(sqlite.db, 100);
		expect(activeCount()).toBe(0);
		const item = await watch();
		await scheduleSummaries(sqlite.db, 100, "demo");
		expect(activeCount()).toBe(1);
		await scheduleSummaries(sqlite.db, 100, "cli");
		expect(activeCount()).toBe(2);
		await claimJob(sqlite.db, 100);
		await claimJob(sqlite.db, 100, { lane: "status" });
		await removeObservation(sqlite.db, "cli", item.observation.id, 1, 101);
		await scheduleSummaries(sqlite.db, 200);
		expect(activeCount()).toBe(0);
	});
	test("ordinary status failure retains the watch and retries after its own cooldown", async () => {
		seedProject(sqlite, { repositories: [] });
		await watch();
		await scheduleSummaries(sqlite.db, 100);
		const status = (await claimJob(sqlite.db, 100, { lane: "status" }))!;
		await failJob(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			"not_found",
			"PR unavailable",
			110,
		);
		await scheduleSummaries(sqlite.db, 139);
		expect(await claimJob(sqlite.db, 139, { lane: "status" })).toBeNull();
		await scheduleSummaries(sqlite.db, 140);
		expect(
			(await claimJob(sqlite.db, 140, { lane: "status" }))?.observation?.active,
		).toBe(true);
	});
	test("empty startup stays idle despite configured projects and cached PRs", async () => {
		seedProject(sqlite, { repositories: [] });
		seedPull(sqlite);
		for (const at of [100, 500, 1000, 100000]) {
			await scheduleObservations(sqlite.db, at);
			expect(await claimJob(sqlite.db, at)).toBeNull();
		}
		expect(activeCount()).toBe(0);
	});
	test("a project round cools down after its final PR ends, including removals", async () => {
		seedProject(sqlite, { repositories: [] });
		const a = await watch(1);
		const b = await watch(2);
		await scheduleObservations(sqlite.db, 100);
		await scheduleObservations(sqlite.db, 101);
		expect(activeCount()).toBe(2);
		const first = await claimJob(sqlite.db, 100);
		expect(first?.job.id).toBe(a.job?.id);
		await scheduleObservations(sqlite.db, 1000);
		expect(activeCount()).toBe(2);
		finish(a.job!.id, 1000);
		await removeObservation(sqlite.db, "cli", b.observation.id, 1, 1050);
		await scheduleObservations(sqlite.db, 1100);
		expect(activeCount()).toBe(0);
		expect(
			sqlite.raw
				.query("SELECT last_completed_at FROM collection_project_rounds")
				.get(),
		).toEqual({ last_completed_at: 1050 });
		await scheduleObservations(sqlite.db, 1349);
		expect(activeCount()).toBe(0);
		await scheduleObservations(sqlite.db, 1350);
		expect(activeCount()).toBe(1);
		expect((await claimJob(sqlite.db, 1350))?.observation?.id).toBe(
			a.observation.id,
		);
	});
	test("new additions do not extend a fixed round; off disables periodic jobs only", async () => {
		seedProject(sqlite, { repositories: [] });
		const a = await watch(1);
		await scheduleObservations(sqlite.db, 100);
		const b = await watch(2);
		finish(a.job!.id, 120);
		await scheduleObservations(sqlite.db, 121);
		expect(
			sqlite.raw
				.query(
					"SELECT last_completed_at,round_id FROM collection_project_rounds",
				)
				.get(),
		).toEqual({ last_completed_at: 120, round_id: null });
		expect((await claimJob(sqlite.db, 121))?.observation?.id).toBe(
			b.observation.id,
		);
		finish(b.job!.id, 140);
		sqlite.raw.exec(
			"UPDATE collection_refresh SET cooldown_seconds=0 WHERE kind='details'",
		);
		await scheduleObservations(sqlite.db, 10000);
		expect(activeCount()).toBe(0);
		const c = await watch(3);
		expect((await claimJob(sqlite.db, 10000))?.observation?.id).toBe(
			c.observation.id,
		);
	});
	test("refresh binds only its watched PR, regardless of repository history or other watches", async () => {
		seedProject(sqlite, { repositories: [] });
		const first = await watch(1);
		await watch(2);
		for (let number = 3; number <= 1200; number++)
			seedPull(sqlite, {
				id: `history-${number}`,
				number,
				externalId: String(number),
				state: "merged",
			});
		const claim = (await claimJob(sqlite.db, 100))!;
		expect(claim.observation?.id).toBe(first.observation.id);
		expect(
			sqlite.raw
				.query(
					"SELECT pull_id,observation_id FROM collection_claim_bindings WHERE job_id=?",
				)
				.all(claim.job.id),
		).toEqual([
			{
				pull_id: first.observation.pullId,
				observation_id: first.observation.id,
			},
		]);
	});
	test("repository discovery requires an explicit task and serializes with checks within a project", async () => {
		const project = seedProject(sqlite, { repositories: ["web-app"] });
		const a = await watch(1);
		const discovery = await enqueueDiscovery(
			sqlite.db,
			project,
			["web-app"],
			101,
		);
		const first = await claimJob(sqlite.db, 102);
		expect(first?.job.id).toBe(a.job?.id);
		expect(await claimJob(sqlite.db, 102)).toBeNull();
		finish(a.job!.id, 103);
		expect((await claimJob(sqlite.db, 104))?.job.id).toBe(discovery.id);
	});
	test("expired leases can be reclaimed but old tokens cannot renew", async () => {
		seedProject(sqlite, { repositories: [] });
		await watch();
		const old = (await claimJob(sqlite.db, 100))!;
		expect(await claimJob(sqlite.db, 219)).toBeNull();
		const next = (await claimJob(sqlite.db, 220))!;
		expect(next.job.id).toBe(old.job.id);
		expect(next.leaseToken).not.toBe(old.leaseToken);
		await expect(
			renewJob(sqlite.db, old.job.id, old.leaseToken, 220),
		).rejects.toMatchObject({ code: "LEASE_LOST" });
		await renewJob(sqlite.db, next.job.id, next.leaseToken, 221);
		expect(
			sqlite.raw.query("SELECT lease_expires_at FROM collection_jobs").get(),
		).toEqual({ lease_expires_at: 341 });
	});
	test("auth expiry backs off only its project and never removes observations or blocks cached data", async () => {
		seedProject(sqlite, { repositories: [] });
		await watch();
		seedProject(sqlite, {
			id: "other",
			organization: "other-org",
			repositories: [],
		});
		await watch(1, "other");
		const first = (await claimJob(sqlite.db, 100))!;
		await failJob(
			sqlite.db,
			first.job.id,
			first.leaseToken,
			"auth_required",
			"az login expired",
			101,
		);
		const second = (await claimJob(sqlite.db, 102))!;
		expect(second.project.id).toBe("other");
		expect(await claimJob(sqlite.db, 115)).toBeNull();
		expect((await claimJob(sqlite.db, 116))?.job.id).toBe(first.job.id);
		expect(
			sqlite.raw
				.query("SELECT COUNT(*) AS n FROM pr_observations WHERE active=1")
				.get(),
		).toEqual({ n: 2 });
	});
	test("independent SQLite connections cannot claim the same job", async () => {
		const c = createConcurrentSqliteD1();
		try {
			const fixture = { ...sqlite, raw: c.raw };
			seedProject(fixture, { repositories: [] });
			const pull = seedPull(fixture);
			await addObservation(c.connections[0]!, "cli", { pullId: pull.id }, 100);
			c.barrierBeforeBatch("SET state='running'", 2);
			const claims = await Promise.all(
				c.connections.map((db) => claimJob(db, 100)),
			);
			expect(c.barrierArrivals()).toBe(2);
			expect(claims.filter(Boolean)).toHaveLength(1);
		} finally {
			c.close();
		}
	});
});
