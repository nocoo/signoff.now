import { afterEach, expect, test, vi } from "vitest";
import {
	readCollectionFilters,
	saveCollectionFilters,
} from "./collectionFilters";
import { DEFAULT_PULL_FILTER, PULL_FILTER_STORAGE_KEY } from "./workbench";

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

test("persists every filter and sort independently by collection and source", () => {
	const baseline = readCollectionFilters("cli", "one");
	expect(baseline).toMatchObject({
		state: "all",
		draft: "include",
		sort: "updated",
		sortDirection: "desc",
	});
	const saved = {
		...baseline,
		state: "open" as const,
		draft: "only" as const,
		query: "test & review",
		authors: ["author-1"],
		status: "attention" as const,
		watching: "watching" as const,
		sort: "readiness" as const,
		sortDirection: "asc" as const,
	};
	localStorage.setItem(PULL_FILTER_STORAGE_KEY, "q=main-list");
	saveCollectionFilters("cli", "one", saved);
	expect(readCollectionFilters("cli", "one")).toEqual(saved);
	expect(readCollectionFilters("cli", "two")).toEqual(baseline);
	expect(readCollectionFilters("demo", "one")).toEqual({
		...baseline,
		source: "demo",
	});
	expect(localStorage.getItem(PULL_FILTER_STORAGE_KEY)).toBe("q=main-list");
	saveCollectionFilters("cli", "two", {
		...baseline,
		state: "closed",
		sort: "title",
		sortDirection: "desc",
	});
	expect(readCollectionFilters("cli", "two")).toMatchObject({
		state: "closed",
		sort: "title",
		sortDirection: "desc",
	});
	expect(readCollectionFilters("cli", "one")).toEqual(saved);
	saveCollectionFilters("cli", "one", {
		...DEFAULT_PULL_FILTER,
		source: "cli",
	});
	expect(readCollectionFilters("cli", "one")).toEqual({
		...DEFAULT_PULL_FILTER,
		source: "cli",
	});
});

test("normalizes invalid stored choices, fences collection scope and tolerates unavailable storage", () => {
	const key = `${PULL_FILTER_STORAGE_KEY}:collection:cli:one`;
	localStorage.setItem(
		key,
		"source=sample&project=other&repo=other&org=other&draft=bad&state=bad&sort=bad&direction=bad&status=bad",
	);
	expect(readCollectionFilters("cli", "one")).toEqual({
		...DEFAULT_PULL_FILTER,
		source: "cli",
	});
	vi.spyOn(localStorage, "getItem").mockImplementation(() => {
		throw new Error("Blocked");
	});
	expect(readCollectionFilters("cli", "one")).toMatchObject({
		state: "all",
		draft: "include",
	});
	vi.spyOn(localStorage, "setItem").mockImplementation(() => {
		throw new Error("Quota");
	});
	expect(() =>
		saveCollectionFilters("cli", "one", DEFAULT_PULL_FILTER),
	).not.toThrow();
});
