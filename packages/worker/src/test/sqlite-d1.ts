/**
 * Real-SQLite harness for the ingest write path.
 *
 * The substring-matching mock in mock-d1.ts cannot exercise the multi-phase
 * dispatch matrix (06 §5.4) because those branches depend on rows actually
 * written by earlier phases. This runs the production migrations on bun:sqlite
 * so CAS, digests, and chunk state transitions behave for real.
 *
 * Scope and known divergences from Cloudflare D1 — read before trusting a
 * passing test:
 *   - `raw()` and full D1 result metadata are not implemented; only the
 *     prepare/bind/first/all/run/batch surface the write path actually uses.
 *   - D1 platform limits (statement count, payload size, SQLite build version)
 *     are not modelled; the stmt budget is asserted separately.
 *   - A single handle is sequential. Genuine request concurrency requires
 *     `createConcurrentSqliteD1`, which hands out independent connections over
 *     one on-disk database.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function migrationsDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.join(here, "..", "..", "..", "db", "migrations");
}

/**
 * Statements that return rows rather than mutating. `WITH` needs a real check:
 * a CTE can wrap INSERT/UPDATE/DELETE. This stays a lexical heuristic (it does
 * not strip comments or string literals), which is fine because it only ever
 * sees this repo's own statements — do not reuse it as a general classifier.
 */
function isSelect(sql: string): boolean {
	if (/^\s*SELECT/i.test(sql)) {
		return true;
	}
	if (!/^\s*WITH/i.test(sql)) {
		return false;
	}
	return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
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

export type ConcurrentSqliteD1 = {
	/** Independent connections over one on-disk database. */
	connections: D1Database[];
	/** Query handle for assertions after the racing calls settle. */
	raw: Database;
	close: () => void;
	/**
	 * Hold every connection at the first batch matching `match` until all
	 * `count` of them have arrived, then release together. This is what forces
	 * both writers past Phase 0 before either Phase 1 batch commits — the
	 * interleaving 06 §5.3.2 is actually about.
	 */
	barrierBeforeBatch: (match: string, count: number) => void;
};

/**
 * Create N genuinely independent connections over one temp-file database, so
 * two ingest calls can race the way two Worker invocations do. An in-memory
 * database cannot express this: every handle would be a separate database.
 */
export function createConcurrentSqliteD1(count = 2): ConcurrentSqliteD1 {
	const dir = mkdtempSync(path.join(tmpdir(), "signoff-d1-"));
	const file = path.join(dir, "test.sqlite");

	const setup = new Database(file);
	setup.exec("PRAGMA journal_mode = WAL;");
	setup.exec("PRAGMA foreign_keys = ON;");
	const migrations = migrationsDir();
	for (const name of readdirSync(migrations)
		.filter((f) => f.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		setup.exec(readFileSync(path.join(migrations, name), "utf8"));
	}

	const handles: Database[] = [];
	let barrier: {
		match: string;
		needed: number;
		arrived: number;
		release?: () => void;
		gate: Promise<void>;
	} | null = null;

	const connections = Array.from({ length: count }, () => {
		const handle = new Database(file);
		handle.exec("PRAGMA foreign_keys = ON;");
		// Short on purpose: the loser of a write race should surface the lock
		// error promptly rather than stalling the suite for seconds.
		handle.exec("PRAGMA busy_timeout = 150;");
		handles.push(handle);

		return {
			prepare(sql: string) {
				return makeStatement(handle, sql);
			},
			async batch(statements: ReturnType<typeof makeStatement>[]) {
				const joined = statements.map((s) => s.sql).join("\n");
				if (barrier && joined.includes(barrier.match)) {
					const current = barrier;
					current.arrived++;
					if (current.arrived >= current.needed) {
						// Disarm before releasing: the barrier is one-shot, and later
						// batches (including retries) must not block on it.
						barrier = null;
						current.release?.();
					}
					await current.gate;
				}
				handle.exec("BEGIN IMMEDIATE");
				try {
					const out: D1Result[] = [];
					for (const s of statements) {
						out.push(isSelect(s.sql) ? await s.all() : await s.run());
					}
					handle.exec("COMMIT");
					return out;
				} catch (err) {
					// A lock error can surface before the transaction opened, in which
					// case ROLLBACK itself throws; never mask the original failure.
					try {
						handle.exec("ROLLBACK");
					} catch {
						/* no transaction to roll back */
					}
					throw err;
				}
			},
		} as unknown as D1Database;
	});

	return {
		connections,
		raw: setup,
		close: () => {
			for (const h of handles) {
				h.close();
			}
			setup.close();
			rmSync(dir, { recursive: true, force: true });
		},
		barrierBeforeBatch: (match, needed) => {
			let release: (() => void) | undefined;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			barrier = { match, needed, arrived: 0, release, gate };
		},
	};
}

/** Seed a developer + enabled ADO repo on a raw handle (concurrent harness). */
export function seedRaw(
	raw: Database,
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
	raw
		.query("INSERT INTO developers (id, name, alias) VALUES (?, ?, ?)")
		.run(opts.developerId, opts.alias, opts.alias);
	raw
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
