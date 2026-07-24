import { describe, expect, test } from "bun:test";
import { createMockD1 } from "../test/mock-d1.js";
import {
	estimateIngestStmtBudget,
	finalizeRun,
	INGEST_STMT_BUDGET_MAX,
	processIngestChunk,
} from "./pipeline-ingest-write.js";
import type { AppSettings } from "./settings.js";

/** Count each .first/.all/.run as 1 and each batch as statements.length. */
function withStmtCounter(db: D1Database): {
	db: D1Database;
	count: () => number;
} {
	let n = 0;
	const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement => {
		const s = stmt as D1PreparedStatement & {
			bind: (...a: unknown[]) => D1PreparedStatement;
			first: <T>() => Promise<T | null>;
			all: <T>() => Promise<D1Result<T>>;
			run: () => Promise<D1Result>;
		};
		return {
			bind(...a: unknown[]) {
				return wrapStmt(s.bind(...a));
			},
			async first<T>() {
				n += 1;
				return s.first<T>();
			},
			async all<T>() {
				n += 1;
				return s.all<T>();
			},
			async run() {
				n += 1;
				return s.run();
			},
		} as unknown as D1PreparedStatement;
	};
	const counting: D1Database = {
		prepare(sql: string) {
			return wrapStmt(db.prepare(sql));
		},
		async batch(statements: D1PreparedStatement[]) {
			n += statements.length;
			return db.batch(statements);
		},
	} as D1Database;
	return { db: counting, count: () => n };
}

/**
 * Stateful mock that completes a full new-run ingest (phase 0–finalize) with
 * kind=ok. Injects 10 synthetic old dev-days so union reaches 20 under 10 WI.
 */
function createWorstCaseOkMock(): D1Database {
	const settingsV = 1;
	const oldDevDays = Array.from({ length: 10 }, (_, i) => ({
		developer_id: "dev-1",
		day_key: `2026-05-${String(i + 1).padStart(2, "0")}`,
	}));

	const makeStmt = (
		sql: string,
		_args: unknown[] = [],
	): D1PreparedStatement => {
		const stmt = {
			bind(...a: unknown[]) {
				return makeStmt(sql, a);
			},
			async first<T>() {
				const s = sql;
				if (s.includes("FROM ingest_runs") && s.includes("SELECT status")) {
					return {
						status: "finalized",
						config_version: settingsV,
						settings_v: settingsV,
					} as T;
				}
				if (
					s.includes("SELECT * FROM ingest_runs") ||
					s.includes("FROM ingest_runs WHERE id")
				) {
					// Initial lookup: no run yet. Post-phase finalize status uses SELECT status.
					if (s.includes("SELECT status, config_version")) {
						return {
							status: "finalized",
							config_version: settingsV,
							settings_v: settingsV,
						} as T;
					}
					if (s.includes("SELECT status FROM ingest_runs")) {
						return { status: "finalized" } as T;
					}
					if (
						s.includes("SELECT * FROM ingest_runs") ||
						s.trimStart().startsWith("SELECT *")
					) {
						return null;
					}
					// generic ingest_runs without status → null for first look
					if (!s.includes("status")) {
						return null;
					}
				}
				if (s.includes("FROM ingest_chunks")) {
					return null;
				}
				if (s.includes("MAX(chunk_index)")) {
					return { m: null } as T;
				}
				if (s.includes("pipeline_config_version") && s.includes("CAST")) {
					return { v: settingsV } as T;
				}
				if (s.includes("project_external_id")) {
					return { id: "repo-proj" } as T;
				}
				return null;
			},
			async all<T>() {
				const s = sql;
				const empty = {
					success: true,
					results: [] as T[],
					meta: { changes: 0 },
				} as unknown as D1Result<T>;
				if (s.includes("FROM developers")) {
					return {
						success: true,
						results: [{ id: "dev-1", alias: "ada", archived_at: null }],
						meta: { changes: 0 },
					} as unknown as D1Result<T>;
				}
				// Phase 0 ownership probe
				if (s.includes("external_ref, developer_id")) {
					return empty;
				}
				// Old dev-days (rematch union padding → 20 with 10 new)
				if (s.includes("developer_id, day_key") && s.includes("external_ref")) {
					return {
						success: true,
						results: oldDevDays as T[],
						meta: { changes: 0 },
					} as unknown as D1Result<T>;
				}
				// Phase 2 score rebuild SELECT
				if (
					s.includes("source_ids_json") ||
					s.includes("SELECT type, occurred_at")
				) {
					return empty;
				}
				return empty;
			},
			async run() {
				return {
					success: true,
					meta: { changes: 1 },
				} as unknown as D1Result;
			},
		};
		return stmt as unknown as D1PreparedStatement;
	};

	return {
		prepare(sql: string) {
			return makeStmt(sql);
		},
		async batch(statements: D1PreparedStatement[]) {
			return statements.map(
				() =>
					({
						success: true,
						meta: { changes: 1 },
					}) as unknown as D1Result,
			);
		},
	} as unknown as D1Database;
}

