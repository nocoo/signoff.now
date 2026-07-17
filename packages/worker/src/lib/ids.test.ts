import { describe, expect, test } from "bun:test";
import { newId } from "./ids.js";

describe("newId", () => {
	test("returns uuid-like string", () => {
		const id = newId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(10);
		expect(newId()).not.toBe(id);
	});
});
