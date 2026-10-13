import { describe, expect, test } from "bun:test";
import { sha256Hex, stableStringify } from "./stable-json.js";

describe("stableStringify", () => {
	test("sorts keys", () => {
		expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
	});

	test("sorts keys by UTF-16 code units (not locale)", () => {
		expect(stableStringify({ A: 1, a: 2 })).toBe('{"A":1,"a":2}');
	});

	test("digest matches persisted chunk metadata (replay-safe key order)", async () => {
		const digest = await sha256Hex(stableStringify({ A: 1, a: 2 }));
		expect(digest).toBe(
			"0d0e3924a16d7710884d7aaf5ddacfafcef0079c6717e1415b8074f911635606",
		);
	});

	test("sha256 deterministic", async () => {
		const h1 = await sha256Hex("hello");
		const h2 = await sha256Hex("hello");
		expect(h1).toBe(h2);
		expect(h1).toHaveLength(64);
	});
});
