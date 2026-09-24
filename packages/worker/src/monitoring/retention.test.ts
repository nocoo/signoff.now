import { afterEach, beforeEach, expect, test } from "bun:test";
import app from "../index";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { addObservation } from "./observations";
import { pruneCollectionHistory } from "./scheduler";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [] });
});
afterEach(() => sqlite.close());

function job(
	id: string,
	state: string,
	at: number,
	completed: number | null = at,
) {
	sqlite.raw
		.query(`INSERT INTO collection_jobs(id,project_id,revision,state,requested_at,updated_at,completed_at,kind)
      VALUES(?,'live-project',1,?,?,?,?, 'details')`)
		.run(id, state, 1, at, completed);
}

test("12-hour retention preserves active work, recent completions, watches and PR facts", async () => {
	const now = 100000;
	const cutoff = now - 43200;
	const pull = seedPull(sqlite);
	await addObservation(sqlite.db, "cli", { pullId: pull.id }, now);
	const facts = sqlite.raw.query("SELECT * FROM pull_requests").all();
	const watches = sqlite.raw.query("SELECT * FROM pr_observations").all();
	for (const state of ["complete", "partial", "failed", "canceled"])
		job(state, state, cutoff - 1);
	job("no-completion-clock", "canceled", cutoff - 1, null);
	for (const state of ["queued", "running", "auth_required"])
		job(state, state, 1, null);
	job("boundary", "complete", cutoff);
	job("recent", "complete", now);
	sqlite.raw.exec(`
    INSERT INTO collection_claim_bindings(job_id,pull_id,snapshot_version) VALUES('complete','pull-1',1);
    INSERT INTO collection_job_repositories(job_id,repository_id,name,state) VALUES('complete','repo-1','Repo','succeeded');
    INSERT INTO collection_staging(job_id,pull_id,project_id,repository_id,external_id,state,updated_at,snapshot)
      VALUES('complete','pull-1','live-project','repo-1','1','open',1,'{}');
    INSERT INTO scan_runs(id,project_id,source,state,started_at,completed_at,pull_request_count,message)
      VALUES('old-scan','live-project','cli','complete',1,1,1,'');
  `);
	await pruneCollectionHistory(sqlite.db, now);
	const remaining = sqlite.raw.query("SELECT id FROM collection_jobs").all();
	for (const id of ["boundary", "recent", "queued", "running", "auth_required"])
		expect(remaining).toContainEqual({ id });
	expect(remaining).toHaveLength(6);
	for (const table of [
		"collection_claim_bindings",
		"collection_job_repositories",
		"collection_staging",
		"scan_runs",
	])
		expect(sqlite.raw.query(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
			n: 0,
		});
	expect(sqlite.raw.query("SELECT * FROM pull_requests").all()).toEqual(facts);
	expect(sqlite.raw.query("SELECT * FROM pr_observations").all()).toEqual(
		watches,
	);
});

test("cleanup is bounded and daemon scheduling drains expired history without a browser", async () => {
	for (let i = 0; i < 105; i++) job(`old-${i}`, "complete", 1);
	await pruneCollectionHistory(sqlite.db, 100000);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM collection_jobs").get(),
	).toEqual({ n: 5 });
	const response = await app.request(
		"http://localhost/api/collector/schedule",
		{
			method: "POST",
			headers: { host: "localhost", "content-type": "application/json" },
			body: "{}",
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
	);
	expect(response.status).toBe(200);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM collection_jobs").get(),
	).toEqual({ n: 0 });
});
