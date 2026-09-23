import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import type { Project, PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { queryCollectorGroups } from "./collector-groups";
import { enqueueDiscovery } from "./observations";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	rejectRepository,
	stagePulls,
} from "./publication";
import { queryJob } from "./query";
import { claimJob, failJob } from "./scheduler";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	sqlite.raw.exec(
		"UPDATE collection_refresh SET cooldown_seconds=0 WHERE kind='list'",
	);
});
afterEach(() => sqlite.close());
const repo = {
	id: "repo-1",
	name: "web",
	projectExternalId: "external-project",
};
const readDiscovery = (projectId: string) =>
	(
		sqlite.raw
			.query(
				"SELECT last_discovered_at FROM workbench_repositories WHERE project_id=? AND repository_id=?",
			)
			.get(projectId, repo.id) as { last_discovered_at: number } | null
	)?.last_discovered_at;
const discovered = (
	pull: PullRequest,
	number: number,
	createdAt = now - 100,
): PullRequest => ({
	...pull,
	id: adoPullId(pull.projectId, repo.id, String(number)),
	externalId: String(number),
	number,
	repository: repo,
	createdAt,
	updatedAt: now,
	observedAt: now,
	checksObservedAt: null,
});
async function start(project: Project, at = now) {
	const receipt = (await enqueueDiscovery(sqlite.db, project, [], at))[0]!;
	const claim = (await claimJob(sqlite.db, at, { jobId: receipt.id }))!;
	const plan = await registerJobRepositories(
		sqlite.db,
		receipt.id,
		claim.leaseToken,
		[repo],
		at,
	);
	return { claim, plan };
}
async function publish(
	claim: NonNullable<Awaited<ReturnType<typeof claimJob>>>,
	pull: PullRequest,
	at = now,
) {
	await stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [pull], at);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		repo.id,
		1,
		"complete",
		"Discovered",
		at,
	);
	await completeJob(sqlite.db, claim.job.id, claim.leaseToken, at);
}

test("repository completion and candidate publication roll back together on failure", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const { claim } = await start(project, now + 1);
	const next = discovered(pull, 11, now - 50);
	await stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [next], now + 1);
	sqlite.raw.exec(
		"CREATE TRIGGER reject_publication BEFORE UPDATE OF last_discovered_at ON workbench_repositories BEGIN SELECT RAISE(ABORT,'Injected publication failure'); END",
	);
	await expect(
		publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			repo.id,
			1,
			"complete",
			"Publish",
			now + 1,
		),
	).rejects.toThrow("Injected publication failure");
	expect(readDiscovery(project.id)).toBe(now);
	expect(
		sqlite.raw.query("SELECT id FROM pull_requests WHERE id=?").get(next.id),
	).toBeNull();
	expect(
		sqlite.raw
			.query("SELECT state FROM collection_job_repositories WHERE job_id=?")
			.get(claim.job.id),
	).toEqual({ state: "queued" });
});

test.each([
	"failed",
	"partial",
	"canceled",
	"snapshot_changed",
] as const)("%s discovery cannot advance the last successful completion", async (outcome) => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const { claim } = await start(project, now + 1);
	const candidate = discovered(pull, 11, now - 50);
	await stagePulls(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[candidate],
		now + 1,
	);
	if (outcome === "failed")
		await rejectRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			repo.id,
			"Lost page",
			now + 1,
		);
	else if (outcome === "partial") {
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				repo.id,
				1,
				"partial",
				"Incomplete enumeration",
				now + 1,
			),
		).rejects.toMatchObject({ code: "INCOMPLETE_UPLOAD", status: 409 });
		expect(
			sqlite.raw
				.query("SELECT id FROM pull_requests WHERE id=?")
				.get(candidate.id),
		).toBeNull();
		expect(
			sqlite.raw
				.query("SELECT state FROM collection_job_repositories WHERE job_id=?")
				.get(claim.job.id),
		).toEqual({ state: "queued" });
	} else {
		if (outcome === "canceled")
			sqlite.raw
				.query("UPDATE projects SET revision=revision+1 WHERE id=?")
				.run(project.id);
		else seedPull(sqlite, candidate);
		await expect(
			publishRepository(
				sqlite.db,
				claim.job.id,
				claim.leaseToken,
				repo.id,
				1,
				"complete",
				"Late response",
				now + 1,
			),
		).rejects.toMatchObject({ status: 409 });
	}
	expect(readDiscovery(project.id)).toBe(now);
});

