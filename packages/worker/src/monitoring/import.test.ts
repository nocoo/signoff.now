import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import type { PullRequest } from "@signoff/domain/workbench";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import {
	addObservation,
	enqueuePullImport,
	removeObservation,
} from "./observations";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	stagePulls,
} from "./publication";
import { queryJob } from "./query";
import { claimJob, failJob } from "./scheduler";

let sqlite: SqliteD1;
const repo = {
	id: "repo-1",
	name: "web-app",
	projectExternalId: "external-project",
};
const url = "https://dev.azure.com/test-org/Platform/_git/web-app";
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [repo.id] });
	sqlite.raw
		.query(
			"INSERT INTO workbench_repositories(project_id,repository_id,name,project_external_id,last_discovered_at,name_observed_at) VALUES(?,?,?,?,?,?)",
		)
		.run(
			"live-project",
			repo.id,
			repo.name,
			repo.projectExternalId,
			now - 10,
			now + 100,
		);
	sqlite.raw
		.query("UPDATE workbench_repositories SET aliases_json=?")
		.run(JSON.stringify([repo.name]));
});
afterEach(() => sqlite.close());
function summary(number: number, overrides: Partial<PullRequest> = {}) {
	const template = seedPull(sqlite, { id: "template" });
	sqlite.raw.query("DELETE FROM pull_requests WHERE id='template'").run();
	return {
		...template,
		id: adoPullId("live-project", repo.id, String(number)),
		externalId: String(number),
		number,
		repository: repo,
		createdAt: now - 120 * 86400,
		updatedAt: now,
		observedAt: now,
		summaryObservedAt: now,
		checksObservedAt: null,
		policies: [],
		builds: [],
		...overrides,
	};
}
async function start(number: number, at = now) {
	const [receipt] = await enqueuePullImport(
		sqlite.db,
		"cli",
		url,
		[number],
		at,
	);
	const claim = (await claimJob(sqlite.db, at, { jobId: receipt!.id }))!;
	expect(claim.job.importNumber).toBe(number);
	expect(claim.discoverySince).toBeUndefined();
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo],
		at,
	);
	return claim;
}
async function publish(
	claim: Awaited<ReturnType<typeof start>>,
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
		"Imported summary",
		at,
	);
	await completeJob(sqlite.db, claim.job.id, claim.leaseToken, at);
	return queryJob(sqlite.db, "cli", claim.job.id);
}
test.each([
	{ state: "open" as const, draft: false },
	{ state: "open" as const, draft: true },
	{ state: "merged" as const, draft: false },
	{ state: "closed" as const, draft: false },
])(
	"imports old $state draft=$draft facts with local identity, no watches or discovery boundary changes",
	async (lifecycle) => {
		const pull = summary(100, lifecycle);
		const before = sqlite.raw
			.query("SELECT * FROM workbench_repositories")
			.all();
		const job = await publish(await start(100), pull);
		expect(job).toMatchObject({
			kind: "import",
			importNumber: 100,
			state: "succeeded",
			result: { id: pull.id, ...lifecycle },
		});
		expect(sqlite.raw.query("SELECT id FROM pull_requests").all()).toEqual([
			{ id: pull.id },
		]);
		expect(sqlite.raw.query("SELECT * FROM pr_observations").all()).toEqual([]);
		expect(
			sqlite.raw.query("SELECT * FROM workbench_repositories").all(),
		).toEqual(before);
	},
);
test.each(["active", "completed", "abandoned", "manual"] as const)(
	"import never changes a %s watch, even for terminal or reopened facts",
	async (reason) => {
		const pull = seedPull(sqlite, summary(101));
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			now - 1,
		);
		if (reason === "manual")
			await removeObservation(
				sqlite.db,
				"cli",
				added.observation.id,
				added.observation.generation,
				now,
			);
		else if (reason !== "active")
			sqlite.raw
				.query(
					"UPDATE pr_observations SET active=0,stop_reason=?,stopped_at=? WHERE id=?",
				)
				.run(reason, now, added.observation.id);
		if (reason === "active")
			sqlite.raw.query("UPDATE ai_evaluations SET status='complete'").run();
		const before = sqlite.raw.query("SELECT * FROM pr_observations").all();
		const ai = sqlite.raw.query("SELECT * FROM ai_evaluations").all() as Record<
			string,
			unknown
		>[];
		const jobs = sqlite.raw
			.query("SELECT id,state FROM collection_jobs ORDER BY id")
			.all();
		await publish(
			await start(101),
			summary(101, { state: reason === "active" ? "merged" : "open" }),
		);
		expect(sqlite.raw.query("SELECT * FROM pr_observations").all()).toEqual(
			before,
		);
		expect(sqlite.raw.query("SELECT * FROM ai_evaluations").all()).toEqual(
			ai.map((row) =>
				reason === "active"
					? {
							...row,
							input_revision:
								(row as { input_revision: number }).input_revision + 1,
						}
					: row,
			),
		);
		expect(
			sqlite.raw
				.query(
					"SELECT id,state FROM collection_jobs WHERE import_number IS NULL ORDER BY id",
				)
				.all(),
		).toEqual(jobs);
	},
);
test("preserves richer/newer cached facts and rebases a concurrent publication", async () => {
	const rich = seedPull(sqlite, { id: "rich" });
	const cached = seedPull(
		sqlite,
		summary(102, {
			title: "Newer",
			policies: rich.policies,
			builds: rich.builds,
			observedAt: now + 10,
			summaryObservedAt: now + 10,
			checksObservedAt: now + 10,
			headSha: "head",
			targetSha: "target",
			comments: 42,
		}),
	);
	const claim = await start(102);
	await stagePulls(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[summary(102, { title: "Older", headSha: "head", targetSha: "target" })],
		now,
	);
	sqlite.raw.query("UPDATE pull_requests SET snapshot=? WHERE id=?").run(
		JSON.stringify({
			...cached,
			title: "Newest",
			summaryObservedAt: now + 20,
			observedAt: now + 20,
		}),
		cached.id,
	);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		repo.id,
		1,
		"complete",
		"Imported",
		now,
	);
	const row = sqlite.raw
		.query("SELECT snapshot FROM pull_requests WHERE id=?")
		.get(cached.id) as { snapshot: string };
	expect(JSON.parse(row.snapshot)).toMatchObject({
		title: "Newest",
		comments: 42,
		policies: rich.policies,
		builds: rich.builds,
		checksObservedAt: now + 10,
	});
});
test("compatible summary refresh preserves checks and repository metadata uses its independent clock", async () => {
	const rich = seedPull(sqlite, {
		id: "rich",
		headSha: "head",
		targetSha: "target",
		checksObservedAt: now - 10,
	});
	const cached = seedPull(
		sqlite,
		summary(105, {
			policies: rich.policies,
			builds: rich.builds,
			headSha: "head",
			targetSha: "target",
			observedAt: now - 10,
			summaryObservedAt: now - 10,
			checksObservedAt: now - 10,
		}),
	);
	await publish(
		await start(105),
		summary(105, {
			title: "Fresh summary",
			headSha: "head",
			targetSha: "target",
			repository: { ...repo, name: "Older name" },
		}),
	);
	const row = sqlite.raw
		.query("SELECT snapshot FROM pull_requests WHERE id=?")
		.get(cached.id) as { snapshot: string };
	expect(JSON.parse(row.snapshot)).toMatchObject({
		title: "Fresh summary",
		policies: rich.policies,
		builds: rich.builds,
		checksObservedAt: now - 10,
	});
	expect(
		sqlite.raw
			.query("SELECT name,name_observed_at FROM workbench_repositories")
			.get(),
	).toEqual({ name: repo.name, name_observed_at: now + 100 });
	const later = summary(106, {
		summaryObservedAt: now + 200,
		observedAt: now + 200,
		repository: { ...repo, name: "New name" },
	});
	await publish(await start(106, now + 200), later, now + 200);
	expect(
		sqlite.raw
			.query("SELECT name,name_observed_at FROM workbench_repositories")
			.get(),
	).toEqual({ name: "New name", name_observed_at: now + 200 });
});
test("expired leases and project revisions fence import; a published repository can finish after reclaim", async () => {
	const claim = await start(107);
	await stagePulls(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[summary(107)],
		now,
	);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		repo.id,
		1,
		"complete",
		"Imported",
		now,
	);
	sqlite.raw
		.query("UPDATE collection_jobs SET lease_expires_at=? WHERE id=?")
		.run(now, claim.job.id);
	const reclaimed = (await claimJob(sqlite.db, now + 1, {
		jobId: claim.job.id,
	}))!;
	await expect(
		completeJob(sqlite.db, claim.job.id, claim.leaseToken, now + 1),
	).rejects.toMatchObject({ code: "LEASE_LOST" });
	await completeJob(sqlite.db, reclaimed.job.id, reclaimed.leaseToken, now + 1);
	expect(await queryJob(sqlite.db, "cli", claim.job.id)).toMatchObject({
		state: "succeeded",
		result: { number: 107 },
	});
	const stale = await start(108, now + 2);
	sqlite.raw.exec("UPDATE projects SET revision=revision+1");
	await expect(
		stagePulls(
			sqlite.db,
			stale.job.id,
			stale.leaseToken,
			[summary(108)],
			now + 2,
		),
	).rejects.toMatchObject({ code: "LEASE_LOST" });
	expect(
		sqlite.raw
			.query("SELECT id FROM pull_requests WHERE external_id='108'")
			.get(),
	).toBeNull();
});
test("validates source, registered scope and exact numbers before queueing; deduplicates and safely retries", async () => {
	await expect(
		enqueuePullImport(sqlite.db, "demo", url, [1], now),
	).rejects.toMatchObject({ code: "SAMPLE_READ_ONLY" });
	for (const numbers of [[], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
		await expect(
			enqueuePullImport(sqlite.db, "cli", url, numbers, now),
		).rejects.toThrow();
	}
	await expect(
		enqueuePullImport(
			sqlite.db,
			"cli",
			url.replace("web-app", "foreign"),
			[1],
			now,
		),
	).rejects.toThrow();
	const first = await enqueuePullImport(
		sqlite.db,
		"cli",
		url,
		[103, 104, 103],
		now,
	);
	const second = await enqueuePullImport(
		sqlite.db,
		"cli",
		url,
		[104, 103],
		now,
	);
	expect(first.map((j) => j.importNumber)).toEqual([103, 104]);
	expect(second.map((j) => j.id)).toEqual(first.map((j) => j.id));
	expect(second.every((j) => j.coalesced)).toBe(true);
	const claim = (await claimJob(sqlite.db, now, { jobId: first[0]!.id }))!;
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[repo],
		now,
	);
	await expect(
		stagePulls(sqlite.db, claim.job.id, claim.leaseToken, [summary(999)], now),
	).rejects.toMatchObject({ code: "INVALID_PULL" });
	await publish(claim, summary(103));
	const failed = (await claimJob(sqlite.db, now, { jobId: first[1]!.id }))!;
	await failJob(
		sqlite.db,
		failed.job.id,
		failed.leaseToken,
		"not_found",
		"Missing PR",
		now,
	);
	expect(await queryJob(sqlite.db, "cli", failed.job.id)).toMatchObject({
		importNumber: 104,
		state: "failed",
		error: "not_found",
		result: null,
	});
	expect(
		sqlite.raw.query("SELECT external_id FROM pull_requests").all(),
	).toEqual([{ external_id: "103" }]);
	const retry = await enqueuePullImport(
		sqlite.db,
		"cli",
		url,
		[103, 104],
		now + 1,
	);
	expect(retry.map((j) => j.id)).not.toEqual(first.map((j) => j.id));
	expect(
		(await claimJob(sqlite.db, now + 1, { jobId: retry[0]!.id }))?.job
			.importNumber,
	).toBe(103);
});
test("rejects unsupported Live providers and disabled projects without queued work", async () => {
	seedProject(sqlite, {
		id: "github-project",
		provider: "github",
		organization: "github.com",
		projectKey: "owner",
		repositories: ["repo-gh"],
	});
	sqlite.raw
		.query(
			"INSERT INTO workbench_repositories(project_id,repository_id,name,project_external_id) VALUES(?,?,?,?)",
		)
		.run("github-project", "repo-gh", "repo-gh", "owner");
	await expect(
		enqueuePullImport(
			sqlite.db,
			"cli",
			"https://github.com/owner/repo-gh",
			[1],
			now,
		),
	).rejects.toMatchObject({ code: "PROVIDER_UNSUPPORTED" });
	sqlite.raw.exec("UPDATE projects SET enabled=0 WHERE id='live-project'");
	await expect(
		enqueuePullImport(sqlite.db, "cli", url, [1], now),
	).rejects.toMatchObject({ code: "REFERENCE_UNRESOLVED" });
	expect(sqlite.raw.query("SELECT * FROM collection_jobs").all()).toEqual([]);
});
