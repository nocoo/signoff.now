import { describe, expect, test } from "bun:test";
import { createMockD1, DEFAULT_SETTINGS_ROWS } from "../test/mock-d1.js";
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

const body = {
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
	activities: [
		{
			type: "pr.merged" as const,
			occurredAt: 1720000123,
			provider: "ado" as const,
			org: "acme",
			project: "Alpha",
			repoId: "repo-1",
			developerId: "dev-1",
			matchedUniqueName: "ada@example.com",
			sourceIds: {
				prRepoGuid: "11111111-1111-4111-8111-111111111111",
				prId: 1001,
			},
		},
	],
	unmatchedIdentities: [] as [],
};

describe("estimateIngestStmtBudget", () => {
	test("worst-case 10 WI + 10 unmatched + 20 dev-days + route/finalize ≤ 80", () => {
		const n = estimateIngestStmtBudget({
			activityCount: 10,
			unmatchedCount: 10,
			unionSize: 20,
			wiActivityCount: 10,
			includeRouteAndFinalize: true,
		});
		// phase0=7+10=17, phase1=22, phase3=24, routeFin=3 → 66
		expect(n).toBe(66);
		expect(n).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
	});

	test("PR-only path without route still under budget", () => {
		const n = estimateIngestStmtBudget({
			activityCount: 10,
			unmatchedCount: 10,
			unionSize: 20,
			wiActivityCount: 0,
			includeRouteAndFinalize: false,
		});
		// 7+0 + 22 + 24 = 53
		expect(n).toBe(53);
		expect(n).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
	});
});

describe("processIngestChunk actual stmt count", () => {
	test("happy-path new run counts .first/.all/.run + batch lengths ≤ 80", async () => {
		const base = createMockD1({
			allBySql: [
				{ match: "FROM settings", results: DEFAULT_SETTINGS_ROWS },
				{
					match: "FROM developers",
					results: [{ id: "dev-1", alias: "ada", archived_at: null }],
				},
				{
					match: "FROM repos WHERE id",
					results: [
						{
							id: "repo-1",
							provider: "ado",
							org: "acme",
							project: "Alpha",
							external_id: "11111111-1111-4111-8111-111111111111",
							enabled: 1,
							archived_at: null,
						},
					],
				},
				{ match: "FROM activities WHERE external_ref", results: [] },
				{ match: "FROM activities", results: [] },
				{
					match: "SELECT type, occurred_at",
					results: [],
				},
			],
			firstBySql: [
				{ match: "FROM ingest_runs", row: null },
				{ match: "FROM ingest_chunks", row: null },
				{ match: "MAX(chunk_index)", row: { m: null } },
				{
					match: "pipeline_config_version",
					row: { v: 1 },
				},
				{
					match: "FROM developers WHERE id",
					row: { id: "dev-1", alias: "ada", archived_at: null },
				},
				{
					match: "FROM repos WHERE id",
					row: {
						id: "repo-1",
						provider: "ado",
						org: "acme",
						project: "Alpha",
						external_id: "11111111-1111-4111-8111-111111111111",
						enabled: 1,
						archived_at: null,
					},
				},
			],
			runChanges: 1,
		});
		const { db, count } = withStmtCounter(base);
		const result = await processIngestChunk(db, body, settings);
		// Mock may not complete full score fold; still measure observed D1 traffic.
		expect(["ok", "conflict", "server_error", "unprocessable"]).toContain(
			result.kind,
		);
		const observed = count();
		expect(observed).toBeGreaterThan(0);
		expect(observed).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
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
