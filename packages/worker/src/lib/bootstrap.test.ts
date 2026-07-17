import { describe, expect, test } from "bun:test";
import { bootstrapSnapshotStatements } from "./bootstrap.js";

describe("bootstrapSnapshotStatements", () => {
	test("returns three statements in one batch", () => {
		const db = {
			prepare(sql: string) {
				return { sql };
			},
		} as unknown as D1Database;
		const stmts = bootstrapSnapshotStatements(db);
		expect(stmts).toHaveLength(3);
	});
});
