import { describe, expect, test } from "bun:test";
import { derivedUlid, ulid } from "./ulid.ts";

/** The contract's own pattern, from packages/domain/src/ingest.ts. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("ulid", () => {
	test("matches the run id pattern the ingest contract enforces", () => {
		expect(ulid(1_784_737_800_000, () => 0.5)).toMatch(ULID);
	});

	test("never emits the letters Crockford base32 excludes", () => {
		// I, L, O and U are omitted because they read as 1, 1, 0 and V. A hand-
		// built id like "01JCOLLECT…" silently violates this.
		let seen = "";
		for (let i = 0; i < 64; i++) {
			seen += ulid(1_784_737_800_000 + i, () => i / 64);
		}
		expect(seen).not.toMatch(/[ILOU]/);
	});

	test("sorts lexicographically by time", () => {
		const early = ulid(1_000_000_000_000, () => 0);
		const late = ulid(2_000_000_000_000, () => 0);
		// Run manifests live in a directory listing; time order makes crash
		// recovery replay them oldest-first without parsing each one.
		expect(early < late).toBe(true);
	});

	test("differs for the same instant", () => {
		let n = 0;
		const a = ulid(1_784_737_800_000, () => {
			n += 0.0125;
			return n % 1;
		});
		const b = ulid(1_784_737_800_000, () => {
			n += 0.037;
			return n % 1;
		});
		expect(a).not.toBe(b);
		expect(a.slice(0, 10)).toBe(b.slice(0, 10));
	});

	test("uses real randomness by default", () => {
		expect(ulid()).toMatch(ULID);
		expect(ulid()).not.toBe(ulid());
	});
});

describe("derivedUlid", () => {
	const base = ulid(1_784_737_800_000, () => 0.5);

	test("stays a valid ULID", () => {
		expect(derivedUlid(base, 0)).toMatch(ULID);
		expect(derivedUlid(base, 1)).toMatch(ULID);
		expect(derivedUlid(base, 1_000_000)).toMatch(ULID);
	});

	test("distinct indices give distinct ids", () => {
		// Each artifact needs its own run id, or the server sees chunk 0 of the
		// second as a duplicate of the first.
		const ids = new Set(
			Array.from({ length: 50 }, (_, i) => derivedUlid(base, i)),
		);
		expect(ids.size).toBe(50);
	});

	test("keeps the base timestamp prefix", () => {
		expect(derivedUlid(base, 7).slice(0, 10)).toBe(base.slice(0, 10));
	});

	test("falls back to a fresh id when the base is malformed", () => {
		expect(derivedUlid("too-short", 1)).toMatch(ULID);
	});
});
