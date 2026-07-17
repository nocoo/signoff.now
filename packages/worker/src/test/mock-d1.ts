/** Lightweight D1 mock for route unit tests. */

export type MockD1Options = {
	/** Results for SELECT .all() by substring match on SQL */
	allBySql?: Array<{ match: string; results: unknown[] }>;
	/** Result for .first() by substring match */
	firstBySql?: Array<{ match: string; row: unknown }>;
	/** Default changes for .run() */
	runChanges?: number;
	/** Per-statement batch results (length must match or last is reused) */
	batchResults?: D1Result[];
	/** Custom run handler */
	onRun?: (sql: string, args: unknown[]) => { changes: number };
	/** Fail batch with error */
	batchError?: Error;
	/** Fail prepare.run with error */
	runError?: Error;
};

type Stmt = {
	sql: string;
	args: unknown[];
	bind: (...a: unknown[]) => Stmt;
	all: () => Promise<D1Result>;
	first: <T>() => Promise<T | null>;
	run: () => Promise<D1Result>;
};

export function createMockD1(opts: MockD1Options = {}): D1Database {
	const makeStmt = (sql: string, args: unknown[] = []): Stmt => {
		const stmt: Stmt = {
			sql,
			args,
			bind(...a: unknown[]) {
				return makeStmt(sql, a);
			},
			async all() {
				const hit = opts.allBySql?.find((x) => sql.includes(x.match));
				return {
					success: true,
					results: hit?.results ?? [],
					meta: { changes: 0 },
				} as D1Result;
			},
			async first<T>() {
				const hit = opts.firstBySql?.find((x) => sql.includes(x.match));
				return (hit?.row as T) ?? null;
			},
			async run() {
				if (opts.runError) {
					throw opts.runError;
				}
				const changes = opts.onRun?.(sql, args).changes ?? opts.runChanges ?? 1;
				return {
					success: true,
					meta: { changes },
				} as D1Result;
			},
		};
		return stmt;
	};

	return {
		prepare(sql: string) {
			return makeStmt(sql);
		},
		async batch(statements: unknown[]) {
			if (opts.batchError) {
				throw opts.batchError;
			}
			if (opts.batchResults) {
				return opts.batchResults;
			}
			// Default: each statement succeeds with changes=1, empty results
			return (statements as Stmt[]).map((s, i) => {
				const custom = opts.batchResults?.[i];
				if (custom) {
					return custom;
				}
				// For SELECT-like, try all()
				if (s.sql?.includes("SELECT")) {
					const hit = opts.allBySql?.find((x) => s.sql.includes(x.match));
					return {
						success: true,
						results: hit?.results ?? [],
						meta: { changes: 0 },
					} as D1Result;
				}
				return {
					success: true,
					meta: { changes: opts.runChanges ?? 1 },
				} as D1Result;
			});
		},
	} as unknown as D1Database;
}

export const DEFAULT_SETTINGS_ROWS = [
	{ key: "timezone", value: '"UTC"', updated_at: 1 },
	{ key: "email_suffixes", value: '["example.com"]', updated_at: 1 },
	{
		key: "activity_weights",
		value:
			'{"pr.merged":10,"pr.closed":2,"pr.created":2,"pr.vote":3,"pr.active":2,"wi.created":3,"wi.updated":1,"wi.closed":5}',
		updated_at: 1,
	},
	{ key: "pipeline_config_version", value: "1", updated_at: 1 },
	{ key: "scores_stale", value: "false", updated_at: 1 },
	{ key: "scores_stale_reason", value: "null", updated_at: 1 },
];
