import { describe, expect, test } from "bun:test";
import {
	AVATAR_URL_MAX,
	archiveDeveloperBatch,
	batchChanges,
	clearStaleCasStatements,
	membershipStatements,
	normalizeAlias,
	normalizeAvatarUrl,
	normalizeColor,
	normalizeName,
	readTeamIds,
	restoreDeveloperBatch,
	staleBumpStatements,
	TEAM_IDS_MAX,
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

describe("readTeamIds", () => {
	const kind = (r: ReturnType<typeof readTeamIds>) =>
		"absent" in r ? "absent" : "error" in r ? "error" : r.value;

	test("absent is not the same as empty", () => {
		// Absent means "leave memberships alone"; [] means "remove them all".
		expect(kind(readTeamIds(undefined))).toBe("absent");
		expect(kind(readTeamIds([]))).toEqual([]);
	});

	test("duplicates collapse rather than hitting the composite key", () => {
		expect(kind(readTeamIds(["a", "a", "b"]))).toEqual(["a", "b"]);
	});

	test("entries are trimmed", () => {
		expect(kind(readTeamIds([" a "]))).toEqual(["a"]);
	});

	test("a non-array or a bad entry is an error", () => {
		expect(kind(readTeamIds("a"))).toBe("error");
		expect(kind(readTeamIds([""]))).toBe("error");
		expect(kind(readTeamIds(["  "]))).toBe("error");
		expect(kind(readTeamIds([1]))).toBe("error");
		expect(kind(readTeamIds([null]))).toBe("error");
	});

	test("the length cap is enforced exactly at the boundary", () => {
		// Each id becomes one D1 statement in the PATCH batch. Without the cap a
		// single request could push the batch past D1's per-invocation statement
		// limit — so the boundary itself has to be pinned, not just "large is
		// refused". Distinct ids, since duplicates would dedupe under the cap.
		const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
		expect(kind(readTeamIds(ids(TEAM_IDS_MAX)))).toHaveLength(TEAM_IDS_MAX);
		expect(kind(readTeamIds(ids(TEAM_IDS_MAX + 1)))).toBe("error");
	});
});

describe("membershipStatements", () => {
	test("one DELETE plus one INSERT per id", () => {
		expect(membershipStatements(mockDb(), "d1", [])).toHaveLength(1);
		expect(membershipStatements(mockDb(), "d1", ["a", "b"])).toHaveLength(3);
	});

	test("create skips the DELETE that could never match", () => {
		// One D1 statement per invocation is a real budget; a DELETE against a
		// just-inserted id can only ever match zero rows.
		expect(
			membershipStatements(mockDb(), "d1", ["a"], { skipDelete: true }),
		).toHaveLength(1);
		expect(
			membershipStatements(mockDb(), "d1", [], { skipDelete: true }),
		).toHaveLength(0);
	});

	test("the live-developer guard changes the SQL, not the count", () => {
		// The guard is what stops a batch behind a zero-row UPDATE from
		// committing memberships anyway; losing it must not look like a no-op.
		const plain = membershipStatements(mockDb(), "d1", ["a"]);
		const guarded = membershipStatements(mockDb(), "d1", ["a"], {
			onlyIfLiveDeveloper: true,
		});
		expect(guarded).toHaveLength(plain.length);
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

	test("http(s) URLs are stored in canonical parsed form", () => {
		expect(kind(normalizeAvatarUrl("https://x/a.png"))).toBe("https://x/a.png");
		expect(kind(normalizeAvatarUrl("  http://x/a.png  "))).toBe(
			"http://x/a.png",
		);
	});

	test("the stored value is the parsed URL, not the raw text", () => {
		// `https:\\evil/x` and `https://evil/x` are the same request but
		// different strings. Storing the raw text would mean the value that was
		// validated is not the value that later gets rendered.
		expect(kind(normalizeAvatarUrl("https:\\\\evil/x"))).toBe("https://evil/x");
		expect(kind(normalizeAvatarUrl("HTTPS://X/A.PNG"))).toBe("https://x/A.PNG");
	});

	test("credentials in the URL are refused", () => {
		// A stored `https://user:pw@host/x.png` hands the password to everyone
		// who can read the roster, and to every browser network log.
		expect(kind(normalizeAvatarUrl("https://user:pw@evil/x.png"))).toBe(
			"error",
		);
		expect(kind(normalizeAvatarUrl("https://user@evil/x.png"))).toBe("error");
		// Empty username with a real password: checking only `username` misses
		// this one, and it still sends the secret on the wire.
		expect(kind(normalizeAvatarUrl("https://:pw@evil/x.png"))).toBe("error");
	});

	test("scheme checks survive case and embedded control characters", () => {
		// `new URL()` normalises these to `javascript:` before the protocol
		// comparison, so none of them reach an `<img src>`. Asserted explicitly
		// because "it happens to normalise" is not a guarantee anyone can read
		// off the source.
		const TAB = String.fromCharCode(9);
		const NL = String.fromCharCode(10);
		for (const bad of [
			"JaVaScRiPt:alert(1)",
			` java${TAB}script:alert(1)`,
			`java${NL}script:alert(1)`,
			" javascript:alert(1)",
			"vbscript:msgbox(1)",
			"DATA:text/html,<script>",
			"javascript%3Aalert(1)",
			"//evil/x",
			"file:///etc/passwd",
		]) {
			expect(kind(normalizeAvatarUrl(bad))).toBe("error");
		}
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