test("authentication retry retains its repository plan and an old lease cannot publish", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const { claim } = await start(project, now + 1);
	await stagePulls(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[discovered(pull, 11, now - 50)],
		now + 1,
	);
	await failJob(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		"auth_required",
		"Expired",
		now + 1,
	);
	const retry = (await claimJob(sqlite.db, now + 20, { jobId: claim.job.id }))!;
	const plan = await registerJobRepositories(
		sqlite.db,
		retry.job.id,
		retry.leaseToken,
		[{ ...repo, name: "renamed" }],
		now + 20,
	);
	expect(plan[0]?.repository_id).toBe(repo.id);
	await expect(
		publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			repo.id,
			1,
			"complete",
			"Stale",
			now + 20,
		),
	).rejects.toMatchObject({ status: 409 });
	expect(readDiscovery(project.id)).toBe(now);
	await publish(retry, discovered(pull, 11, now - 50), now + 20);
	expect(readDiscovery(project.id)).toBe(now + 20);
});

test("manual discovery coalesces and waits for completion-based cooldown", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	sqlite.raw.exec(
		"UPDATE collection_refresh SET cooldown_seconds=600 WHERE kind='list'",
	);
	const first = (await enqueueDiscovery(sqlite.db, project, [], now + 1))[0]!;
	expect((await enqueueDiscovery(sqlite.db, project, [], now + 2))[0]!.id).toBe(
		first.id,
	);
	expect(first.notBefore).toBe(new Date((now + 600) * 1000).toISOString());
	expect(await claimJob(sqlite.db, now + 599, { jobId: first.id })).toBeNull();
	const claim = (await claimJob(sqlite.db, now + 600, { jobId: first.id }))!;
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo],
		now + 600,
	);
	await publish(
		claim,
		{
			...discovered(pull, 10),
			state: "merged",
			observedAt: now + 600,
			summaryObservedAt: now + 600,
		},
		now + 600,
	);
	expect(
		sqlite.raw
			.query("SELECT state FROM pull_requests WHERE external_id='10'")
			.get(),
	).toEqual({ state: "merged" });
});

test("repository and depth scopes have independent cooldowns and bounded cache windows", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	sqlite.raw
		.query(
			"INSERT INTO workbench_repositories(project_id,repository_id,name) VALUES(?,?,?)",
		)
		.run(project.id, "repo-2", "api");
	sqlite.raw.exec(
		"UPDATE collection_refresh SET cooldown_seconds=600 WHERE kind='list'",
	);
	const queued = await enqueueDiscovery(
		sqlite.db,
		project,
		["repo-1", "repo-2"],
		now,
	);
	expect(queued).toHaveLength(2);
	for (const receipt of queued) {
		const claim = (await claimJob(sqlite.db, now, { jobId: receipt.id }))!;
		expect(claim.discoverySince).toBe(now - 90 * 86400);
		const id = claim.scope![0]!;
		await registerJobRepositories(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			[{ id, name: id }],
			now,
		);
		await publishRepository(
			sqlite.db,
			claim.job.id,
			claim.leaseToken,
			id,
			0,
			"complete",
			"Empty",
			now,
		);
		await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now);
	}
	const smart = await enqueueDiscovery(sqlite.db, project, ["repo-1"], now + 1);
	expect(smart[0]?.notBefore).toBe(new Date((now + 600) * 1000).toISOString());
	const deep = await enqueueDiscovery(
		sqlite.db,
		project,
		["repo-1"],
		now + 1,
		"deep",
	);
	expect(deep[0]?.id).not.toBe(smart[0]?.id);
	const claim = (await claimJob(sqlite.db, now + 1, { jobId: deep[0]!.id }))!;
	expect(claim.discoverySince).toBe(now + 1 - 90 * 86400);
	expect(claim.job.depth).toBe("deep");
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[{ id: "repo-1", name: "repo-1" }],
		now + 1,
	);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		"repo-1",
		0,
		"complete",
		"Deep",
		now + 1,
	);
	await completeJob(sqlite.db, claim.job.id, claim.leaseToken, now + 1);
	expect(
		(await claimJob(sqlite.db, now + 600, { jobId: smart[0]!.id }))
			?.discoverySince,
	).toBe(now + 1 - 30 * 86400);
	const groups = await queryCollectorGroups(
		sqlite.db,
		"cli",
		undefined,
		now + 600,
	);
	expect(
		groups.data
			.filter((group) => group.repository?.id === "repo-1")
			.map((group) => group.depth)
			.sort(),
	).toEqual(["deep", "smart"]);
});

test("catalogue retries retain one child per repository without advancing discovery freshness", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const receipt = (
		await enqueueDiscovery(sqlite.db, project, [], now, "deep")
	)[0]!;
	const claim = (await claimJob(sqlite.db, now, { jobId: receipt.id }))!;
	expect(claim.job.catalogueOnly).toBe(true);
	for (let attempt = 0; attempt < 2; attempt++)
		await registerJobRepositories(
			sqlite.db,
			receipt.id,
			claim.leaseToken,
			[repo, { id: "repo-2", name: "api" }],
			now,
		);
	const queried = await queryJob(sqlite.db, "cli", receipt.id);
	expect(queried.children).toHaveLength(2);
	expect(readDiscovery(project.id)).toBeNull();
	await completeJob(sqlite.db, receipt.id, claim.leaseToken, now);
	for (const child of queried.children)
		expect(await queryJob(sqlite.db, "cli", child)).toMatchObject({
			depth: "deep",
			state: "queued",
			scope: expect.arrayContaining([expect.any(String)]),
		});
});

