import { describe, expect, test } from "bun:test";
import {
	guardConditionFor,
	hasUpsert,
	isInsertInto,
	isWriteInto,
	setAssignments,
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

describe("guardConditionFor", () => {
	test("returns the whole condition regardless of line breaks", () => {
		const single = 'if (a && b.digest !== d) {\n  return "boom";\n}';
		expect(guardConditionFor(single, '"boom"')).toBe("a && b.digest !== d");

		const multi =
			'if (\n  a &&\n  idx < 7 &&\n  b.digest !== d\n) {\n  return "boom";\n}';
		expect(guardConditionFor(multi, '"boom"')).toBe(
			"a && idx < 7 && b.digest !== d",
		);
	});

	test("ignores a decoy if that never produces the outcome", () => {
		const src =
			'if (false && b.digest !== d) {\n  throw new Error("x");\n}\n' +
			'if (a && idx < 2 && b.digest !== d) {\n  return "boom";\n}';
		expect(guardConditionFor(src, '"boom"')).toBe(
			"a && idx < 2 && b.digest !== d",
		);
	});

	test("expands a local alias so a hidden index term is visible", () => {
		const src =
			'const i = body.chunkIndex;\nif (a && i < 2) {\n  return "boom";\n}';
		expect(guardConditionFor(src, '"boom"')).toMatch(/chunkIndex/);
	});

	test("returns null when the outcome is not inside any if", () => {
		expect(guardConditionFor('return "boom";', '"boom"')).toBeNull();
		expect(guardConditionFor("if (p) { q; }", '"boom"')).toBeNull();
	});
});

describe("setAssignments", () => {
	test("parses top-level assignments only", () => {
		const sql =
			"UPDATE t SET a = 1, b = MIN(x, 2) WHERE seen_count = seen_count + 1";
		expect(setAssignments(sql)).toEqual([
			{ column: "a", expr: "1" },
			{ column: "b", expr: "MIN(x, 2)" },
		]);
		// The WHERE clause must not be mistaken for an assignment.
		expect(setExpression(sql, "seen_count")).toBeNull();
	});

	test("a duplicated column returns null rather than the first value", () => {
		const sql = "UPDATE t SET seen_count = seen_count + 1, seen_count = 100";
		expect(setExpression(sql, "seen_count")).toBeNull();
	});

	test("FROM terminates the expression span", () => {
		const sql = "UPDATE t SET a = x FROM other WHERE 1";
		expect(setExpression(sql, "a")).toBe("x");
	});
});
