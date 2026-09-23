import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import { makeWatchRef } from "@signoff/domain/monitoring";
import type { PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import {
	createConcurrentSqliteD1,
	createSqliteD1,
	type SqliteD1,
} from "../test/sqlite-d1";
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
import {
	claimJob,
	failJob,
	scheduleDiscovery,
	scheduleObservations,
} from "./scheduler";
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
	test("repository names keep the newest fact across different PRs and delayed discovery metadata", async () => {
		const { project, pull, claim: checks } = await watching();
		const sibling = seedPull(sqlite, {
			...pull,
			id: adoPullId(project.id, pull.repository.id, "2"),
			number: 2,
			externalId: "2",
		});
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: sibling.id },
			now,
		);

		const status = (await claimJob(sqlite.db, now, { jobId: added.job!.id }))!;
		await registerJobRepositories(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[sibling.repository],
			now,
		);
		await stagePulls(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[
				{
					...sibling,
					repository: { ...sibling.repository, name: "New name" },
					summaryObservedAt: now + 2,
					observedAt: now + 2,
					checksObservedAt: now + 2,
				},
			],
			now + 2,
		);
		await publishRepository(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			sibling.repository.id,
			1,
			"complete",
			"New name",
			now + 2,
		);
		await stagePulls(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			[
				{
					...pull,
					summaryObservedAt: now,
					observedAt: now + 40,
					checksObservedAt: now + 40,
				},
			],
			now + 40,
		);
		await publishRepository(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Slow checks",
			now + 40,
		);
		const catalog = () =>
			sqlite.raw
				.query(
					"SELECT name,name_observed_at FROM workbench_repositories WHERE project_id=? AND repository_id=?",
				)
				.get(project.id, pull.repository.id);
		expect(catalog()).toEqual({ name: "New name", name_observed_at: now + 2 });
		const discovery = (
			await enqueueDiscovery(sqlite.db, project, [], now + 41)
		)[0]!;
		const discoveryClaim = (await claimJob(sqlite.db, now + 41, {
			jobId: discovery.id,
		}))!;
		await registerJobRepositories(
			sqlite.db,
			discovery.id,
			discoveryClaim.leaseToken,
			[{ ...pull.repository, observedAt: now + 1 }],
			now + 42,
		);
		expect(catalog()).toEqual({ name: "New name", name_observed_at: now + 2 });
		await registerJobRepositories(
			sqlite.db,
			discovery.id,
			discoveryClaim.leaseToken,
			[{ ...pull.repository, name: "Newest name", observedAt: now + 42 }],
			now + 43,
		);
		expect(catalog()).toEqual({
			name: "Newest name",
			name_observed_at: now + 42,
		});
	});
	test("continuous writes bound reconciliation work and preserve the last published snapshot", async () => {
		const { pull, claim } = await watching();
		await stagePulls(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[
				{
					...pull,
					summaryObservedAt: now + 1,
					observedAt: now + 1,
					title: "Contended result",
				},
			],
			now + 1,
		);
		const bump = () =>
			sqlite.raw
				.query("UPDATE pull_requests SET version=version+1 WHERE id=?")
				.run(pull.id);
		bump();
		let rebases = 0;
		const contended = {
			...sqlite.db,
			batch: async (statements: D1PreparedStatement[]) => {
				const results = await sqlite.db.batch(statements);
				if (
					statements.some((statement) =>
						(statement as unknown as { sql: string }).sql.startsWith(
							"UPDATE collection_staging SET snapshot",
						),
					)
				) {
					if (++rebases > 30)
						throw new Error("Reconciliation exceeded its request budget");
					bump();
				}
				return results;
			},
		} as D1Database;
		await expect(
			publishRepository(
				contended,
				claim.job.id,
				claim.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Contended",
				now,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(rebases).toBe(30);
		expect(cached(pull.id).title).toBe(pull.title);
		// The immutable raw result can still publish once concurrent writes stop.
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Recovered",
			now,
		);
		expect(cached(pull.id).title).toBe("Contended result");
	});
	test.each([
		false,
		true,
	])("independent connections reconcile simultaneous status/check publications, terminal=%s", async (terminal) => {
		const concurrent = createConcurrentSqliteD1();
		try {
			const [checksDb, statusDb] = concurrent.connections as [
				D1Database,
				D1Database,
			];
			const fixture = { ...sqlite, raw: concurrent.raw };
			const project = seedProject(fixture, { repositories: [] });
			const pull = seedPull(fixture, {
				id: adoPullId(project.id, "repo-1", "1"),
				headSha: "head",
				targetSha: "target",
				summaryObservedAt: now - 10,
				checksObservedAt: now - 10,
			});
			const added = await addObservation(
				checksDb,
				"cli",
				{ pullId: pull.id },
				now,
			);
			const checks = (await claimJob(checksDb, now))!;
			await scheduleDiscovery(statusDb, now);
			const status = (await claimJob(statusDb, now, { lane: "discover" }))!;
			for (const [db, task, snapshot] of [
				[
					checksDb,
					checks,
					{
						...pull,
						summaryObservedAt: now,
						observedAt: now + 3,
						checksObservedAt: now + 3,
						comments: 42,
					},
				],
				[
					statusDb,
					status,
					{
						...pull,
						title: "Fresh state",
						state: terminal ? ("merged" as const) : ("open" as const),
						summaryObservedAt: now + 2,
						observedAt: now + 2,
						checksObservedAt: null,
						policies: [],
						builds: [],
					},
				],
			] satisfies [D1Database, typeof checks, PullRequest][]) {
				await registerJobRepositories(
					db,
					task.job.id,
					task.leaseToken,
					[pull.repository],
					now,
				);
				await stagePulls(db, task.job.id, task.leaseToken, [snapshot], now + 3);
			}
			concurrent.barrierBeforeBatch("SET state='succeeded'", 2);
			const outcomes = await Promise.allSettled([
				publishRepository(
					checksDb,
					checks.job.id,
					checks.leaseToken,
					pull.repository.id,
					1,
					"complete",
					"Checks",
					now + 4,
				),
				publishRepository(
					statusDb,
					status.job.id,
					status.leaseToken,
					pull.repository.id,
					1,
					"complete",
					"Status",
					now + 4,
				),
			]);
			expect(concurrent.barrierArrivals()).toBe(2);
			expect(outcomes[1]?.status).toBe("fulfilled");
			const saved = JSON.parse(
				(
					concurrent.raw
						.query("SELECT snapshot FROM pull_requests WHERE id=?")
						.get(pull.id) as { snapshot: string }
				).snapshot,
			);
			expect(saved).toMatchObject({
				title: "Fresh state",
				summaryObservedAt: now + 2,
				state: terminal ? "merged" : "open",
			});
			if (!terminal) {
				expect(outcomes[0]?.status).toBe("fulfilled");
				expect(saved).toMatchObject({
					comments: 42,
					checksObservedAt: now + 3,
				});
			}
			expect(
				await resolveObservation(statusDb, "cli", { pullId: pull.id }),
			).toMatchObject({
				id: added.observation.id,
				active: !terminal,
				generation: 1,
			});
		} finally {
			concurrent.close();
		}
	});
	test("a watch removed and re-added at the final publication boundary fences clock-aware status writes", async () => {
		const { pull, added } = await watching();
		const status = await statusClaim();
		await stagePulls(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[
				{
					...pull,
					summaryObservedAt: now + 2,
					observedAt: now + 2,
					state: "merged",
					checksObservedAt: null,
				},
			],
			now + 2,
		);
		sqlite.beforeBatch("SET state='succeeded'", () => {
			sqlite.raw
				.query(
					"UPDATE pr_observations SET active=0,stopped_at=?,stop_reason='manual' WHERE id=?",
				)
				.run(now + 3, added.observation.id);
			sqlite.raw
				.query(
					"UPDATE pr_observations SET active=1,stopped_at=NULL,stop_reason=NULL,generation=generation+1 WHERE id=?",
				)
				.run(added.observation.id);
		});
		await expect(
			publishRepository(
				sqlite.db,
				status.job.id,
				status.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Late terminal",
				now + 4,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(cached(pull.id).state).toBe("open");
		expect(
			await resolveObservation(sqlite.db, "cli", { pullId: pull.id }),
		).toMatchObject({ generation: 2, active: true });
	});
	async function statusClaim() {
		await scheduleDiscovery(sqlite.db, now);
		const claim = (await claimJob(sqlite.db, now, { lane: "discover" }))!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[cached("ado:live-project:repo-1:1").repository],
			now,
		);
		return claim;
	}
	test("independent status and slow checks merge without losing facts or falsely refreshing the summary clock", async () => {
		const { pull, claim: checks } = await watching();
		const status = await statusClaim();
		const fresh = {
			...pull,
			title: "Latest provider title",
			summaryObservedAt: now + 2,
			observedAt: now + 2,
			checksObservedAt: null,
			policies: [],
			builds: [],
		};
		await stagePulls(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[fresh],
			now + 2,
		);
		await publishRepository(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"State checked",
			now + 2,
		);
		expect(cached(pull.id)).toMatchObject({
			title: fresh.title,
			checksObservedAt: now - 100,
			policies: pull.policies,
		});
		const slow = {
			...pull,
			summaryObservedAt: now,
			observedAt: now + 40,
			checksObservedAt: now + 40,
			comments: 42,
		};
		await stagePulls(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			[slow],
			now + 40,
		);
		await publishRepository(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Checks updated",
			now + 40,
		);
		expect(cached(pull.id)).toMatchObject({
			title: fresh.title,
			summaryObservedAt: now + 2,
			checksObservedAt: now + 40,
			comments: 42,
		});
	});
	test.each([
		"merged",
		"closed",
	] as const)("the status lane atomically publishes %s and cancels in-flight checks before their response returns", async (state) => {
		const { pull, claim: checks, added } = await watching();
		await stagePulls(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			[{ ...pull, summaryObservedAt: now, observedAt: now + 1 }],
			now + 1,
		);
		const status = await statusClaim();
		await stagePulls(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[
				{
					...pull,
					state,
					summaryObservedAt: now + 2,
					observedAt: now + 2,
					checksObservedAt: null,
				},
			],
			now + 2,
		);
		await publishRepository(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Terminal",
			now + 2,
		);
		expect(cached(pull.id).state).toBe(state);
		expect(
			await resolveObservation(sqlite.db, "cli", { pullId: pull.id }),
		).toMatchObject({
			id: added.observation.id,
			active: false,
			stopReason: state === "merged" ? "completed" : "abandoned",
		});
		expect((await readJob(sqlite.db, checks.job.id)).state).toBe("canceled");
		await expect(
			publishRepository(
				sqlite.db,
				checks.job.id,
				checks.leaseToken,
				pull.repository.id,
				1,
				"complete",
				"Old open result",
				now + 3,
			),
		).rejects.toMatchObject({ code: "LEASE_LOST" });
		expect(
			await claimJob(sqlite.db, now + 1000, { lane: "checks" }),
		).toBeNull();
	});
	test("publication rebases against a status change after detail staging", async () => {
		const { pull, claim: checks } = await watching();
		await stagePulls(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			[
				{
					...pull,
					summaryObservedAt: now,
					observedAt: now + 5,
					checksObservedAt: now + 5,
				},
			],
			now + 5,
		);
		const status = await statusClaim();
		await stagePulls(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			[
				{
					...pull,
					headSha: "new-head",
					title: "New commit",
					summaryObservedAt: now + 6,
					observedAt: now + 6,
					checksObservedAt: null,
					policies: [],
					builds: [],
				},
			],
			now + 6,
		);
		await publishRepository(
			sqlite.db,
			status.job.id,
			status.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"New head",
			now + 6,
		);
		await publishRepository(
			sqlite.db,
			checks.job.id,
			checks.leaseToken,
			pull.repository.id,
			1,
			"complete",
			"Old head checks",
			now + 7,
		);
		expect(cached(pull.id)).toMatchObject({
			title: "New commit",
			headSha: "new-head",
			checksObservedAt: null,
			checksInvalidated: true,
		});
	});
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
		const job = (
			await enqueueDiscovery(sqlite.db, project, ["repo-a"], now)
		)[0]!;
		const claim = (await claimJob(sqlite.db, now, { jobId: job.id }))!;
		await registerJobRepositories(
			sqlite.db,
			job.id,
			claim.leaseToken,
			[{ id: "repo-a", name: "A" }],
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
		const queued = (await enqueueDiscovery(sqlite.db, project, [id], now))[0]!;
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
		const discovery = (
			await enqueueDiscovery(sqlite.db, project, [pull.repository.id], now + 1)
		)[0]!;
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
		sqlite.raw.exec(
			"UPDATE collection_refresh SET cooldown_seconds=0 WHERE kind='details'",
		);
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
			[cached("ado:live-project:repo-1:1").repository],
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
		const receipt = (
			await enqueueDiscovery(sqlite.db, project, [pull.repository.id], now)
		)[0]!;
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
		const receipt = (
			await enqueueDiscovery(
				sqlite.db,
				project,
				[resolved.repository!.repository_id],
				now,
			)
		)[0]!;
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
		expect(
			sqlite.raw
				.query("SELECT readiness_rules_json FROM projects WHERE id=?")
				.get(project.id),
		).toEqual({ readiness_rules_json: JSON.stringify(rules) });
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
		expect(
			await claimJob(sqlite.db, now + 1000, { lane: "checks" }),
		).toBeNull();
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
		const discovery = (await enqueueDiscovery(sqlite.db, project, [], now))[0]!;
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
		expect(
			(await enqueueDiscovery(sqlite.db, project, [], now + 2))[0]!.id,
		).toBe(discovery.id);
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
	test.each([
		false,
		true,
	])("publishes discovery history with bounded work and no repeated snapshot hydration; versioned=%s", async (versioned) => {
		const { project, pull } = setup();
		const job = (await enqueueDiscovery(sqlite.db, project, [], now))[0]!;
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
				summaryObservedAt: versioned ? now : undefined,
				id: adoPullId(project.id, pull.repository.id, String(number)),
				number,
				externalId: String(number),
				description: "x".repeat(10000),
			};
			await stagePulls(sqlite.db, job.id, claim.leaseToken, [pr], now);
		}
		let snapshotReads = 0;
		let statements = 0;
		const prepare = sqlite.db.prepare.bind(sqlite.db);
		sqlite.db.prepare = (sql: string) => {
			statements++;
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
		expect(statements).toBeLessThan(30);
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
	test("repository failures and cancellation preserve completed siblings and cached checks", async () => {
		const { project, pull } = setup();
		const jobs = await enqueueDiscovery(
			sqlite.db,
			project,
			[pull.repository.id, "other"],
			now,
		);
		for (const receipt of jobs) {
			const claim = (await claimJob(sqlite.db, now, { jobId: receipt.id }))!;
			const repository =
				claim.scope![0] === "other"
					? { id: "other", name: "other" }
					: pull.repository;
			await registerJobRepositories(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				[repository],
				now,
			);
			if (repository.id === "other") {
				await rejectRepository(
					sqlite.db,
					claim.job.id,
					claim.leaseToken,
					repository.id,
					"403 forbidden",
					now,
				);
				expect(
					(await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now))
						.state,
				).toBe("failed");
			} else {
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
					repository.id,
					1,
					"complete",
					"Done",
					now,
				);
				expect(
					(await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now))
						.state,
				).toBe("complete");
			}
		}
		expect(cached(pull.id).title).toBe("Discovered title");
		expect(cached(pull.id).checksObservedAt).toBe(now - 100);
		const queued = await enqueueDiscovery(sqlite.db, project, [], now + 1);
		sqlite.raw
			.query("UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?")
			.run(now + 2, project.id);
		for (const job of queued)
			expect(await readJob(sqlite.db, job.id)).toMatchObject({
				state: "canceled",
				cancel_reason: "project_changed",
			});
		expect(cached(pull.id).title).toBe("Discovered title");
	});
	test("absence from a successful discovery never retires an observed PR", async () => {
		const { project, pull } = setup();
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, now);
		const discovery = (await enqueueDiscovery(sqlite.db, project, [], now))[0]!;
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
