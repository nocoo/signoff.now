import { describe, expect, test } from "bun:test";
import { normalizeAlias, normalizeColor, normalizeName } from "./entities.js";

describe("normalizeAlias", () => {
	test("lowercases", () => {
		expect(normalizeAlias("Ada")).toBe("ada");
	});
	test("rejects email", () => {
		expect(normalizeAlias("a@b.com")).toBeNull();
	});
});

describe("normalizeName", () => {
	test("trims", () => {
		expect(normalizeName("  Ada  ")).toBe("Ada");
	});
});

describe("normalizeColor", () => {
	test("accepts hex", () => {
		expect(normalizeColor("#3b82f6")).toBe("#3B82F6");
	});
	test("rejects short", () => {
		expect(normalizeColor("#fff")).toBeNull();
	});
});
