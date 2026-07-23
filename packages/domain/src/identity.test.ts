import { describe, expect, test } from "bun:test";
import { matchDeveloper } from "./identity.js";

describe("matchDeveloper", () => {
	const devs = [
		{ id: "b", alias: "bob" },
		{ id: "a", alias: "ada" },
	];

	test("exact match case-insensitive", () => {
		expect(matchDeveloper("Ada@Example.COM", devs, ["example.com"])).toEqual({
			id: "a",
		});
	});

	test("no match", () => {
		expect(matchDeveloper("x@example.com", devs, ["example.com"])).toBeNull();
	});

	test("empty uniqueName", () => {
		expect(matchDeveloper("", devs, ["example.com"])).toBeNull();
	});

	test("multiple hits → lexicographically smallest id", () => {
		const d = [
			{ id: "z", alias: "same" },
			{ id: "m", alias: "same" },
		];
		expect(matchDeveloper("same@ex.com", d, ["ex.com"])).toEqual({ id: "m" });
	});

	test("empty alias skipped", () => {
		expect(
			matchDeveloper("x@ex.com", [{ id: "1", alias: "  " }], ["ex.com"]),
		).toBeNull();
	});
});
