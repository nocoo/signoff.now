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

describe("helpers fail closed rather than reporting a partial answer", () => {
	test("a transitive alias chain still exposes the hidden term", () => {
		const src =
			"const digestIndex = body.chunkIndex;\n" +
			"const mustCheck = digestIndex <= 1;\n" +
			'if (chunk && mustCheck && chunk.digest !== d) {\n  return "boom";\n}';
		expect(guardConditionFor(src, '"boom"')).toMatch(/chunkIndex/);
	});

	test("alias order does not matter", () => {
		const src =
			"const mustCheck = digestIndex <= 1;\n" +
			"const digestIndex = body.chunkIndex;\n" +
			'if (chunk && mustCheck) {\n  return "boom";\n}';
		expect(guardConditionFor(src, '"boom"')).toMatch(/chunkIndex/);
	});

	test("a quoted column in the SET list yields no assignments", () => {
		// SQLite accepts it and would keep the LAST value; reporting the first
		// unquoted assignment would describe behaviour that never happens.
		const sql =
			'UPDATE t SET seen_count = seen_count + 1, "seen_count" = MIN(seen_count + 1, 100)';
		expect(setExpression(sql, "seen_count")).toBeNull();
	});

	test("a tuple assignment yields no assignments", () => {
		expect(setAssignments("UPDATE t SET (a, b) = (1, 2)")).toEqual([]);
	});
});

describe("isWriteInto anchoring", () => {
	test("a quoted alias elsewhere does not claim the write", () => {
		// `sqlShape` blanks quoted identifiers, so the raw text must be read at
		// the SAME offset the verb was found. A free-floating search reads this
		// exactly backwards: the statement writes `other`, not `ingest_runs`.
		expect(
			isWriteInto(
				'INSERT INTO "other" (a) SELECT 1 AS "ingest_runs"',
				"ingest_runs",
			),
		).toBe(false);
		expect(
			isWriteInto('INSERT INTO "ingest_runs" (a) VALUES (1)', "ingest_runs"),
		).toBe(true);
	});

	test("UPDATE counts as a write, as the name promises", () => {
		// Called `isWriteInto` but blind to UPDATE, it would silently answer
		// "nothing writes this table" for the statement that does.
		expect(
			isWriteInto("UPDATE ingest_runs SET status='x'", "ingest_runs"),
		).toBe(true);
		expect(
			isWriteInto("UPDATE OR REPLACE ingest_runs SET a=1", "ingest_runs"),
		).toBe(true);
		expect(isWriteInto("UPDATE main.ingest_runs SET a=1", "ingest_runs")).toBe(
			true,
		);
	});

	test("a table named in a string or as a prefix is not a write", () => {
		expect(
			isWriteInto("UPDATE other SET x = 'ingest_runs'", "ingest_runs"),
		).toBe(false);
		expect(
			isWriteInto(
				"INSERT INTO ingest_runs_archive (a) VALUES (1)",
				"ingest_runs",
			),
		).toBe(false);
		expect(isWriteInto("SELECT * FROM ingest_runs", "ingest_runs")).toBe(false);
	});
});

describe("isInsertInto vs isWriteInto", () => {
	test("they are NOT the same predicate", () => {
		// Aliasing them made `isInsertInto` match UPDATE, which turned "exactly
		// one batch inserts the run" into a false failure against a statement
		// that only guards on the row's existence.
		const update =
			"UPDATE ingest_runs SET stats_json = stats_json WHERE id = ?";
		expect(isWriteInto(update, "ingest_runs")).toBe(true);
		expect(isInsertInto(update, "ingest_runs")).toBe(false);
	});

	test("both agree on a real insert", () => {
		const insert = "INSERT INTO ingest_runs (id) VALUES (?)";
		expect(isWriteInto(insert, "ingest_runs")).toBe(true);
		expect(isInsertInto(insert, "ingest_runs")).toBe(true);
	});
});

describe("guardConditionFor lexing", () => {
	test("finds a guard written without a space after `if`", () => {
		// `if(` is valid JS. Matching the literal "if (" found no guard at all,
		// and the caller then fails closed on a guard that is actually present.
		expect(
			guardConditionFor("if(inFlight > 0) {\n return HIT;\n}", "HIT"),
		).toBe("inFlight > 0");
	});

	test("a paren inside a string does not truncate the condition", () => {
		// Truncation is the dangerous half: `msg === "a` reads as a complete
		// condition, so the guard could be rewritten past the cut and the
		// assertion would still pass.
		expect(
			guardConditionFor(
				'if (msg === "a) b" && n > 0) {\n return HIT;\n}',
				"HIT",
			),
		).toBe('msg === "a) b" && n > 0');
	});

	test("a paren inside a comment does not truncate either", () => {
		const cond = guardConditionFor(
			"if (/* ) */ n > 0) {\n return HIT;\n}",
			"HIT",
		);
		expect(cond).toContain("n > 0");
	});

	test("still returns null when there is genuinely no guard", () => {
		expect(guardConditionFor("return HIT;", "HIT")).toBeNull();
	});
});

