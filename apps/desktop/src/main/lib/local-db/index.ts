import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "@signoff/local-db/schema";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDbDir } from "main/lib/app-environment";

const DB_FILENAME = "signoff.db";

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

/**
 * Returns the Drizzle ORM database instance.
 * Throws if `initLocalDb()` has not been called.
 */
export function getDb() {
	if (!_db) {
		throw new Error(
			"Local database not initialized. Call initLocalDb() first.",
		);
	}
	return _db;
}

/**
 * Returns the raw better-sqlite3 instance.
 * Useful for running raw SQL or migrations.
 */
export function getSqlite() {
	if (!_sqlite) {
		throw new Error(
			"Local database not initialized. Call initLocalDb() first.",
		);
	}
	return _sqlite;
}

/**
 * Initializes the local SQLite database.
 *
 * - Creates the database directory if it doesn't exist
 * - Opens the database file with WAL mode for concurrent reads
 * - Runs schema migrations (pushes the schema directly)
 * - Returns the Drizzle ORM instance
 */
export function initLocalDb(): ReturnType<typeof drizzle> {
	const dbDir = getDbDir();
	if (!existsSync(dbDir)) {
		mkdirSync(dbDir, { recursive: true });
	}

	const dbPath = path.join(dbDir, DB_FILENAME);
	_sqlite = new Database(dbPath);

	// Enable WAL mode for better concurrent read performance
	_sqlite.pragma("journal_mode = WAL");
	// Enable foreign keys
	_sqlite.pragma("foreign_keys = ON");

	// Run migrations from the SQL file
	const migrationPath = path.resolve(
		__dirname,
		"../../../../packages/local-db/drizzle/0000_plain_kabuki.sql",
	);

	if (existsSync(migrationPath)) {
		const sql = readFileSync(migrationPath, "utf-8");
		// Split by statement-breakpoint and execute each statement
		const statements = sql
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);

		for (const statement of statements) {
			try {
				_sqlite.exec(statement);
			} catch (error) {
				// Ignore "table already exists" errors during migration
				const msg = error instanceof Error ? error.message : String(error);
				if (!msg.includes("already exists")) {
					throw error;
				}
			}
		}
	}

	_db = drizzle(_sqlite, { schema });
	return _db;
}

/**
 * Closes the database connection.
 * Should be called on app quit.
 */
export function closeLocalDb(): void {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
		_db = null;
	}
}