const settings: AppSettings = {
	timezone: "UTC",
	emailSuffixes: ["example.com"],
	activityWeights: {
		"pr.merged": 10,
		"pr.closed": 2,
		"pr.created": 2,
		"pr.vote": 3,
		"pr.active": 2,
		"wi.created": 3,
		"wi.updated": 1,
		"wi.closed": 5,
	},
	pipelineConfigVersion: 1,
	scoresStale: false,
	scoresStaleReason: null,
	updatedAt: {},
};

function worstCaseBody() {
	const activities = Array.from({ length: 10 }, (_, i) => ({
		type: "wi.created" as const,
		occurredAt: 1720000000 + i * 86400,
		provider: "ado" as const,
		org: "acme",
		project: "Alpha",
		repoId: null as null,
		developerId: "dev-1",
		matchedUniqueName: "ada@example.com",
		sourceIds: {
			projectGuid: "22222222-2222-4222-8222-222222222222",
			wiId: 1000 + i,
		},
	}));
	const unmatchedIdentities = Array.from({ length: 10 }, (_, i) => ({
		uniqueName: `ghost${i}@example.com`,
		sampleOrg: "acme",
		sampleProject: "Alpha",
	}));
	return {
		pipelineConfigVersion: 1,
		runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
		chunkIndex: 0,
		isFinalChunk: true,
		runMeta: {
			startedAt: 1720000000,
			source: "fixture" as const,
			windowFrom: "2026-06-01",
			windowTo: "2026-07-01",
			mode: "incremental" as const,
		},
		activities,
		unmatchedIdentities,
	};
}

describe("estimateIngestStmtBudget", () => {
	test("worst-case 10 WI + 10 unmatched + 20 dev-days + loadSettings + finalize ≤ 80", () => {
		const n = estimateIngestStmtBudget({
			activityCount: 10,
			unmatchedCount: 10,
			unionSize: 20,
			wiActivityCount: 10,
			includeLoadSettings: true,
			includeFinalize: true,
		});
		// phase0=17, phase1=22, phase3=24, load=1, fin=2 → 66
		expect(n).toBe(66);
		expect(n).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
	});

	test("non-final chunk still counts loadSettings", () => {
		const n = estimateIngestStmtBudget({
			activityCount: 10,
			unmatchedCount: 0,
			unionSize: 10,
			wiActivityCount: 0,
			includeLoadSettings: true,
			includeFinalize: false,
		});
		// 7+0 + 12 + 14 + 1 + 0 = 34
		expect(n).toBe(34);
		expect(n).toBeGreaterThan(
			estimateIngestStmtBudget({
				activityCount: 10,
				unmatchedCount: 0,
				unionSize: 10,
				wiActivityCount: 0,
				includeLoadSettings: false,
				includeFinalize: false,
			}),
		);
	});
});

describe("processIngestChunk actual stmt count", () => {
	test("worst-case 10 WI + 10 unmatched completes ok and stays ≤ 80 stmts", async () => {
		const base = createWorstCaseOkMock();
		const { db, count } = withStmtCounter(base);
		// Route loadSettings is outside processIngestChunk; add +1 for full-request budget.
		const result = await processIngestChunk(db, worstCaseBody(), settings);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.body.finalized).toBe(true);
			expect(result.body.unmatched.upserted).toBe(10);
			expect(result.body.activities.upserted).toBe(10);
		}
		const observedInProcess = count();
		const fullRequest = observedInProcess + 1; // loadSettings
		expect(observedInProcess).toBeGreaterThan(20);
		expect(fullRequest).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
	});

	test("finalizeRun rejects when settings version drifts", async () => {
		const db = createMockD1({
			runChanges: 0,
			firstBySql: [
				{
					match: "FROM ingest_runs",
					row: {
						status: "finalized",
						config_version: 1,
						settings_v: 2,
					},
				},
			],
		});
		const fin = await finalizeRun(db, "01JAY7B4HXTMRP0VQZ0FKZH5S8", 1);
		expect(fin.kind).toBe("conflict");
	});

	test("finalizeRun ok when already finalized under same settings version", async () => {
		const db = createMockD1({
			runChanges: 0,
			firstBySql: [
				{
					match: "FROM ingest_runs",
					row: {
						status: "finalized",
						config_version: 1,
						settings_v: 1,
					},
				},
			],
		});
		const fin = await finalizeRun(db, "01JAY7B4HXTMRP0VQZ0FKZH5S8", 1);
		expect(fin.kind).toBe("ok");
	});

	test("finalizeRun ok when UPDATE changes=1", async () => {
		const db = createMockD1({ runChanges: 1 });
		const fin = await finalizeRun(db, "01JAY7B4HXTMRP0VQZ0FKZH5S8", 1);
		expect(fin.kind).toBe("ok");
	});
});
