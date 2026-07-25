import { describe, expect, test } from "bun:test";
import { hasUpsert, isInsertInto, sqlShape } from "./sql-shape.ts";

describe("sqlShape", () => {
	test("strips line and block comments", () => {
		expect(sqlShape("SELECT 1 -- trailing\nFROM t").code).toBe(
			"SELECT 1 FROM t",
		);
		expect(sqlShape("SELECT /* mid */ 1").code).toBe("SELECT 1");
	});

	test("comment markers inside a string literal are not comments", () => {
		// The whole point: naive stripping would delete the rest of the statement.
		const sql = "INSERT INTO t VALUES ('/*') ON CONFLICT(id) DO NOTHING";
		expect(hasUpsert(sql)).toBe(true);
		expect(sqlShape(sql).code).toBe(
			"INSERT INTO t VALUES ('') ON CONFLICT(id) DO NOTHING",
		);
	});

	test("escaped quotes inside literals do not end the literal", () => {
		const sql = "SELECT 'it''s /* not */ a comment' FROM t";
		expect(sqlShape(sql).code).toBe("SELECT '' FROM t");
	});

	test("quoted and bracketed identifiers are blanked", () => {
		expect(sqlShape('SELECT "odd name" FROM [t]').code).toBe(
			'SELECT "" FROM ""',
		);
	});

	test("unterminated comment and literal do not hang", () => {
		expect(sqlShape("SELECT 1 /* never closed").code).toBe("SELECT 1");
		expect(sqlShape("SELECT 'never closed").code).toBe("SELECT ''");
	});
});

describe("isInsertInto", () => {
	test("matches across whitespace, comments and case", () => {
		expect(
			isInsertInto("insert into ingest_runs (id) VALUES (1)", "ingest_runs"),
		).toBe(true);
		expect(
			isInsertInto(
				"INSERT /* x */ INTO ingest_runs (id) VALUES (1)",
				"ingest_runs",
			),
		).toBe(true);
	});

	test("does not match a different table or a mere mention", () => {
		expect(
			isInsertInto("INSERT INTO ingest_chunks (id) VALUES (1)", "ingest_runs"),
		).toBe(false);
		expect(isInsertInto("SELECT * FROM ingest_runs", "ingest_runs")).toBe(
			false,
		);
	});
});

describe("hasUpsert", () => {
	test("detects every upsert spelling", () => {
		expect(
			hasUpsert("INSERT INTO t VALUES (1) ON CONFLICT(id) DO NOTHING"),
		).toBe(true);
		expect(
			hasUpsert("INSERT INTO t VALUES (1) on\n  conflict(id) do nothing"),
		).toBe(true);
		expect(
			hasUpsert("INSERT INTO t VALUES (1) ON /* x */ CONFLICT(id) DO NOTHING"),
		).toBe(true);
		expect(hasUpsert("INSERT OR REPLACE INTO t VALUES (1)")).toBe(true);
		expect(hasUpsert("INSERT OR IGNORE INTO t VALUES (1)")).toBe(true);
		expect(hasUpsert("REPLACE INTO t VALUES (1)")).toBe(true);
	});

	test("a plain guarded insert is not an upsert", () => {
		expect(
			hasUpsert("INSERT INTO t (id) SELECT ? WHERE (SELECT v FROM s) = ?"),
		).toBe(false);
	});

	test("the words appearing only inside a literal are not an upsert", () => {
		expect(
			hasUpsert("INSERT INTO t (note) VALUES ('ON CONFLICT DO UPDATE')"),
		).toBe(false);
	});
});
