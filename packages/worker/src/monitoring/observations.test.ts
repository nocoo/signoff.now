import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeWatchRef } from "@signoff/domain/monitoring";
import { seedProject, seedPull } from "../test/pr-fixture";
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
	resolvePull,
	resolveRepository,
} from "./observations";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
function fixture() {
	const project = seedProject(sqlite, { repositories: ["web-app"] });
	const pull = seedPull(sqlite, { draft: true });
	return {
		project,
		pull,
		url: makeWatchRef(project, pull.repository, pull.number).url,
	};
}
const count = (table: string) =>
	(
		sqlite.raw.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
			n: number;
		}
	).n;

describe("shared observation commands", () => {
	test("unsupported live providers, stale cached scope and unresolved IDs never create work", async () => {
		const { project, pull } = fixture();
		await expect(
			addObservation(sqlite.db, "cli", { pullId: "missing" }, 100),
		).rejects.toMatchObject({ code: "CACHE_MISS" });
		const outside = seedPull(sqlite, {
			id: "outside",
			number: 2,
			externalId: "2",
			repository: { id: "outside", name: "outside" },
		});
		await expect(
			resolvePull(sqlite.db, "cli", { pullId: outside.id }),
		).rejects.toMatchObject({ code: "REPOSITORY_NOT_TRACKED" });
		seedProject(sqlite, {
			id: "github",
			provider: "github",
			organization: "github.com",
			projectKey: "nocoo",
			repositories: [],
		});
		const gh = seedPull(sqlite, { id: "github-pull", projectId: "github" });
		await expect(
			addObservation(sqlite.db, "cli", { pullId: gh.id }, 100),
		).rejects.toMatchObject({ code: "PROVIDER_UNSUPPORTED" });
		sqlite.raw
			.query(
				"UPDATE pull_requests SET snapshot=json_set(snapshot,'$.projectId','removed') WHERE id=?",
			)
			.run(pull.id);
		await expect(
			resolvePull(sqlite.db, "cli", { pullId: pull.id }),
		).rejects.toMatchObject({ code: "REPOSITORY_NOT_TRACKED" });
		expect(count("collection_jobs")).toBe(0);
		await expect(
			enqueueDiscovery(sqlite.db, { ...project, revision: 999 }, [], 100),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
	test("ambiguous old repository aliases never silently choose another watched PR", async () => {
		const project = seedProject(sqlite, { repositories: [] });
		const first = seedPull(sqlite);
		const second = seedPull(sqlite, {
			id: "second-repo-pr",
			repository: { id: "repo-2", name: "another" },
		});
		await addObservation(sqlite.db, "cli", { pullId: first.id }, 100);
		await addObservation(sqlite.db, "cli", { pullId: second.id }, 100);
		sqlite.raw.exec(
			"UPDATE workbench_repositories SET aliases_json='[\"old-name\"]'",
		);
		const repositoryUrl = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/old-name`;
		await expect(
			resolveRepository(sqlite.db, "cli", repositoryUrl),
		).rejects.toMatchObject({ code: "REFERENCE_AMBIGUOUS" });
		await expect(
			resolveObservation(sqlite.db, "cli", {
				url: `${repositoryUrl}/pullrequest/1`,
			}),
		).rejects.toMatchObject({ code: "REFERENCE_AMBIGUOUS" });
		await expect(
			refreshObserved(
				sqlite.db,
				"cli",
				{ url: `${repositoryUrl}/pullrequest/1` },
				100,
			),
		).rejects.toMatchObject({ code: "REFERENCE_AMBIGUOUS" });
	});
	test("Draft is eligible; URL and cached ID share a single record and first job", async () => {
		const { pull, url } = fixture();
		const first = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			100,
		);
		expect(first.status).toBe("added");
		expect(first.observation).toMatchObject({
			active: true,
			generation: 1,
			addedAt: 100,
			pullId: pull.id,
		});
		expect(first.job).toMatchObject({
			kind: "refresh",
			state: "queued",
			coalesced: false,
		});
		const again = await addObservation(sqlite.db, "cli", { url }, 200);
		expect(again.status).toBe("already_observed");
		expect(again.observation).toEqual(first.observation);
		expect(again.job).toMatchObject({ id: first.job?.id, coalesced: true });
		expect(count("pr_observations")).toBe(1);
		expect(count("collection_jobs")).toBe(1);
		expect(
			await resolveObservation(sqlite.db, "cli", {
				url: url.replace("web-app", "repo-1"),
			}),
		).toEqual(first.observation);
	});
	test("already watched without active work does not bypass the cooldown", async () => {
		const { url } = fixture();
		const first = await addObservation(sqlite.db, "cli", { url }, 100);
		sqlite.raw
			.query(
				"UPDATE collection_jobs SET state='complete',completed_at=150 WHERE id=?",
			)
			.run(first.job!.id);
		const before = sqlite.raw
			.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
			.get();
		expect(
			(await addObservation(sqlite.db, "cli", { url }, 200)).job,
		).toBeNull();
		expect(
			sqlite.raw
				.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
				.get(),
		).toEqual(before);
		expect(count("collection_jobs")).toBe(1);
	});
	test("manual removal is idempotent, retains cache, and stale removal cannot affect a new generation", async () => {
		const { url } = fixture();
		const added = await addObservation(sqlite.db, "cli", { url }, 100);
		const { id, generation } = added.observation;
		expect(
			(await removeObservation(sqlite.db, "cli", id, generation, 200)).status,
		).toBe("removed");
		expect(
			(await removeObservation(sqlite.db, "cli", id, generation, 201)).status,
		).toBe("already_stopped");
		expect(count("pull_requests")).toBe(1);
		expect(
			sqlite.raw.query("SELECT state,cancel_reason FROM collection_jobs").get(),
		).toEqual({ state: "canceled", cancel_reason: "observation_removed" });
		const next = await addObservation(sqlite.db, "cli", { url }, 300);
		expect(next.observation).toMatchObject({ id, active: true, generation: 2 });
		expect(
			(await removeObservation(sqlite.db, "cli", id, generation, 301)).status,
		).toBe("conflict");
		expect(
			(await resolveObservation(sqlite.db, "cli", { url })).generation,
		).toBe(2);
		expect(
			(await removeObservation(sqlite.db, "demo", id, 2, 302)).status,
		).toBe("not_found");
	});
	test("repository identity must be known, but a PR can await its first snapshot", async () => {
		const { project, url } = fixture();
		const pending = await addObservation(
			sqlite.db,
			"cli",
			{ url: url.replace(/\/1$/, "/999") },
			100,
		);
		expect(pending.observation.pullId).toBeNull();
		expect(pending.job).not.toBeNull();
		seedProject(sqlite, {
			id: "new",
			projectKey: "Unknown",
			repositories: ["web"],
		});
		await expect(
			addObservation(
				sqlite.db,
				"cli",
				{
					url: "https://dev.azure.com/test-org/Unknown/_git/web/pullrequest/1",
				},
				100,
			),
		).rejects.toMatchObject({ code: "REFERENCE_UNRESOLVED" });
		await expect(
			addObservation(
				sqlite.db,
				"cli",
				{
					url: "https://dev.azure.com/untracked/Unknown/_git/web/pullrequest/1",
				},
				100,
			),
		).rejects.toMatchObject({ code: "REPOSITORY_NOT_TRACKED" });
		await expect(
			resolveRepository(
				sqlite.db,
				"cli",
				makeWatchRef(project, { id: "other", name: "other" }, 1).url.replace(
					/\/pullrequest\/1$/,
					"",
				),
			),
		).rejects.toMatchObject({ code: "REPOSITORY_NOT_TRACKED" });
		expect(count("pr_observations")).toBe(1);
	});
	test.each([
		"merged",
		"closed",
	] as const)("known %s PRs cannot be reactivated", async (state) => {
		const { pull } = fixture();
		sqlite.raw
			.query(
				"UPDATE pull_requests SET state=?,snapshot=json_set(snapshot,'$.state',?) WHERE id=?",
			)
			.run(state, state, pull.id);
		await expect(
			addObservation(sqlite.db, "cli", { pullId: pull.id }, 100),
		).rejects.toMatchObject({ code: "PR_TERMINAL" });
		expect(count("pr_observations")).toBe(0);
		expect(count("collection_jobs")).toBe(0);
	});
	test("activation and its first queued job roll back together", async () => {
		const { url } = fixture();
		sqlite.raw.exec(
			"CREATE TRIGGER fail_first_job BEFORE INSERT ON collection_jobs BEGIN SELECT RAISE(ABORT,'injected job failure'); END",
		);
		await expect(
			addObservation(sqlite.db, "cli", { url }, 100),
		).rejects.toThrow("injected job failure");
		expect(count("pr_observations")).toBe(0);
	});
	test("scope changes and deletion stop observations and preserve canceled receipts", async () => {
		const { project, url } = fixture();
		const added = await addObservation(sqlite.db, "cli", { url }, 100);
		sqlite.raw
			.query(
				"UPDATE projects SET enabled=0,revision=revision+1,updated_at=200 WHERE id=?",
			)
			.run(project.id);
		expect((await resolveObservation(sqlite.db, "cli", { url })).active).toBe(
			true,
		);
		expect(
			(await refreshObserved(sqlite.db, "cli", { all: true }, 201)).jobs,
		).toHaveLength(1);
		sqlite.raw.query("DELETE FROM projects WHERE id=?").run(project.id);
		expect(await resolveObservation(sqlite.db, "cli", { url })).toMatchObject({
			id: added.observation.id,
			active: false,
			stopReason: "project_deleted",
			pullId: null,
		});
		expect(count("collection_jobs")).toBe(2);
	});
});

describe("explicit discovery and refresh commands", () => {
	test("repository refresh targets only active watches in that repository", async () => {
		const { project, url, pull } = fixture();
		const repositoryUrl = url.replace(/\/pullrequest\/\d+$/, "");
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			100,
		);
		expect(
			(
				await refreshObserved(sqlite.db, "cli", { repositoryUrl }, 200)
			).jobs.map((j) => j.id),
		).toEqual([added.job!.id]);
		sqlite.raw
			.query("UPDATE projects SET repositories_json='[]' WHERE id=?")
			.run(project.id);
		expect(
			await refreshObserved(
				sqlite.db,
				"cli",
				{ repositoryUrl: repositoryUrl.replace(/[^/]+$/, "unknown") },
				200,
			),
		).toMatchObject({ jobs: [] });
		await removeObservation(sqlite.db, "cli", added.observation.id, 1, 201);
		await expect(
			refreshObserved(sqlite.db, "cli", { url }, 202),
		).rejects.toMatchObject({ code: "NOT_OBSERVED" });
	});
	test("empty refresh is a no-op; discovery is fixed-scope and never adds observations", async () => {
		const { project } = fixture();
		expect(
			(await refreshObserved(sqlite.db, "cli", { all: true }, 100)).jobs,
		).toEqual([]);
		const a = await enqueueDiscovery(sqlite.db, project, ["web-app"], 100);
		const b = await enqueueDiscovery(sqlite.db, project, ["repo-1"], 101);
		expect(a).toMatchObject({
			kind: "discover",
			state: "queued",
			coalesced: false,
		});
		expect(b).toMatchObject({ id: a.id, coalesced: true });
		expect(count("pr_observations")).toBe(0);
		expect(count("collection_jobs")).toBe(1);
	});
	test("refresh only targets active observations and coalesces existing tasks", async () => {
		const { url, pull } = fixture();
		await expect(
			refreshObserved(sqlite.db, "cli", { pullId: pull.id }, 100),
		).rejects.toMatchObject({ code: "NOT_OBSERVED" });
		const added = await addObservation(sqlite.db, "cli", { url }, 100);
		expect(
			(await refreshObserved(sqlite.db, "cli", { url }, 101)).jobs,
		).toMatchObject([{ id: added.job?.id, coalesced: true }]);
		expect(count("collection_jobs")).toBe(1);
	});
	test("two independent connections race activation without duplicating work", async () => {
		const concurrent = createConcurrentSqliteD1();
		try {
			const dbFixture = { ...sqlite, raw: concurrent.raw };
			const project = seedProject(dbFixture, { repositories: ["web-app"] });
			const pull = seedPull(dbFixture);
			const url = makeWatchRef(project, pull.repository, pull.number).url;
			concurrent.barrierBeforeBatch("INSERT INTO pr_observations", 2);
			const results = await Promise.all(
				concurrent.connections.map((db) =>
					addObservation(db, "cli", { url }, 100),
				),
			);
			expect(concurrent.barrierArrivals()).toBe(2);
			expect(results.map((r) => r.status).sort()).toEqual([
				"added",
				"already_observed",
			]);
			expect(new Set(results.map((r) => r.job?.id)).size).toBe(1);
			expect(
				concurrent.raw.query("SELECT COUNT(*) AS n FROM pr_observations").get(),
			).toEqual({ n: 1 });
			concurrent.barrierBeforeBatch("UPDATE pr_observations", 2);
			const removed = await Promise.all(
				concurrent.connections.map((db) =>
					removeObservation(db, "cli", results[0]!.observation.id, 1, 200),
				),
			);
			expect(removed.map((r) => r.status).sort()).toEqual([
				"already_stopped",
				"removed",
			]);
		} finally {
			concurrent.close();
		}
	});
});
