import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import type { Project, PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { enqueueDiscovery } from "./observations";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	rejectRepository,
	stagePulls,
} from "./publication";
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
	const receipt = await enqueueDiscovery(sqlite.db, project, [], at);
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
	const first = await enqueueDiscovery(sqlite.db, project, [], now + 1);
	expect((await enqueueDiscovery(sqlite.db, project, [], now + 2)).id).toBe(
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
