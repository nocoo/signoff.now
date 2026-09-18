import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import type { Project, PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { addObservation, enqueueDiscovery } from "./observations";
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
});
afterEach(() => sqlite.close());
const repo = {
	id: "repo-1",
	name: "web",
	projectExternalId: "external-project",
};
const cursor = { number: 10, createdAt: now - 100 };
const readCursor = (projectId: string, repositoryId = repo.id) => {
	const row = sqlite.raw
		.query(
			"SELECT discovery_cursor_json FROM workbench_repositories WHERE project_id=? AND repository_id=?",
		)
		.get(projectId, repositoryId) as {
		discovery_cursor_json: string | null;
	} | null;
	return row?.discovery_cursor_json
		? JSON.parse(row.discovery_cursor_json)
		: null;
};
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
async function start(project: Project, at = now, full = false) {
	const receipt = await enqueueDiscovery(sqlite.db, project, [], at, full);
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

test("legacy cache does not establish a discovery boundary; only a successfully published history does", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const cached = seedPull(sqlite, {
		id: adoPullId(project.id, repo.id, "999"),
		number: 999,
		externalId: "999",
		repository: repo,
	});
	const first = await start(project);
	expect(first.plan[0]?.discoveryCursor).toBeNull();
	await publish(first.claim, discovered(cached, 10));
	expect(readCursor(project.id)).toEqual(cursor);
	const next = await start(project, now + 1);
	expect(next.plan[0]?.discoveryCursor).toEqual(cursor);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pr_observations").get(),
	).toEqual({ n: 0 });
});

test("each project and repository keeps its own successful boundary", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const other = seedProject(sqlite, {
		id: "other",
		organization: "another",
		repositories: [],
	});
	const next = await start(other);
	expect(next.plan[0]?.discoveryCursor).toBeNull();
	expect(readCursor(project.id)).toEqual(cursor);
	await registerJobRepositories(
		sqlite.db,
		next.claim.job.id,
		next.claim.leaseToken,
		[repo],
		now,
	);
	expect(readCursor(other.id)).toBeNull();
});

test("an individually watched newer PR never advances repository discovery", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const newer = seedPull(sqlite, discovered(pull, 999, now - 10));
	const added = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: newer.id },
		now + 1,
	);
	const claim = (await claimJob(sqlite.db, now + 1, { jobId: added.job!.id }))!;
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo],
		now + 1,
	);
	await stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [newer], now + 1);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		repo.id,
		1,
		"complete",
		"Checks",
		now + 1,
	);
	expect(readCursor(project.id)).toEqual(cursor);
	expect((await start(project, now + 2)).plan[0]?.discoveryCursor).toEqual(
		cursor,
	);
});

test("cursor and candidate publication roll back together if the database write fails", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const { claim } = await start(project, now + 1);
	const next = discovered(pull, 11, now - 50);
	await stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [next], now + 1);
	sqlite.raw.exec(
		"CREATE TRIGGER reject_cursor BEFORE UPDATE OF discovery_cursor_json ON workbench_repositories BEGIN SELECT RAISE(ABORT,'Injected cursor failure'); END",
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
	).rejects.toThrow("Injected cursor failure");
	expect(readCursor(project.id)).toEqual(cursor);
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
] as const)("%s discovery cannot advance the last successful boundary", async (outcome) => {
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
	expect(readCursor(project.id)).toEqual(cursor);
});

test("authentication retry freezes its original boundary and an old lease cannot publish", async () => {
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
	expect(plan[0]?.discoveryCursor).toEqual(cursor);
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
	expect(readCursor(project.id)).toEqual(cursor);
	await publish(retry, discovered(pull, 11, now - 50), now + 20);
	expect(readCursor(project.id)).toEqual({ number: 11, createdAt: now - 50 });
});

test("full discovery bypasses the boundary without coalescing with an incremental command", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await publish((await start(project)).claim, discovered(pull, 10));
	const incremental = await enqueueDiscovery(sqlite.db, project, [], now + 1);
	const full = await enqueueDiscovery(sqlite.db, project, [], now + 1, true);
	expect(full.id).not.toBe(incremental.id);
	expect(
		(await enqueueDiscovery(sqlite.db, project, [], now + 1, true)).id,
	).toBe(full.id);
	const claim = (await claimJob(sqlite.db, now + 1, { jobId: full.id }))!;
	const plan = await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo],
		now + 1,
	);
	expect(plan[0]?.discoveryCursor).toBeNull();
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		repo.id,
		0,
		"complete",
		"No returned PRs",
		now + 1,
	);
	expect(readCursor(project.id)).toEqual(cursor);
});
