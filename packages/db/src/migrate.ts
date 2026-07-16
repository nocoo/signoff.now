/**
 * Apply ordered SQL migrations to a SQLite database (bun:sqlite).
 * Used by unit tests; production uses wrangler d1 migrations apply.
 */
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function listMigrationFiles(migrationsDir: string): string[] {
	return readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
}

export function applyMigrations(db: Database, migrationsDir: string): string[] {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at INTEGER NOT NULL DEFAULT (unixepoch())
		);
	`);

	const applied = new Set(
		db
			.query<{ name: string }, []>(
				"SELECT name FROM schema_migrations ORDER BY name",
			)
			.all()
			.map((r) => r.name),
	);

	const appliedNow: string[] = [];
	for (const name of listMigrationFiles(migrationsDir)) {
		if (applied.has(name)) continue;
		const sql = readFileSync(path.join(migrationsDir, name), "utf8");
		db.exec("BEGIN");
		try {
			db.exec(sql);
			db.query("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
			db.exec("COMMIT");
			appliedNow.push(name);
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	}
	return appliedNow;
}

export function openMemoryDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys = ON;");
	return db;
}

export function defaultMigrationsDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.join(here, "..", "migrations");
}
