import { describe, expect, test } from "bun:test";
import {
	hasUpsert,
	ifConditionContaining,
	isInsertInto,
	isWriteInto,
	setExpression,
	sqlShape,
} from "./sql-shape.ts";

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

describe("quoted identifier evasions", () => {
	test("backtick alias containing a comment opener does not start a comment", () => {
		const sql =
			"INSERT INTO ingest_runs (id) SELECT ?, NULL AS `/*` " +
			"WHERE 1 ON CONFLICT(id) DO UPDATE SET run_meta_json = NULL " +
			"RETURNING id AS `*/`";
		expect(hasUpsert(sql)).toBe(true);
		expect(isWriteInto(sql, "ingest_runs")).toBe(true);
	});

	test("double-quoted and bracketed aliases hiding markers", () => {
		expect(
			hasUpsert('INSERT INTO t SELECT 1 AS "/*" ON CONFLICT DO NOTHING'),
		).toBe(true);
		expect(
			hasUpsert("INSERT INTO t SELECT 1 AS [/*] ON CONFLICT DO NOTHING"),
		).toBe(true);
	});

	test("escaped quotes inside identifiers do not end them early", () => {
		expect(sqlShape('SELECT 1 AS "a""b" FROM t').code).toBe(
			'SELECT 1 AS "" FROM t',
		);
		expect(sqlShape("SELECT 1 AS `a``b` FROM t").code).toBe(
			'SELECT 1 AS "" FROM t',
		);
	});
});

describe("isWriteInto", () => {
	test("recognises quoted and bracketed targets", () => {
		expect(
			isWriteInto('INSERT INTO "ingest_runs" (id) VALUES (1)', "ingest_runs"),
		).toBe(true);
		expect(
			isWriteInto("INSERT INTO [ingest_runs] (id) VALUES (1)", "ingest_runs"),
		).toBe(true);
		expect(
			isWriteInto("INSERT INTO `ingest_runs` (id) VALUES (1)", "ingest_runs"),
		).toBe(true);
	});

	test("recognises schema-qualified and REPLACE forms", () => {
		expect(
			isWriteInto(
				"INSERT INTO main.ingest_runs (id) VALUES (1)",
				"ingest_runs",
			),
		).toBe(true);
		expect(
			isWriteInto("REPLACE INTO ingest_runs (id) VALUES (1)", "ingest_runs"),
		).toBe(true);
		expect(
			isWriteInto(
				"INSERT OR REPLACE INTO ingest_runs (id) VALUES (1)",
				"ingest_runs",
			),
		).toBe(true);
	});

	test("still rejects other tables", () => {
		expect(
			isWriteInto("INSERT INTO ingest_chunks (id) VALUES (1)", "ingest_runs"),
		).toBe(false);
		expect(isInsertInto("SELECT * FROM ingest_runs", "ingest_runs")).toBe(
			false,
		);
	});
});

describe("setExpression", () => {
	test("extracts the exact right-hand side", () => {
		const sql =
			"INSERT INTO t (a) VALUES (1) ON CONFLICT(a) DO UPDATE SET " +
			"seen_count = seen_count + 1, last_seen_at = unixepoch() WHERE x = 1";
		expect(setExpression(sql, "seen_count")).toBe("seen_count + 1");
		expect(setExpression(sql, "last_seen_at")).toBe("unixepoch()");
	});

	test("sees through a cap or modulo", () => {
		const capped =
			"ON CONFLICT(a) DO UPDATE SET seen_count = MIN(seen_count + 1, 100), x = 1";
		expect(setExpression(capped, "seen_count")).toBe(
			"MIN(seen_count + 1, 100)",
		);
	});

	test("returns null when the column is not assigned", () => {
		expect(setExpression("UPDATE t SET a = 1", "seen_count")).toBeNull();
	});
});

describe("ifConditionContaining", () => {
	test("returns the whole condition regardless of line breaks", () => {
		const single = "if (a && b.digest !== digest) {\n  return;\n}";
		expect(ifConditionContaining(single, "b.digest !== digest")).toBe(
			"a && b.digest !== digest",
		);

		const multi =
			"if (\n  a &&\n  idx < 7 &&\n  b.digest !== digest\n) {\n  return;\n}";
		expect(ifConditionContaining(multi, "b.digest !== digest")).toBe(
			"a && idx < 7 && b.digest !== digest",
		);
	});

	test("handles nested parentheses in the condition", () => {
		const src = "if (a && (b || c(1, 2)) && d !== e) {}";
		expect(ifConditionContaining(src, "d !== e")).toBe(
			"a && (b || c(1, 2)) && d !== e",
		);
	});

	test("returns null when the needle is outside any if condition", () => {
		expect(ifConditionContaining("const x = a !== b;", "a !== b")).toBeNull();
		expect(ifConditionContaining("if (p) { q !== r; }", "q !== r")).toBeNull();
	});
});
