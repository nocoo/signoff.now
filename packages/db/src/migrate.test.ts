import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DB_SCHEMA_VERSION } from "./index.ts";
import {
	applyMigrations,
	defaultMigrationsDir,
	listMigrationFiles,
	openMemoryDb,
} from "./migrate.ts";

const migrationsDir = defaultMigrationsDir();

describe("D1 migrations", () => {
	test("lists ordered migration files", () => {
		const files = listMigrationFiles(migrationsDir);
		expect(files[0]).toBe("0001_initial.sql");
		expect(files).toContain("0002_correctness_and_indexes.sql");
		expect(files).toContain("0003_repo_guid_and_score_index.sql");
		expect(files).toContain("0004_repo_project_guid.sql");
		expect(files).toContain("0005_normalize_activity_weights.sql");
		expect(files).toContain("0006_ingest_run_states.sql");
		expect(files).toContain("0007_dashboard_indexes.sql");
		expect(files).toContain("0008_align_ingest_run_index.sql");
		expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
	});

	test("DB_SCHEMA_VERSION matches highest migration number", () => {
		const files = listMigrationFiles(migrationsDir);
		const max = Math.max(
			...files.map((f) => Number.parseInt(f.slice(0, 4), 10)),
		);
		expect(DB_SCHEMA_VERSION).toBe(max);
	});

	test("applies full suite on empty database", () => {
		const db = openMemoryDb();
		const applied = applyMigrations(db, migrationsDir);
		expect(applied).toEqual(listMigrationFiles(migrationsDir));

		const tables = db
			.query<{ name: string }, []>(
				`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
			)
			.all()
			.map((r) => r.name);

		for (const required of [
			"settings",
			"developers",
			"teams",
			"tags",
			"developer_teams",
			"developer_tags",
			"repos",
			"activities",
			"scores",
			"unmatched_identities",
			"ingest_runs",
			"ingest_chunks",
			"schema_migrations",
		]) {
			expect(tables).toContain(required);
		}
	});

	test("seeds settings defaults and config version keys", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		const keys = db
			.query<{ key: string }, []>(`SELECT key FROM settings ORDER BY key`)
			.all()
			.map((r) => r.key);

		expect(keys).toContain("timezone");
		expect(keys).toContain("email_suffixes");
		expect(keys).toContain("activity_weights");
		expect(keys).toContain("pipeline_config_version");
		expect(keys).toContain("scores_stale");
		expect(keys).toContain("scores_stale_reason");

		const timezone = db
			.query<{ value: string }, []>(
				`SELECT value FROM settings WHERE key = 'timezone'`,
			)
			.get();
		expect(JSON.parse(timezone?.value ?? "")).toBe("Asia/Shanghai");

		const version = db
			.query<{ value: string }, []>(
				`SELECT value FROM settings WHERE key = 'pipeline_config_version'`,
			)
			.get();
		expect(JSON.parse(version?.value ?? "0")).toBe(1);
	});

	test("projects start in the default tenant and cannot reference a missing one", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);
		db.query(
			`INSERT INTO projects (id, provider, name, organization, project_key, owner, source, created_at, updated_at)
			VALUES ('p1', 'ado', 'Web', 'org', 'Web', 'Maya', 'cli', 1, 1)`,
		).run();
		expect(
			db.query("SELECT tenant_id FROM projects WHERE id = 'p1'").get(),
		).toEqual({ tenant_id: "default" });
		expect(() =>
			db
				.query("UPDATE projects SET tenant_id = 'missing' WHERE id = 'p1'")
				.run(),
		).toThrow("Project tenant does not exist");
		expect(() =>
			db
				.query(
					`INSERT INTO projects (id, provider, name, organization, project_key, owner, source, created_at, updated_at, tenant_id)
				VALUES ('p2', 'ado', 'Api', 'org', 'Api', 'Maya', 'cli', 1, 1, 'missing')`,
				)
				.run(),
		).toThrow("Project tenant does not exist");
		expect(() =>
			db.query("DELETE FROM tenants WHERE id = 'default'").run(),
		).toThrow("Tenant still has projects");
		db.query("DELETE FROM projects").run();
		db.query("DELETE FROM tenants WHERE id = 'default'").run();
		expect(db.query("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({
			n: 0,
		});
	});

	test("rejects invalid JSON in settings.value", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);
		expect(() => {
			db.query(
				`INSERT INTO settings (key, value) VALUES ('bad', 'not-json')`,
			).run();
		}).toThrow();
	});

	test("soft-delete allows reuse of archived alias and blocks hard delete with activities", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		db.query(
			`INSERT INTO developers (id, name, alias) VALUES ('d1', 'Ada', 'ada')`,
		).run();
		db.query(
			`UPDATE developers SET archived_at = unixepoch() WHERE id = 'd1'`,
		).run();
		db.query(
			`INSERT INTO developers (id, name, alias) VALUES ('d2', 'Ada 2', 'ada')`,
		).run();

		db.query(
			`INSERT INTO activities (
				id, developer_id, type, occurred_at, day_key, config_version,
				provider, org, project, external_ref, source_ids_json
			) VALUES (
				'a1', 'd2', 'pr.created', 1, '2026-01-01', 1,
				'ado', 'org', 'proj', 'ado:pr:repoguid:1:created',
				'{"prRepoGuid":"11111111-1111-4111-8111-111111111111","prId":1}'
			)`,
		).run();

		expect(() => {
			db.query(`DELETE FROM developers WHERE id = 'd2'`).run();
		}).toThrow();
	});

	test("restricts hard delete of repo referenced by activities", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		db.query(
			`INSERT INTO developers (id, name, alias) VALUES ('d1', 'Ada', 'ada')`,
		).run();
		db.query(
			`INSERT INTO repos (id, provider, org, project, name, external_id)
			 VALUES ('r1', 'ado', 'org', 'proj', 'repo', 'repo-guid-1')`,
		).run();
		db.query(
			`INSERT INTO activities (
				id, developer_id, type, occurred_at, day_key, config_version,
				provider, org, project, repo_id, external_ref, source_ids_json
			) VALUES (
				'a1', 'd1', 'pr.created', 1, '2026-01-01', 1,
				'ado', 'org', 'proj', 'r1', 'ado:pr:repo-guid-1:1:created',
				'{"prRepoGuid":"11111111-1111-4111-8111-111111111111","prId":1}'
			)`,
		).run();

		expect(() => {
			db.query(`DELETE FROM repos WHERE id = 'r1'`).run();
		}).toThrow();
	});

	test("external_id is globally unique including archived rows", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		db.query(
			`INSERT INTO repos (id, provider, org, project, name, external_id)
			 VALUES ('r1', 'ado', 'o', 'p', 'n1', 'guid-1')`,
		).run();
		db.query(
			`UPDATE repos SET archived_at = unixepoch() WHERE id = 'r1'`,
		).run();

		// Must not insert a second row with same GUID — re-enable r1 instead
		expect(() => {
			db.query(
				`INSERT INTO repos (id, provider, org, project, name, external_id)
				 VALUES ('r2', 'ado', 'o', 'p', 'n2', 'guid-1')`,
			).run();
		}).toThrow();

		// Re-enable archived row
		db.query(
			`UPDATE repos SET archived_at = NULL, enabled = 1 WHERE id = 'r1'`,
		).run();
		const row = db
			.query<{ id: string }, []>(
				`SELECT id FROM repos WHERE external_id = 'guid-1' AND archived_at IS NULL`,
			)
			.get();
		expect(row?.id).toBe("r1");
	});

	test("ADO active enabled repo requires external_id", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		expect(() => {
			db.query(
				`INSERT INTO repos (id, provider, org, project, name, external_id, enabled)
				 VALUES ('r1', 'ado', 'o', 'p', 'n1', NULL, 1)`,
			).run();
		}).toThrow();

		// disabled without guid ok
		db.query(
			`INSERT INTO repos (id, provider, org, project, name, external_id, enabled)
			 VALUES ('r2', 'ado', 'o', 'p', 'n2', NULL, 0)`,
		).run();
	});

	test("required indexes exist including scores config_day_dev", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		const indexes = db
			.query<{ name: string }, []>(
				`SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL`,
			)
			.all()
			.map((r) => r.name);

		for (const name of [
			"idx_developer_teams_team",
			"idx_developer_tags_tag",
			"idx_activities_developer_day_occ",
			"idx_repos_provider_external_id",
			"idx_developers_alias_active",
			"idx_activities_config_version",
			"idx_scores_config_day_dev",
			"idx_activities_config_day_type",
			"idx_ingest_runs_config_status_finished",
		]) {
			expect(indexes).toContain(name);
		}
	});

	test("dashboard aggregates use an index rather than scanning", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		const plan = (sql: string) =>
			db
				.query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${sql}`)
				.all()
				.map((r) => r.detail)
				.join(" | ");

		// Without the composite index this picks idx_activities_config_version
		// and walks every row of the version before filtering dates (08 §3.5).
		const byType = plan(
			`SELECT type, COUNT(*) FROM activities
			 WHERE config_version = 1 AND day_key BETWEEN '2026-07-01' AND '2026-07-26'
			 GROUP BY type`,
		);
		expect(byType).toContain("idx_activities_config_day_type");
		expect(byType).not.toContain("SCAN activities");

		const lastIngest = plan(
			`SELECT MAX(finished_at) FROM ingest_runs
			 WHERE config_version = 1 AND status = 'finalized'`,
		);
		expect(lastIngest).toContain("idx_ingest_runs_config_status_finished");
		expect(lastIngest).not.toContain("SCAN ingest_runs");

		// Score aggregates already had their index from 0003.
		const totals = plan(
			`SELECT SUM(total) FROM scores
			 WHERE config_version = 1 AND day_key BETWEEN '2026-07-01' AND '2026-07-26'`,
		);
		expect(totals).toContain("idx_scores_config_day_dev");
	});

	test("query plan uses composite index for developer day heatmap path", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		db.query(
			`INSERT INTO developers (id, name, alias) VALUES ('d1', 'Ada', 'ada')`,
		).run();
		db.query(
			`INSERT INTO scores (developer_id, day_key, config_version, total, breakdown_json, activity_count)
			 VALUES ('d1', '2026-01-01', 1, 10, '{"pr.created":2}', 1)`,
		).run();

		const plan = db
			.query(
				`EXPLAIN QUERY PLAN
				 SELECT day_key, total FROM scores
				 WHERE developer_id = 'd1' AND day_key >= '2026-01-01' AND day_key <= '2026-12-31'
				 ORDER BY day_key`,
			)
			.all() as Array<{ detail: string }>;

		const details = plan.map((p) => p.detail).join(" | ");
		expect(details.toLowerCase()).toMatch(
			/scores|primary|developer_id|day_key/,
		);
	});

	test("explicit import migration preserves cached PRs, watches, collections and pending jobs", () => {
		const db = openMemoryDb();
		try {
			const migration = "0048_explicit_pull_import.sql";
			for (const file of listMigrationFiles(migrationsDir).filter(
				(name) => name < migration,
			))
				db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
			db.exec(`
				INSERT INTO projects(id,provider,name,organization,project_key,owner,source,created_at,updated_at)
				VALUES('p','ado','Project','org','project','owner','cli',1,1);
				INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot)
				VALUES('pr','p','repo','1','open',1,'{"repository":{"name":"Repo"},"observedAt":1}');
				INSERT INTO pr_observations(id,identity,activation_token,source,project_id,ref_json,pull_id,generation,active,added_at)
				VALUES('watch','key','activation','cli','p','{}','pr',1,1,1);
				INSERT INTO pr_collections(id,source,name,color,icon,created_at,updated_at)
				VALUES('collection','cli','Collection','blue','folder',1,1);
				INSERT INTO pr_collection_members(collection_id,pull_id,added_at) VALUES('collection','pr',1);
				INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,scope_json,scope_key)
				VALUES('job','p',1,'cli','{}','queued',1,1,1,'list','["repo"]','["repo"]');
			`);
			const tables = [
				"pull_requests",
				"pr_observations",
				"pr_collections",
				"pr_collection_members",
				"workbench_repositories",
			];
			const before = tables.map((table) =>
				db.query(`SELECT * FROM ${table}`).all(),
			);
			const jobs = db
				.query("SELECT id,state,not_before,scope_key FROM collection_jobs")
				.all();
			db.exec(readFileSync(path.join(migrationsDir, migration), "utf8"));
			expect(
				tables.map((table) => db.query(`SELECT * FROM ${table}`).all()),
			).toEqual(before);
			expect(
				db
					.query("SELECT id,state,not_before,scope_key FROM collection_jobs")
					.all(),
			).toEqual(jobs);
			expect(
				db
					.query("SELECT import_number FROM collection_jobs WHERE id='job'")
					.get(),
			).toEqual({ import_number: null });
		} finally {
			db.close();
		}
	});

	test("search_text migration backfills existing snapshots and syncs on insert and update without extra revision churn", () => {
		const db = openMemoryDb();
		try {
			const migration = "0049_pr_search_text.sql";
			for (const file of listMigrationFiles(migrationsDir).filter(
				(name) => name < migration,
			))
				db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
			const existingSnapshot = JSON.stringify({
				title: "Rotate Auth Secret",
				description: "锁定证书轮换脚本",
				sourceBranch: "release/omts-bleu",
				targetBranch: "main",
				author: { id: "u1", name: "Alice", handle: "alice@example.com" },
				repository: { id: "r1", name: "CoreRepo" },
				headSha: "deadbeef1234",
				labels: ["security"],
				reviewers: [{ name: "Bob", handle: "bob@example.com" }],
				policies: [{ name: "RequiredReview", detail: "Minimum 2" }],
				builds: [{ name: "CI-Build", number: "98" }],
				activity: [{ actor: "Alice", title: "Opened", detail: "Initial push" }],
				observedAt: 1,
			});
			db.exec(`
				INSERT INTO projects(id,provider,name,organization,project_key,owner,source,created_at,updated_at)
				VALUES('p','ado','Project','org','project','owner','cli',1,1);
				INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot)
				VALUES('pr-1','p','r1','101','open',1,'${existingSnapshot}');
			`);
			const beforeVersion = db
				.query("SELECT version FROM pull_requests WHERE id='pr-1'")
				.get() as { version: number };
			const beforeRev = db
				.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
				.get() as { revision: number };

			db.exec(readFileSync(path.join(migrationsDir, migration), "utf8"));

			expect(
				db.query("SELECT version FROM pull_requests WHERE id='pr-1'").get(),
			).toEqual(beforeVersion);
			expect(
				db
					.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
					.get(),
			).toEqual(beforeRev);

			const backfilled = db
				.query("SELECT search_text FROM pull_requests WHERE id='pr-1'")
				.get() as { search_text: string };
			for (const token of [
				"rotate auth secret",
				"#101",
				"锁定证书轮换脚本",
				"release/omts-bleu",
				"alice@example.com",
				"corerepo",
				"deadbeef1234",
				"security",
				"bob@example.com",
				"requiredreview",
				"ci-build 98",
				"initial push",
			])
				expect(backfilled.search_text).toContain(token);

			db.exec(`
				INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot)
				VALUES('pr-2','p','r1','202','merged',2,'{"title":"Inserted PR","sourceBranch":"feat/锁","repository":{"name":"Repo"},"author":{"id":"u2","name":"Cara"},"observedAt":2}');
			`);
			const inserted = db
				.query("SELECT version, search_text FROM pull_requests WHERE id='pr-2'")
				.get() as { version: number; search_text: string };
			expect(inserted.version).toBe(1);
			expect(inserted.search_text).toContain("inserted pr");
			expect(inserted.search_text).toContain("#202");
			expect(inserted.search_text).toContain("feat/锁");

			const revBeforeSnapshotUpdate = db
				.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
				.get() as { revision: number };
			db.exec(`
				UPDATE pull_requests
				SET snapshot=json_set(snapshot,'$.title','Updated Title','$.labels',json('["urgent"]'))
				WHERE id='pr-2';
			`);
			const updated = db
				.query("SELECT version, search_text FROM pull_requests WHERE id='pr-2'")
				.get() as { version: number; search_text: string };
			expect(updated.version).toBe(2);
			expect(updated.search_text).toContain("updated title");
			expect(updated.search_text).toContain("urgent");
			expect(
				db
					.query("SELECT revision FROM workbench_revisions WHERE source='cli'")
					.get(),
			).toEqual({ revision: revBeforeSnapshotUpdate.revision + 1 });
		} finally {
			db.close();
		}
	});

	test("idempotent re-apply skips already applied migrations", () => {
		const db = openMemoryDb();
		const first = applyMigrations(db, migrationsDir);
		const second = applyMigrations(db, migrationsDir);
		expect(first.length).toBeGreaterThan(0);
		expect(second).toEqual([]);
	});

	test("rolls back and rethrows when a migration fails", () => {
		const db = openMemoryDb();
		const dir = mkdtempSync(path.join(tmpdir(), "signoff-db-rollback-"));
		try {
			writeFileSync(
				path.join(dir, "0001_bad.sql"),
				"CREATE TABLE t(id INTEGER); INVALID SQL;",
			);
			expect(() => applyMigrations(db, dir)).toThrow();
			const rows = db
				.query("SELECT name FROM sqlite_master WHERE type='table' AND name='t'")
				.all();
			expect(rows).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			db.close();
		}
	});
});