describe("guardConditionFor regex literals", () => {
	test("a paren inside a regex does not truncate the condition", () => {
		// `pipeline-ingest-write.ts:585` really does guard on a regex. It has no
		// paren today, so adding one would have silently broken every structural
		// assertion built on this helper.
		expect(
			guardConditionFor(
				"if (/a)b/.test(x) && n > 0) {\n return HIT;\n}",
				"HIT",
			),
		).toBe("/a)b/.test(x) && n > 0");
	});

	test("a slash inside a character class does not end the regex early", () => {
		// `[/)]` is the discriminating case: ignoring character classes ends the
		// literal at that inner slash, so the `)` after it is counted as
		// structure and the condition is cut short.
		expect(
			guardConditionFor(
				"if (/[/)]/.test(x) && n > 0) {\n return HIT;\n}",
				"HIT",
			),
		).toBe("/[/)]/.test(x) && n > 0");
	});

	test("division is still division", () => {
		// Treating every `/` as a regex opener would swallow the rest of the
		// condition instead.
		expect(
			guardConditionFor("if (a / b > 0 && n > 0) {\n return HIT;\n}", "HIT"),
		).toBe("a / b > 0 && n > 0");
	});

	test("a template literal carrying a paren survives", () => {
		expect(
			guardConditionFor("if (`a)b` === x && n > 0) {\n return HIT;\n}", "HIT"),
		).toBe("`a)b` === x && n > 0");
	});
});

describe("guardConditionFor comment-vs-regex ordering", () => {
	test("a line comment containing a slash is a comment, not a regex", () => {
		// `readParenSpan` tested for a regex BEFORE testing for a comment, so
		// `// see a/b` opened a regex literal that swallowed the rest of the
		// condition. The cap this guard forbids then became invisible and the
		// test asserting its absence passed.
		const src =
			"if (a !== b && // see docs a/b (note)\n    n < 2) {\n return HITX;\n}";
		expect(guardConditionFor(src, "HITX")).toContain("n < 2");
	});

	test("a block comment containing a slash is also a comment", () => {
		const src = "if (a && /* see a/b */ n < 2) {\n return HITX;\n}";
		expect(guardConditionFor(src, "HITX")).toContain("n < 2");
	});
});

describe("isWriteInto offset alignment", () => {
	test("a comment before the verb does not hide the write", () => {
		// `at` indexes the NORMALIZED sql; slicing the RAW sql at it silently
		// mismatches once a comment or collapsed whitespace shifts positions.
		// The blanked target is found by counting blanks instead.
		expect(
			isWriteInto(
				'/* audit note */ UPDATE "ingest_runs" SET a=1',
				"ingest_runs",
			),
		).toBe(true);
		expect(
			isWriteInto(
				'-- note\nINSERT INTO "ingest_runs" (a) VALUES (1)',
				"ingest_runs",
			),
		).toBe(true);
	});

	test("counting blanks still picks the right one when several precede", () => {
		expect(
			isWriteInto(
				`INSERT INTO "ingest_runs" (a) SELECT 'x', 'y' FROM t`,
				"ingest_runs",
			),
		).toBe(true);
		expect(
			isWriteInto(`UPDATE t SET a='x' WHERE b='ingest_runs'`, "ingest_runs"),
		).toBe(false);
	});
});

describe("guardConditionFor marker anchoring", () => {
	test("a marker in a comment does not select a decoy guard", () => {
		// This returns a WRONG condition, not null: the caller compares it to
		// what it expects and can pass on a guard that no longer exists.
		const src =
			'if (safe) {\n  // returns "Chunk digest conflict" on mismatch\n}\n' +
			'if (chunk && body.chunkIndex < 2) {\n  return "Chunk digest conflict";\n}';
		expect(guardConditionFor(src, '"Chunk digest conflict"')).toBe(
			"chunk && body.chunkIndex < 2",
		);
	});

	test("a marker that IS a string literal still anchors", () => {
		// Callers anchor on the guard's OUTCOME, and that outcome is usually a
		// returned string. Skipping strings would ignore every real anchor.
		expect(
			guardConditionFor('if (a && b) {\n  return "boom";\n}', '"boom"'),
		).toBe("a && b");
	});

	test("an escaped quote inside a string keeps the parens balanced", () => {
		// `"a\") b"` is ONE string containing a quote and a paren. Without escape
		// handling the scanner ends it at the escaped quote, then counts the `)`
		// as structure and cuts the condition short — hiding whatever follows.
		const src = 'if (s === "a\\") b" && n > 0) {\n  return HITX;\n}';
		const cond = guardConditionFor(src, "HITX");
		expect(cond).toContain("n > 0");
	});
});

describe("isWriteInto schema qualification", () => {
	test("a quoted schema prefix does not hide the target", () => {
		expect(
			isWriteInto(
				'INSERT INTO "main"."ingest_runs" (a) VALUES (1)',
				"ingest_runs",
			),
		).toBe(true);
		expect(
			isWriteInto(
				'INSERT INTO "main".ingest_runs (a) VALUES (1)',
				"ingest_runs",
			),
		).toBe(true);
	});

	test("a table named as the SCHEMA is not the table written", () => {
		// The dangerous direction: claiming a write to a table the statement
		// only qualifies with. This one writes `other`.
		expect(
			isWriteInto(
				'INSERT INTO "ingest_runs"."other" (a) VALUES (1)',
				"ingest_runs",
			),
		).toBe(false);
	});
});
