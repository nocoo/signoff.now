import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import { makeWatchRef } from "@signoff/domain/monitoring";
import type { PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import {
	addObservation,
	enqueueDiscovery,
	refreshObserved,
	removeObservation,
	resolveObservation,
	resolveRepository,
} from "./observations";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	rejectRepository,
	stagePulls,
} from "./publication";
import { claimJob, failJob, scheduleObservations } from "./scheduler";
import { readJob, readProject } from "./store";

let sqlite: SqliteD1;
const now = PR_TEST_NOW;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
function setup() {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, {
		id: adoPullId(project.id, "repo-1", "1"),
		headSha: "head",
		targetSha: "target",
		checksObservedAt: now - 100,
	});
	return { project, pull };
}
function cached(id: string): PullRequest {
	return JSON.parse(
		(
			sqlite.raw
				.query("SELECT snapshot FROM pull_requests WHERE id=?")
				.get(id) as { snapshot: string }
		).snapshot,
	);
}
async function watching() {
	const { project, pull } = setup();
	const added = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		now,
	);
	await scheduleObservations(sqlite.db, now);
	const claim = (await claimJob(sqlite.db, now))!;
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[pull.repository],
		now,
	);
	return { project, pull, added, claim };
}

describe("guarded snapshot publication and retirement", () => {
	test.each([
		"succeeded",
		"outside",
		"failed",
	] as const)("a rejected failure for a %s repository cannot mutate retained state", async (state) => {
		const project = seedProject(sqlite, { repositories: [] });
		sqlite.raw
			.query(
				"INSERT INTO workbench_repositories(project_id,repository_id,name,discovery_state) VALUES(?,?,?,'complete')",
			)
			.run(project.id, "outside", "Outside");
		const job = await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now, { jobId: job.id }))!;
		await registerJobRepositories(
			sqlite.db,
			job.id,
			claim.leaseToken,
			[
				{ id: "repo-a", name: "A" },
				{ id: "repo-b", name: "B" },
			],
			now,
		);
		if (state === "succeeded")
			await publishRepository(
				sqlite.db,
				job.id,
				claim.leaseToken,
				"repo-a",
				0,
				"complete",
				"Complete history",
				now,
			);
		if (state === "failed")
			await rejectRepository(
				sqlite.db,
				job.id,
				claim.leaseToken,
				"repo-a",
				"Original failure",
				now,
			);
		const snapshot = () => ({
			catalog: sqlite.raw
				.query("SELECT * FROM workbench_repositories ORDER BY repository_id")
				.all(),
			receipts: sqlite.raw
				.query(
					"SELECT * FROM collection_job_repositories ORDER BY repository_id",
				)
				.all(),
			staging: sqlite.raw
				.query("SELECT * FROM collection_staging ORDER BY pull_id")
				.all(),
			revisions: sqlite.raw
				.query("SELECT * FROM workbench_revisions ORDER BY source")
				.all(),
		});
		const before = snapshot();
		await expect(
			rejectRepository(
				sqlite.db,
				job.id,
				claim.leaseToken,
				state === "outside" ? "outside" : "repo-a",
				"Delayed failure",
				now + 1,
			),
		).rejects.toMatchObject({ status: 409 });
		expect(snapshot()).toEqual(before);
	});
	test("cold ID scope rejects a differently identified repository whose name is that ID", async () => {
		const id = "11111111-1111-1111-1111-111111111111";
		const project = seedProject(sqlite, { repositories: [id] });
		const queued = await enqueueDiscovery(sqlite.db, project, [id], now);
		const claim = (await claimJob(sqlite.db, now, { jobId: queued.id }))!;
		await expect(
			registerJobRepositories(
				sqlite.db,
				queued.id,
				claim.leaseToken,
				[{ id: "22222222-2222-2222-2222-222222222222", name: id }],
				now,
			),
		).rejects.toMatchObject({ code: "INVALID_SCOPE" });
		expect(
			sqlite.raw.query("SELECT COUNT(*) n FROM workbench_repositories").get(),
		).toEqual({ n: 0 });
		expect(
			sqlite.raw
				.query("SELECT COUNT(*) n FROM collection_job_repositories")
				.get(),
		).toEqual({ n: 0 });
		await registerJobRepositories(
			sqlite.db,
			queued.id,
			claim.leaseToken,
			[{ id, name: "main-repository" }],
			now,
		);
		await publishRepository(
			sqlite.db,
			queued.id,
			claim.leaseToken,
			id,
			0,
			"complete",
			"Empty history",
			now,
		);
		expect(
			(await completeJob(sqlite.db, queued.id, claim.leaseToken, now)).state,
		).toBe("complete");
		expect(
			sqlite.raw
				.query(
					"SELECT repository_id,discovery_state FROM workbench_repositories",
				)
				.all(),
		).toEqual([{ repository_id: id, discovery_state: "complete" }]);
	});
	test.each([
		"success",
		"failed",
		"removed",
	])("refreshing a pre-rename watch preserves catalog metadata until guarded publication: %s", async (outcome) => {
		const project = seedProject(sqlite, { repositories: ["old-name"] });
		const pull = seedPull(sqlite, {
			id: adoPullId(project.id, "repo-1", "1"),
			repository: { id: "repo-1", name: "old-name" },
		});
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			now,
		);
		const first = (await claimJob(sqlite.db, now, { jobId: added.job!.id }))!;
		await registerJobRepositories(
			sqlite.db,
			first.job.id,
			first.leaseToken,
			[pull.repository],
			now,
		);
		await stagePulls(sqlite.db, first.job.id, first.leaseToken, [pull], now);
		await publishRepository(
			sqlite.db,
			first.job.id,
			first.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Initial watch",
			now,
		);
		const discovery = await enqueueDiscovery(
			sqlite.db,
			project,
			[pull.repository.id],
			now + 1,
		);
		const rename = (await claimJob(sqlite.db, now + 1, {
			jobId: discovery.id,
		}))!;
		const renamed = {
			...pull,
			repository: { ...pull.repository, name: "new-name" },
			observedAt: now + 1,
		};
		await registerJobRepositories(
			sqlite.db,
			rename.job.id,
			rename.leaseToken,
			[renamed.repository],
			now + 1,
		);
		await stagePulls(
			sqlite.db,
			rename.job.id,
			rename.leaseToken,
			[renamed],
			now + 1,
		);
		await publishRepository(
			sqlite.db,
			rename.job.id,
			rename.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Provider renamed repository",
			now + 1,
		);
		await completeJob(sqlite.db, rename.job.id, rename.leaseToken, now + 1);
		const refresh = await refreshObserved(
			sqlite.db,
			"cli",
			{ all: true },
			now + 2,
		);
		const claim = (await claimJob(sqlite.db, now + 2, {
			jobId: refresh.jobs[0]!.id,
		}))!;
		expect(claim.observation!.ref.repository.name).toBe("old-name");
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[claim.observation!.ref.repository],
			now + 2,
		);
		const metadata = () =>
			sqlite.raw
				.query(
					"SELECT name,aliases_json FROM workbench_repositories WHERE project_id=? AND repository_id=?",
				)
				.get(project.id, pull.repository.id) as {
				name: string;
				aliases_json: string;
			};
		expect(metadata().name).toBe("new-name");
		const before = metadata();
		if (outcome === "failed") {
			await failJob(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				"unavailable",
				"Provider failed before returning fresh metadata",
				now + 3,
			);
		} else {
			const fresh = {
				...renamed,
				repository: { ...renamed.repository, name: "latest-name" },
				observedAt: now + 3,
			};
			await stagePulls(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[fresh],
				now + 3,
			);
			expect(metadata()).toEqual(before);
			if (outcome === "removed") {
				await removeObservation(
					sqlite.db,
					"cli",
					added.observation.id,
					added.observation.generation,
					now + 3,
				);
				await expect(
					publishRepository(
						sqlite.db,
						claim.job.id,
						claim.leaseToken,
						pull.repository.id,
						1,
						"complete",
						"Late metadata",
						now + 4,
					),
				).rejects.toMatchObject({ code: "LEASE_LOST" });
			} else {
				await publishRepository(
					sqlite.db,
					claim.job.id,
					claim.leaseToken,
					pull.repository.id,
					1,
					"complete",
					"Fresh provider metadata",
					now + 4,
				);
			}
		}
		expect(metadata().name).toBe(
			outcome === "success" ? "latest-name" : "new-name",
		);
		expect(cached(pull.id).repository.name).toBe(metadata().name);
		if (outcome !== "success") expect(metadata()).toEqual(before);
		for (const name of [
			"old-name",
			"new-name",
			...(outcome === "success" ? ["latest-name"] : []),
		]) {
			expect(JSON.parse(metadata().aliases_json)).toContain(name);
			expect(
				(
					await resolveRepository(
						sqlite.db,
						"cli",
						`https://dev.azure.com/test-org/Platform/_git/${name}`,
					)
				).repository?.repository_id,
			).toBe(pull.repository.id);
		}
	});
	test("a repository name cannot impersonate the frozen provider repository ID", async () => {
		const { project, pull } = setup();
		const receipt = await enqueueDiscovery(
			sqlite.db,
			project,
			[pull.repository.id],
			now,
		);
		const claim = (await claimJob(sqlite.db, now, { jobId: receipt.id }))!;
		await expect(
			registerJobRepositories(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[{ id: "different-provider-id", name: pull.repository.id }],
				now + 1,
			),
		).rejects.toMatchObject({ code: "INVALID_SCOPE" });
		expect((await readJob(sqlite.db, receipt.id)).scope_json).toBe(
			JSON.stringify([pull.repository.id]),
		);
		expect(
			sqlite.raw
				.query("SELECT COUNT(*) n FROM collection_job_repositories")
				.get(),
		).toEqual({ n: 0 });
		expect(
			sqlite.raw
				.query("SELECT repository_id FROM workbench_repositories")
				.all(),
		).toEqual([{ repository_id: pull.repository.id }]);
	});
	test("discovery follows a renamed repository by its frozen provider ID and retains its old alias", async () => {
		const project = seedProject(sqlite, { repositories: ["old-name"] });
		const pull = seedPull(sqlite, {
			id: adoPullId(project.id, "repo-1", "1"),
			repository: { id: "repo-1", name: "old-name" },
		});
		const resolved = await resolveRepository(
			sqlite.db,
			"cli",
			"https://dev.azure.com/test-org/Platform/_git/old-name",
		);
		const receipt = await enqueueDiscovery(
			sqlite.db,
			project,
			[resolved.repository!.repository_id],
			now,
		);
		const claim = (await claimJob(sqlite.db, now, { jobId: receipt.id }))!;
		const repository = { id: "repo-1", name: "new-name" };
		await expect(
			registerJobRepositories(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[{ ...repository, id: "different-id" }],
				now + 1,
			),
		).rejects.toMatchObject({ code: "INVALID_SCOPE" });
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[repository],
			now + 1,
		);
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, repository }],
			now + 1,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			repository.id,
			1,
			"complete",
			"Renamed repository discovered",
			now + 1,
		);
		await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now + 1);
		for (const name of ["old-name", "new-name", "repo-1"]) {
			const url = `https://dev.azure.com/test-org/Platform/_git/${name}`;
			expect(
				(await resolveRepository(sqlite.db, "cli", url)).repository
					?.repository_id,
			).toBe(repository.id);
			const watched = await addObservation(
				sqlite.db,
				"cli",
				{ url: `${url}/pullrequest/1` },
				now + 2,
			);
			expect(watched.observation.ref.repository).toEqual(repository);
		}
		expect(
			(await addObservation(sqlite.db, "cli", { pullId: pull.id }, now + 2))
				.status,
		).toBe("already_observed");
	});
	test.each([
		false,
		true,
	])("discovery cannot publish over a replaced watch generation (staged before removal: %s)", async (stageBefore) => {
		const { project, pull } = setup();
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			now,
		);
		sqlite.raw
			.query(
				"UPDATE collection_jobs SET state='complete',completed_at=? WHERE id=?",
			)
			.run(now, added.job!.id);
		await enqueueDiscovery(sqlite.db, project, [], now + 1);
		const claim = (await claimJob(sqlite.db, now + 1))!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[pull.repository],
			now + 1,
		);
		const stage = () =>
			stagePulls(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[{ ...pull, state: "merged", title: "Old terminal result" }],
				now + 2,
			);
		if (stageBefore) await stage();
		await removeObservation(sqlite.db, "cli", added.observation.id, 1, now + 3);
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, now + 4);
		if (stageBefore)
			await expect(
				publishRepository(
					sqlite.db,
					claim.job.id,
					claim.leaseToken,
					pull.repository.id,
					1,
					"complete",
					"Old discovery",
					now + 5,
				),
			).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		else
			await expect(stage()).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(cached(pull.id).state).toBe("open");
		expect(
			(await resolveObservation(sqlite.db, "cli", { pullId: pull.id }))
				.generation,
		).toBe(2);
		expect(
			(await resolveObservation(sqlite.db, "cli", { pullId: pull.id })).active,
		).toBe(true);
	});
	test("reclaimed discovery retains its resolved repository plan and rejects scope expansion", async () => {
		const { project, pull } = setup();
		await enqueueDiscovery(sqlite.db, project, [], now);
		const first = (await claimJob(sqlite.db, now))!;
		await registerJobRepositories(
			sqlite.db,
			first.job.id,
			first.leaseToken,
			[pull.repository],
			now,
		);
		const next = (await claimJob(sqlite.db, now + 1000))!;
		expect(next.repositories).toEqual([pull.repository]);
		await expect(
			registerJobRepositories(
				sqlite.db,
				next.job.id,
				next.leaseToken,
				[pull.repository, { id: "new", name: "new" }],
				now + 1000,
			),
		).rejects.toThrow(/scope|plan/i);
		expect(
			sqlite.raw
				.query("SELECT COUNT(*) AS n FROM collection_job_repositories")
				.get(),
		).toEqual({ n: 1 });
	});
	test("publishes discovered definitions without losing gates from other repos or user ordering", async () => {
		const { project, pull, claim } = await watching();
		const existing = [
			{
				id: "other-config",
				name: "Other repo validation",
				kind: "policy" as const,
			},
		];
		const rules = [
			{ gateId: "other-config", label: "Other repo", color: "yellow" as const },
		];
		sqlite.raw
			.query(
				"UPDATE projects SET merge_requirements_json=?,readiness_rules_json=? WHERE id=?",
			)
			.run(JSON.stringify(existing), JSON.stringify(rules), project.id);
		await stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [pull], now);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Done",
			now,
			[{ id: "new-config", name: "Path policy", kind: "policy" }],
		);
		const saved = (await readProject(sqlite.db, project.id))!;
		expect(saved.mergeRequirements?.map((g) => g.name)).toContain(
			"Path policy",
		);
		expect(saved.mergeRequirements?.map((g) => g.name)).toContain(
			"Other repo validation",
		);
		expect(saved.readinessRules).toEqual(rules);
	});
	test.each([
		"merged",
		"closed",
	] as const)("publishes final %s state and atomically retires its generation", async (state) => {
		const { pull, added, claim } = await watching();
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, state, observedAt: now + 10 }],
			now + 10,
		);
		expect(cached(pull.id).state).toBe("open");
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Done",
			now + 10,
		);
		expect(cached(pull.id).state).toBe(state);
		expect(
			await resolveObservation(sqlite.db, "cli", { pullId: pull.id }),
		).toMatchObject({
			active: false,
			generation: 1,
			stopReason: state === "merged" ? "completed" : "abandoned",
		});
		expect((await readJob(sqlite.db, claim.job.id)).state).toBe("complete");
		await scheduleObservations(sqlite.db, now + 1000);
		expect(await claimJob(sqlite.db, now + 1000)).toBeNull();
		expect(added.observation.ref.repository.id).toBe(pull.repository.id);
	});
	test("old terminal response after removal and re-add cannot overwrite or stop the new generation", async () => {
		const { pull, added, claim } = await watching();
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, state: "merged" }],
			now,
		);
		await removeObservation(sqlite.db, "cli", added.observation.id, 1, now + 1);
		const next = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			now + 2,
		);
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Late",
				now + 3,
			),
		).rejects.toMatchObject({ code: "LEASE_LOST" });
		expect(cached(pull.id).state).toBe("open");
		expect(
			await resolveObservation(sqlite.db, "cli", { pullId: pull.id }),
		).toMatchObject({ active: true, generation: 2 });
		expect(next.job?.id).not.toBe(claim.job.id);
	});
	test("discovery binds observations at claim and cannot retire later additions", async () => {
		const { project, pull } = setup();
		const discovery = await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now))!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[pull.repository],
			now,
		);
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			now + 1,
		);
		expect((await enqueueDiscovery(sqlite.db, project, [], now + 2)).id).toBe(
			discovery.id,
		);
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, state: "merged", checksObservedAt: null }],
			now + 3,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Discovered",
			now + 3,
		);
		await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now + 3);
		expect(
			await resolveObservation(sqlite.db, "cli", { pullId: pull.id }),
		).toMatchObject({ id: added.observation.id, active: true });
		expect(cached(pull.id).state).toBe("merged");
	});
	test("CAS rejects stale facts even while the same observation generation remains active", async () => {
		const { pull, claim } = await watching();
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, state: "merged" }],
			now,
		);
		sqlite.raw
			.query(
				"UPDATE pull_requests SET snapshot=json_set(snapshot,'$.title','Newer snapshot') WHERE id=?",
			)
			.run(pull.id);
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Old snapshot",
				now + 1,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(cached(pull.id).title).toBe("Newer snapshot");
		expect(
			(await resolveObservation(sqlite.db, "cli", { pullId: pull.id })).active,
		).toBe(true);
	});
	test("missing counts, foreign repo identities and wrong lease cannot publish", async () => {
		const { pull, claim } = await watching();
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Missing",
				now,
			),
		).rejects.toMatchObject({ code: "INCOMPLETE_UPLOAD" });
		await expect(
			stagePulls(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[{ ...pull, number: 2 }],
				now,
			),
		).rejects.toMatchObject({ code: "INVALID_PULL" });
		await expect(
			stagePulls(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[{ ...pull, repository: { id: "other", name: "other" } }],
				now,
			),
		).rejects.toMatchObject({ code: "INVALID_PULL" });
		await expect(
			stagePulls(sqlite.db, claim.job.id, crypto.randomUUID(), [pull], now),
		).rejects.toMatchObject({ code: "LEASE_LOST" });
		expect(cached(pull.id)).toEqual(pull);
	});
	test("atomic transaction rollback cannot retire a PR without publishing its final snapshot", async () => {
		const { pull, claim } = await watching();
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, state: "merged" }],
			now,
		);
		sqlite.raw.exec(
			"CREATE TRIGGER refuse_snapshot BEFORE UPDATE ON pull_requests BEGIN SELECT RAISE(ABORT,'injected publication failure'); END",
		);
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Done",
				now,
			),
		).rejects.toThrow("injected publication failure");
		expect(
			(await resolveObservation(sqlite.db, "cli", { pullId: pull.id })).active,
		).toBe(true);
		expect((await readJob(sqlite.db, claim.job.id)).state).toBe("running");
	});
});

