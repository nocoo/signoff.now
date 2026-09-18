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
import { claimJob, failJob, renewJob, scheduleObservations } from "./scheduler";

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
