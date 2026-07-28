import { describe, expect, test } from "bun:test";
import {
	AVATAR_URL_MAX,
	archiveDeveloperBatch,
	batchChanges,
	clearStaleCasStatements,
	normalizeAlias,
	normalizeAvatarUrl,
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

describe("normalizeAvatarUrl", () => {
	const kind = (r: ReturnType<typeof normalizeAvatarUrl>) =>
		"absent" in r ? "absent" : "error" in r ? "error" : r.value;

	test("an absent field is not the same as a cleared one", () => {
		// Collapsing these would make every PATCH that omits avatarUrl wipe it.
		expect(kind(normalizeAvatarUrl(undefined))).toBe("absent");
		expect(kind(normalizeAvatarUrl(null))).toBeNull();
	});

	test("blank means cleared, so the UI has one empty case", () => {
		expect(kind(normalizeAvatarUrl(""))).toBeNull();
		expect(kind(normalizeAvatarUrl("   "))).toBeNull();
	});

	test("http(s) URLs pass through untouched", () => {
		expect(kind(normalizeAvatarUrl("https://x/a.png"))).toBe("https://x/a.png");
		expect(kind(normalizeAvatarUrl("  http://x/a.png  "))).toBe(
			"http://x/a.png",
		);
	});

	test("a script-bearing scheme is an ERROR, not silently dropped", () => {
		// This value lands in an `<img src>` shown to every viewer. Returning
		// "absent" would keep the old avatar and report success — the caller
		// would never learn the URL was refused.
		expect(kind(normalizeAvatarUrl("javascript:alert(1)"))).toBe("error");
		expect(kind(normalizeAvatarUrl("data:image/png;base64,AAA"))).toBe("error");
		expect(kind(normalizeAvatarUrl("not a url"))).toBe("error");
		expect(kind(normalizeAvatarUrl(42))).toBe("error");
	});

	test("an over-long URL is refused rather than stored", () => {
		expect(
			kind(normalizeAvatarUrl(`https://x/${"a".repeat(AVATAR_URL_MAX)}`)),
		).toBe("error");
	});
});
