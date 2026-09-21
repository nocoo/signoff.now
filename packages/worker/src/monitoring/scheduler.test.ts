import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
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
	scheduleDiscovery,
	scheduleObservations,
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
	test("idle claims seek the lease instead of scanning job history", async () => {
		seedProject(sqlite, { repositories: [] });
		await watch();
		expect(await claimJob(sqlite.db, 100)).not.toBeNull();
		const prepare = spyOn(sqlite.db, "prepare");
		try {
			expect(await claimJob(sqlite.db, 101)).toBeNull();
			const lookups = prepare.mock.calls
				.map(([sql]) => sql)
				.filter((sql) => /WHERE (?:j\.)?lease_token=\?/.test(sql));
			expect(lookups.length).toBeGreaterThan(0);
			for (const sql of lookups) {
				const plan = sqlite.raw
					.query(`EXPLAIN QUERY PLAN ${sql}`)
					.all(
						...Array.from(
							{ length: sql.split("?").length - 1 },
							() => "absent",
						),
					);
				expect(JSON.stringify(plan)).toContain(
					"collection_jobs_lease (lease_token=?)",
				);
			}
		} finally {
			prepare.mockRestore();
		}
	});

	test("project lists recur only after completion plus their cooldown and preserve source scope", async () => {
		const project = seedProject(sqlite, { repositories: [] });
		await scheduleDiscovery(sqlite.db, 100, "demo");
		expect(await claimJob(sqlite.db, 100, { lane: "discover" })).toBeNull();
		await scheduleDiscovery(sqlite.db, 100, "cli");
		await scheduleDiscovery(sqlite.db, 101, "cli");
		const first = (await claimJob(sqlite.db, 101, { lane: "discover" }))!;
		expect(first.project.id).toBe(project.id);
		expect(first.job.kind).toBe("list");
		await scheduleDiscovery(sqlite.db, 110, "cli");
		expect(await claimJob(sqlite.db, 110, { lane: "discover" })).toBeNull();
		finish(first.job.id, 910);
		await scheduleDiscovery(sqlite.db, 1509, "cli");
		expect(await claimJob(sqlite.db, 1509, { lane: "discover" })).toBeNull();
		await scheduleDiscovery(sqlite.db, 1510, "cli");
		expect(
			(await claimJob(sqlite.db, 1510, { lane: "discover" }))?.job.kind,
		).toBe("list");
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
	test("each PR becomes due independently of slow neighbors, with two bounded slots", async () => {
		seedProject(sqlite, { repositories: [] });
		const a = await watch(1);
		const b = await watch(2);
		await scheduleObservations(sqlite.db, 100);
		await scheduleObservations(sqlite.db, 101);
		expect(activeCount()).toBe(2);
		const first = (await claimJob(sqlite.db, 100))!;
		const slow = (await claimJob(sqlite.db, 101))!;
		expect(first.observation?.id).toBe(a.observation.id);
		expect(slow.observation?.id).toBe(b.observation.id);
		finish(first.job.id, 110);
		await renewJob(sqlite.db, slow.job.id, slow.leaseToken, 200);
		await renewJob(sqlite.db, slow.job.id, slow.leaseToken, 300);
		await scheduleObservations(sqlite.db, 409);
		expect(activeCount()).toBe(1);
		await scheduleObservations(sqlite.db, 410);
		await scheduleObservations(sqlite.db, 410);
		expect(activeCount()).toBe(2);
		expect((await claimJob(sqlite.db, 410))?.observation?.id).toBe(
			a.observation.id,
		);
		await watch(3);
		expect(await claimJob(sqlite.db, 410)).toBeNull();
		await removeObservation(sqlite.db, "cli", b.observation.id, 1, 411);
		expect((await claimJob(sqlite.db, 411))?.observation?.id).not.toBe(
			b.observation.id,
		);
	});
	test("new watches start immediately; manual mode disables only future periodic checks", async () => {
		seedProject(sqlite, { repositories: [] });
		const a = await watch(1);
		await scheduleObservations(sqlite.db, 100);
		const b = await watch(2);
		finish(a.job!.id, 120);
		await scheduleObservations(sqlite.db, 121);
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
	test("discovery has an independent slot while checks remain bounded", async () => {
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
		expect((await claimJob(sqlite.db, 102, { lane: "discover" }))?.job.id).toBe(
			discovery.id,
		);
		expect(await claimJob(sqlite.db, 103, { lane: "discover" })).toBeNull();
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
	test("independent claimers cannot exceed the two available project slots", async () => {
		const connections = createConcurrentSqliteD1(3);
		try {
			const fixture = { ...sqlite, raw: connections.raw };
			seedProject(fixture, { repositories: [] });
			for (let number = 1; number <= 3; number++) {
				const pull = seedPull(fixture, {
					id: `pr-${number}`,
					number,
					externalId: String(number),
				});
				await addObservation(
					connections.connections[0]!,
					"cli",
					{ pullId: pull.id },
					100,
				);
			}
			connections.barrierBeforeBatch("SET state='running'", 3);
			const claims = await Promise.all(
				connections.connections.map((db) => claimJob(db, 100)),
			);
			expect(connections.barrierArrivals()).toBe(3);
			expect(claims.filter(Boolean)).toHaveLength(2);
			expect(
				new Set(claims.filter(Boolean).map((claim) => claim?.observation?.id))
					.size,
			).toBe(2);
		} finally {
			connections.close();
		}
	});
});
