/**
 * Real-SQLite D1 adapter for ingest integration tests.
 *
 * The substring-matching mock in mock-d1.ts cannot exercise the multi-phase
 * dispatch matrix (06 §5.4) because those branches depend on rows actually
 * written by earlier phases. This adapter runs the production migrations on
 * bun:sqlite so CAS, digests, and chunk state transitions behave for real.
 */

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function migrationsDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.join(here, "..", "..", "..", "db", "migrations");
}

function isSelect(sql: string): boolean {
	return /^\s*(SELECT|WITH)/i.test(sql);
}

/**
 * D1 reports affected rows for INSERT ... SELECT ... WHERE via meta.changes.
 * bun:sqlite exposes the same through `changes` on the run result.
 */
function makeStatement(db: Database, sql: string, args: unknown[] = []) {
	const stmt = {
		sql,
		args,
		bind(...a: unknown[]) {
			return makeStatement(db, sql, a);
		},
		async all() {
			const results = db.query(sql).all(...(args as never[]));
			return {
				success: true,
				results,
				meta: { changes: 0, rows_read: results.length },
			} as unknown as D1Result;
		},
		async first<T>() {
			const row = db.query(sql).get(...(args as never[]));
			return (row as T) ?? null;
		},
		async run() {
			if (isSelect(sql)) {
				const results = db.query(sql).all(...(args as never[]));
				return {
					success: true,
					results,
					meta: { changes: 0 },
				} as unknown as D1Result;
			}
			const res = db.query(sql).run(...(args as never[]));
			return {
				success: true,
				meta: { changes: Number(res.changes ?? 0) },
			} as unknown as D1Result;
		},
		raw: async () => [],
	};
	return stmt;
}

export type SqliteD1 = {
	db: D1Database;
	raw: Database;
	close: () => void;
	/** Run `fn` right before the next batch whose SQL matches `match`. */
	beforeBatch: (match: string, fn: () => void) => void;
};

/**
 * Create an in-memory D1-compatible database with all migrations applied.
 * Batch semantics mirror D1: statements run inside one transaction and any
 * error rolls the whole batch back.
 */
export function createSqliteD1(): SqliteD1 {
	const raw = new Database(":memory:");
	raw.exec("PRAGMA foreign_keys = ON;");

	const dir = migrationsDir();
	for (const file of readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		raw.exec(readFileSync(path.join(dir, file), "utf8"));
	}

	const hooks: { match: string; fn: () => void }[] = [];

	const db = {
		prepare(sql: string) {
			return makeStatement(raw, sql);
		},
		async batch(statements: ReturnType<typeof makeStatement>[]) {
			const joined = statements.map((s) => s.sql).join("\n");
			for (let i = hooks.length - 1; i >= 0; i--) {
				const hook = hooks[i];
				if (hook && joined.includes(hook.match)) {
					hooks.splice(i, 1);
					hook.fn();
				}
			}
			raw.exec("BEGIN");
			try {
				const out: D1Result[] = [];
				for (const s of statements) {
					out.push(isSelect(s.sql) ? await s.all() : await s.run());
				}
				raw.exec("COMMIT");
				return out;
			} catch (err) {
				raw.exec("ROLLBACK");
				throw err;
			}
		},
		async exec(sql: string) {
			raw.exec(sql);
			return { count: 0, duration: 0 };
		},
	} as unknown as D1Database;

	return {
		db,
		raw,
		close: () => raw.close(),
		beforeBatch: (match, fn) => hooks.push({ match, fn }),
	};
}

/** Seed one developer + one enabled ADO repo, returning their ids. */
export function seedDevAndRepo(
	sqlite: SqliteD1,
	opts: {
		developerId: string;
		alias: string;
		repoId: string;
		org: string;
		project: string;
		repoName: string;
		repoGuid: string;
		projectGuid: string;
	},
): void {
	sqlite.raw
		.query("INSERT INTO developers (id, name, alias) VALUES (?, ?, ?)")
		.run(opts.developerId, opts.alias, opts.alias);
	sqlite.raw
		.query(
			`INSERT INTO repos
         (id, provider, org, project, name, external_id, project_external_id, enabled)
       VALUES (?, 'ado', ?, ?, ?, ?, ?, 1)`,
		)
		.run(
			opts.repoId,
			opts.org,
			opts.project,
			opts.repoName,
			opts.repoGuid,
			opts.projectGuid,
		);
}
