import { describe, expect, test } from "bun:test";
import { sha256Hex, stableStringify } from "./stable-json.js";

describe("stableStringify", () => {
	test("sorts keys", () => {
		expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
	});

	test("sha256 deterministic", async () => {
		const h1 = await sha256Hex("hello");
		const h2 = await sha256Hex("hello");
		expect(h1).toBe(h2);
		expect(h1).toHaveLength(64);
	});
});
