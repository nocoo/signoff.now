/**
 * Schema-migration consistency test.
 *
 * Applies all migration SQL files to an in-memory SQLite database,
 * then verifies the resulting structure matches the Drizzle schema
 * declarations. Catches silent drift between schema.ts and the
 * migration set.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	projects,
	settings,
	workspaceSections,
	workspaces,
	worktrees,
} from "./schema";

const DRIZZLE_DIR = join(import.meta.dir, "../../drizzle");

/** Read and execute all migration SQL files in order */
function applyMigrations(db: Database): void {
	const files = readdirSync(DRIZZLE_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	for (const file of files) {
		const sql = readFileSync(join(DRIZZLE_DIR, file), "utf-8");
		// drizzle-kit uses "--> statement-breakpoint" as separator
		const statements = sql
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		for (const stmt of statements) {
			db.run(stmt);
		}
	}
}

/** Get column names from a table via PRAGMA */
function getTableColumns(db: Database, table: string): string[] {
	const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return rows.map((r) => r.name).sort();
}

/** Get all user table names from sqlite_master */
function getTableNames(db: Database): string[] {
	const rows = db
		.query(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
		)
		.all() as Array<{ name: string }>;
	return rows.map((r) => r.name);
}

/** Get all index names from sqlite_master */
function getIndexNames(db: Database): string[] {
	const rows = db
		.query(
			"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all() as Array<{ name: string }>;
	return rows.map((r) => r.name);
}

/** Extract column names from a Drizzle table definition */
function getDrizzleColumns(table: Record<string, unknown>): string[] {
	// Drizzle table objects have a Symbol.for("drizzle:Columns") key,
	// but we can also iterate the columns from the table's own properties.
	// The table config is accessible via getTableConfig from drizzle-orm.
	const { getTableConfig } = require("drizzle-orm/sqlite-core");
	const config = getTableConfig(table);
	return (config.columns as Array<{ name: string }>)
		.map((c: { name: string }) => c.name)
		.sort();
}

function getDrizzleTableName(table: Record<string, unknown>): string {
	const { getTableConfig } = require("drizzle-orm/sqlite-core");
	return getTableConfig(table).name;
}

function getDrizzleIndexNames(table: Record<string, unknown>): string[] {
	const { getTableConfig } = require("drizzle-orm/sqlite-core");
	const config = getTableConfig(table);
	return (config.indexes as Array<{ config: { name: string } }>)
		.map((idx: { config: { name: string } }) => idx.config.name)
		.sort();
}

describe("schema-migration consistency", () => {
	const db = new Database(":memory:");
	applyMigrations(db);

	const drizzleTables = [
		projects,
		worktrees,
		workspaces,
		workspaceSections,
		settings,
	];

	test("migration creates exactly the expected tables", () => {
		const actualTables = getTableNames(db).sort();
		const expectedTables = drizzleTables
			.map((t) => getDrizzleTableName(t as unknown as Record<string, unknown>))
			.sort();
		expect(actualTables).toEqual(expectedTables);
	});

	for (const table of drizzleTables) {
		const tableName = getDrizzleTableName(
			table as unknown as Record<string, unknown>,
		);

		test(`${tableName}: columns match schema`, () => {
			const actual = getTableColumns(db, tableName);
			const expected = getDrizzleColumns(
				table as unknown as Record<string, unknown>,
			);
			expect(actual).toEqual(expected);
		});

		test(`${tableName}: indexes match schema`, () => {
			const schemaIndexes = getDrizzleIndexNames(
				table as unknown as Record<string, unknown>,
			);
			const dbIndexes = getIndexNames(db);
			for (const idx of schemaIndexes) {
				expect(dbIndexes).toContain(idx);
			}
		});
	}

	test("partial unique index workspaces_unique_branch_per_project exists", () => {
		const indexes = getIndexNames(db);
		expect(indexes).toContain("workspaces_unique_branch_per_project");
	});
});
