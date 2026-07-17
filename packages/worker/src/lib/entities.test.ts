import { describe, expect, test } from "bun:test";
import {
	archiveDeveloperBatch,
	batchChanges,
	clearStaleCasStatements,
	normalizeAlias,
	normalizeColor,
	normalizeName,
	restoreDeveloperBatch,
	staleBumpStatements,
} from "./entities.js";
import { asObjectBody } from "./http-body.js";
import { settingsPutCasOutcome } from "./settings-cas.js";

function mockDb(): D1Database {
	return {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return { sql, args, __stmt: true };
				},
				__sql: sql,
			};
		},
	} as unknown as D1Database;
}

describe("normalizeAlias", () => {
	test("lowercases", () => {
		expect(normalizeAlias("Ada")).toBe("ada");
	});
	test("rejects email", () => {
		expect(normalizeAlias("a@b.com")).toBeNull();
	});
	test("rejects non-string", () => {
		expect(normalizeAlias(1)).toBeNull();
	});
});

describe("normalizeName", () => {
	test("trims", () => {
		expect(normalizeName("  Ada  ")).toBe("Ada");
	});
	test("rejects empty", () => {
		expect(normalizeName("   ")).toBeNull();
		expect(normalizeName(null)).toBeNull();
	});
});

describe("normalizeColor", () => {
	test("accepts hex", () => {
		expect(normalizeColor("#3b82f6")).toBe("#3B82F6");
	});
	test("rejects short", () => {
		expect(normalizeColor("#fff")).toBeNull();
		expect(normalizeColor(1)).toBeNull();
	});
});

describe("asObjectBody", () => {
	test("rejects null array primitive", () => {
		expect(asObjectBody(null)).toBeNull();
		expect(asObjectBody([])).toBeNull();
		expect(asObjectBody("x")).toBeNull();
	});
	test("accepts object", () => {
		expect(asObjectBody({ a: 1 })).toEqual({ a: 1 });
	});
});

describe("staleBumpStatements / clearStaleCasStatements", () => {
	test("returns three bump statements", () => {
		const stmts = staleBumpStatements(mockDb(), "reason");
		expect(stmts).toHaveLength(3);
	});
	test("guarded bump has changes() clause", () => {
		const stmts = staleBumpStatements(mockDb(), "reason", {
			onlyIfPreviousChanges: true,
		});
		expect(stmts).toHaveLength(3);
	});
	test("returns two clear-stale cas statements", () => {
		const stmts = clearStaleCasStatements(mockDb(), 3);
		expect(stmts).toHaveLength(2);
	});
	test("archive/restore batches are entity + 3 bump stmts", () => {
		expect(archiveDeveloperBatch(mockDb(), "id")).toHaveLength(4);
		expect(restoreDeveloperBatch(mockDb(), "id")).toHaveLength(4);
	});
});

describe("batchChanges / settingsPutCasOutcome", () => {
	test("batchChanges", () => {
		expect(batchChanges(undefined)).toBe(0);
		expect(
			batchChanges({ success: true, meta: { changes: 1 } } as D1Result),
		).toBe(1);
		expect(batchChanges({ success: true, meta: {} } as D1Result)).toBe(0);
	});
	test("cas outcome", () => {
		expect(settingsPutCasOutcome(1)).toBe("ok");
		expect(settingsPutCasOutcome(0)).toBe("conflict");
		expect(settingsPutCasOutcome(2)).toBe("conflict");
	});
});
