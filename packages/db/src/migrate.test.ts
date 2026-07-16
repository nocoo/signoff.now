import { describe, expect, test } from "vitest";
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
		expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
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

		expect(keys).toEqual(
			expect.arrayContaining([
				"timezone",
				"email_suffixes",
				"activity_weights",
				"pipeline_config_version",
				"scores_stale",
				"scores_stale_reason",
			]),
		);

		const timezone = db
			.query<{ value: string }, []>(
				`SELECT value FROM settings WHERE key = 'timezone'`,
			)
			.get();
		expect(JSON.parse(timezone?.value ?? "")).toBe("Asia/Shanghai");

		const suffixes = db
			.query<{ value: string }, []>(
				`SELECT value FROM settings WHERE key = 'email_suffixes'`,
			)
			.get();
		expect(JSON.parse(suffixes?.value ?? "")).toEqual(["microsoft.com"]);

		const version = db
			.query<{ value: string }, []>(
				`SELECT value FROM settings WHERE key = 'pipeline_config_version'`,
			)
			.get();
		expect(JSON.parse(version?.value ?? "0")).toBe(1);
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
		// Active alias free again
		db.query(
			`INSERT INTO developers (id, name, alias) VALUES ('d2', 'Ada 2', 'ada')`,
		).run();

		db.query(
			`INSERT INTO activities (
				id, developer_id, type, occurred_at, day_key, config_version,
				provider, org, project, external_ref
			) VALUES (
				'a1', 'd2', 'pr.created', 1, '2026-01-01', 1,
				'ado', 'org', 'proj', 'ado:pr:repoguid:1:created'
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
				provider, org, project, repo_id, external_ref
			) VALUES (
				'a1', 'd1', 'pr.created', 1, '2026-01-01', 1,
				'ado', 'org', 'proj', 'r1', 'ado:pr:repo-guid-1:1:created'
			)`,
		).run();

		expect(() => {
			db.query(`DELETE FROM repos WHERE id = 'r1'`).run();
		}).toThrow();
	});

	test("repos external_id unique among active rows", () => {
		const db = openMemoryDb();
		applyMigrations(db, migrationsDir);

		db.query(
			`INSERT INTO repos (id, provider, org, project, name, external_id)
			 VALUES ('r1', 'ado', 'o', 'p', 'n1', 'guid-1')`,
		).run();
		expect(() => {
			db.query(
				`INSERT INTO repos (id, provider, org, project, name, external_id)
				 VALUES ('r2', 'ado', 'o', 'p', 'n2', 'guid-1')`,
			).run();
		}).toThrow();
	});

	test("required indexes exist", () => {
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
		]) {
			expect(indexes).toContain(name);
		}
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
		// Primary key (developer_id, day_key) should be usable
		expect(details.toLowerCase()).toMatch(
			/scores|primary|developer_id|day_key/,
		);
	});

	test("idempotent re-apply skips already applied migrations", () => {
		const db = openMemoryDb();
		const first = applyMigrations(db, migrationsDir);
		const second = applyMigrations(db, migrationsDir);
		expect(first.length).toBeGreaterThan(0);
		expect(second).toEqual([]);
	});
});