describe("repository discovery boundaries", () => {
	test("publishes large discovery history with SQL counts instead of loading staged snapshots into the Worker", async () => {
		const { project, pull } = setup();
		const job = await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now))!;
		await registerJobRepositories(
			sqlite.db,
			job.id,
			claim.leaseToken,
			[pull.repository],
			now,
		);
		for (let number = 1; number <= 100; number++) {
			const pr = {
				...pull,
				id: adoPullId(project.id, pull.repository.id, String(number)),
				number,
				externalId: String(number),
				description: "x".repeat(10000),
			};
			await stagePulls(sqlite.db, job.id, claim.leaseToken, [pr], now);
		}
		let snapshotReads = 0;
		const prepare = sqlite.db.prepare.bind(sqlite.db);
		sqlite.db.prepare = (sql: string) => {
			if (/SELECT snapshot FROM collection_staging/i.test(sql)) snapshotReads++;
			return prepare(sql);
		};
		await publishRepository(
			sqlite.db,
			job.id,
			claim.leaseToken,
			pull.repository.id,
			100,
			"complete",
			"History discovered",
			now,
		);
		expect(snapshotReads).toBe(0);
		expect(
			sqlite.raw.query("SELECT COUNT(*) count FROM pull_requests").get(),
		).toEqual({ count: 100 });
	});
	test("plans a thousand repositories using a fixed number of database statements", async () => {
		const project = seedProject(sqlite, { repositories: [] });
		await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now))!;
		const repositories = Array.from({ length: 1000 }, (_, i) => ({
			id: `guid-${i}`,
			name: `repo-${i}`,
		}));
		const bounded = {
			...sqlite.db,
			batch: async (statements: D1PreparedStatement[]) => {
				expect(statements.length).toBeLessThan(10);
				return sqlite.db.batch(statements);
			},
		} as D1Database;
		expect(
			await registerJobRepositories(
				bounded,
				claim.job.id,
				claim.leaseToken,
				repositories,
				now,
			),
		).toHaveLength(1000);
	});
	test("zero-PR repositories retain provider identity and complete coverage", async () => {
		const project = seedProject(sqlite, { repositories: ["empty"] });
		await enqueueDiscovery(sqlite.db, project, ["empty"], now);
		const claim = (await claimJob(sqlite.db, now))!;
		const repository = {
			id: "empty-guid",
			name: "empty",
			projectExternalId: "project-guid",
		};
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[repository],
			now,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			repository.id,
			0,
			"complete",
			"No PRs",
			now + 1,
		);
		await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now + 1);
		expect(
			sqlite.raw
				.query(
					"SELECT repository_id,discovery_state FROM workbench_repositories",
				)
				.get(),
		).toEqual({ repository_id: repository.id, discovery_state: "complete" });
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ url: makeWatchRef(project, repository, 10).url },
			now + 2,
		);
		expect(added.observation.pullId).toBeNull();
	});
	test("partial repository failure keeps successes and prior snapshots; cancellation wins for unfinished work", async () => {
		const { project, pull } = setup();
		await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now))!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[pull.repository, { id: "other", name: "other" }],
			now,
		);
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ ...pull, title: "Discovered title", checksObservedAt: null }],
			now,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Done",
			now,
		);
		await rejectRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			"other",
			"403 forbidden",
			now,
		);
		expect(
			(await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now)).state,
		).toBe("partial");
		expect(cached(pull.id).title).toBe("Discovered title");
		expect(cached(pull.id).checksObservedAt).toBe(now - 100);
		await enqueueDiscovery(sqlite.db, project, [], now + 1);
		const next = (await claimJob(sqlite.db, now + 1))!;
		await registerJobRepositories(
			sqlite.db,
			next.job.id,
			next.leaseToken,
			[pull.repository, { id: "other", name: "other" }],
			now + 1,
		);
		await publishRepository(
			sqlite.db,
			next.job.id,
			next.leaseToken,
			"other",
			0,
			"complete",
			"Empty",
			now + 1,
		);
		sqlite.raw
			.query("UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?")
			.run(now + 2, project.id);
		expect(await readJob(sqlite.db, next.job.id)).toMatchObject({
			state: "canceled",
			cancel_reason: "project_changed",
		});
		expect(
			sqlite.raw
				.query(
					"SELECT repository_id,state FROM collection_job_repositories WHERE job_id=? ORDER BY repository_id",
				)
				.all(next.job.id),
		).toEqual([
			{ repository_id: "other", state: "succeeded" },
			{ repository_id: "repo-1", state: "canceled" },
		]);
	});
	test("absence from a successful discovery never retires an observed PR", async () => {
		const { project, pull } = setup();
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, now);
		const discovery = await enqueueDiscovery(sqlite.db, project, [], now);
		const claim = (await claimJob(sqlite.db, now, { jobId: discovery.id }))!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[pull.repository],
			now,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			0,
			"complete",
			"Empty response",
			now,
		);
		await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now);
		expect(
			(await resolveObservation(sqlite.db, "cli", { pullId: pull.id })).active,
		).toBe(true);
		expect(cached(pull.id).state).toBe("open");
	});
});