test("unrestricted discovery refreshes the catalogue after repositories are cached", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	const receipts = await enqueueDiscovery(sqlite.db, project, [], now, "deep");
	expect(receipts).toHaveLength(2);
	const catalogueRow = sqlite.raw
		.query("SELECT id FROM collection_jobs WHERE catalogue_only=1")
		.get() as { id: string };
	const known = receipts.find((receipt) => receipt.id !== catalogueRow.id)!;
	const knownClaim = (await claimJob(sqlite.db, now, { jobId: known.id }))!;
	await registerJobRepositories(
		sqlite.db,
		known.id,
		knownClaim.leaseToken,
		[repo],
		now,
	);
	await publishRepository(
		sqlite.db,
		known.id,
		knownClaim.leaseToken,
		repo.id,
		0,
		"complete",
		"Complete",
		now,
	);
	await completeJob(sqlite.db, known.id, knownClaim.leaseToken, now);
	const claim = (await claimJob(sqlite.db, now, { jobId: catalogueRow.id }))!;
	expect(claim.job.catalogueOnly).toBe(true);
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo, { id: "new-repo", name: "new" }],
		now,
	);
	const children = (await queryJob(sqlite.db, "cli", claim.job.id)).children;
	expect(children).toHaveLength(2);
	expect(
		sqlite.raw
			.query(
				"SELECT scope_key FROM collection_jobs WHERE catalogue_only=0 ORDER BY scope_key",
			)
			.all(),
	).toEqual([{ scope_key: '["new-repo"]' }, { scope_key: '["repo-1"]' }]);
});

test("discovery binds cached versions only inside its ninety-day cohort", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const current = seedPull(sqlite);
	seedPull(sqlite, {
		id: "old",
		number: 2,
		externalId: "2",
		createdAt: now - 120 * 86400,
	});
	const queued = (await enqueueDiscovery(sqlite.db, project, [], now))[0]!;
	const claim = (await claimJob(sqlite.db, now, { jobId: queued.id }))!;
	expect(
		sqlite.raw
			.query("SELECT pull_id FROM collection_claim_bindings WHERE job_id=?")
			.all(claim.job.id),
	).toEqual([{ pull_id: current.id }]);
});

test.each([
	45, 120,
])("smart discovery fills an offline gap of %s days within the ninety-day cap", async (days) => {
	const project = seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	sqlite.raw
		.query(
			"UPDATE workbench_repositories SET last_discovered_at=?,discovery_cursor_json=json_object('createdBefore',?) WHERE project_id=?",
		)
		.run(now - days * 86400, now - days * 86400, project.id);
	const queued = (await enqueueDiscovery(sqlite.db, project, [], now))[0]!;
	const claim = (await claimJob(sqlite.db, now, { jobId: queued.id }))!;
	expect(claim.discoverySince).toBe(now - Math.min(90, days + 30) * 86400);
});

test("smart stopping boundaries advance only after successful discovery and survive failure", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	const initial = await start(project, now);
	expect(initial.claim.discoveryCachedBefore).toBeUndefined();
	await publish(initial.claim, discovered(pull, 10), now + 60);
	const next = await start(project, now + 100);
	expect(next.claim.discoveryCachedBefore).toBe(now);
	await rejectRepository(
		sqlite.db,
		next.claim.job.id,
		next.claim.leaseToken,
		repo.id,
		"Failed",
		now + 110,
	);
	await completeJob(
		sqlite.db,
		next.claim.job.id,
		next.claim.leaseToken,
		now + 110,
	);
	const retry = await start(project, now + 120);
	expect(retry.claim.discoveryCachedBefore).toBe(now);
});

test("deep discovery ignores smart cursors and uncursored caches backfill ninety days", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	sqlite.raw
		.query(
			"UPDATE workbench_repositories SET last_discovered_at=? WHERE project_id=?",
		)
		.run(now - 86400, project.id);
	const initial = await start(project, now);
	expect(initial.claim.discoverySince).toBe(now - 90 * 86400);
	expect(initial.claim.discoveryCachedBefore).toBeUndefined();
	await publish(initial.claim, discovered(pull, 10), now);
	const deep = (
		await enqueueDiscovery(sqlite.db, project, [repo.id], now + 1, "deep")
	)[0]!;
	const claim = (await claimJob(sqlite.db, now + 1, { jobId: deep.id }))!;
	expect(claim.discoverySince).toBe(now + 1 - 90 * 86400);
	expect(claim.discoveryCachedBefore).toBeUndefined();
});
