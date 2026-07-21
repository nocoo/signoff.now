import { describe, expect, test } from "bun:test";
import { cachePath, DATA_ROOTS, normalizedPath, rawPath } from "./paths.js";

describe("paths", () => {
	test("rawPath builds ado/org/project/... path", () => {
		expect(rawPath("ado", "acme", "Alpha", "repos/foo", "prs/1234")).toBe(
			"ado/acme/Alpha/repos/foo/prs/1234",
		);
	});

	test("normalizedPath mirrors structure", () => {
		expect(normalizedPath("ado", "acme", "Alpha", "activities.json")).toBe(
			"ado/acme/Alpha/activities.json",
		);
	});

	test("cachePath defaults to bootstrap.json", () => {
		expect(cachePath()).toBe("bootstrap.json");
		expect(cachePath("settings.json")).toBe("settings.json");
	});

	test("DATA_ROOTS constants", () => {
		expect(DATA_ROOTS.raw).toBe(".data/raw");
		expect(DATA_ROOTS.normalized).toBe(".data/normalized");
		expect(DATA_ROOTS.cache).toBe(".data/cache");
	});

	test("strips leading/trailing slashes", () => {
		expect(rawPath("/ado/", "/acme/", "Alpha/")).toBe("ado/acme/Alpha");
	});
});
