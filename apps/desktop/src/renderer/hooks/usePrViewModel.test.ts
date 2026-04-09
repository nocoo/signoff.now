/**
 * Tests for usePrViewModel pure helper functions.
 *
 * The hook itself orchestrates tRPC queries/mutations (tested via integration).
 * These tests cover the extracted pure logic: author filter and loading states.
 */

import { describe, expect, test } from "bun:test";
import type { PullRequestInfo } from "@signoff/pulse";
import {
	deriveIsDetailLoading,
	deriveIsLoading,
	filterPrsByAuthor,
} from "./usePrViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
	return {
		number: 1,
		title: "feat: add tests",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-15T12:00:00Z",
		closedAt: null,
		headRefName: "feat/tests",
		baseRefName: "main",
		url: "https://github.com/org/repo/pull/1",
		labels: [],
		reviewDecision: null,
		additions: 10,
		deletions: 5,
		changedFiles: 2,
		totalCommentsCount: 0,
		commitsCount: 1,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// filterPrsByAuthor
// ---------------------------------------------------------------------------

describe("filterPrsByAuthor", () => {
	const prs = [
		makePr({ number: 1, author: "alice" }),
		makePr({ number: 2, author: "Bob" }),
		makePr({ number: 3, author: "alice-dev" }),
		makePr({ number: 4, author: "charlie" }),
	];

	test("returns all PRs when authorFilter is empty", () => {
		expect(filterPrsByAuthor(prs, "")).toHaveLength(4);
	});

	test("returns all PRs when authorFilter is whitespace-only", () => {
		// whitespace is not trimmed — intentional (user may be typing)
		expect(filterPrsByAuthor(prs, " ")).toHaveLength(0);
	});

	test("filters by partial match", () => {
		const result = filterPrsByAuthor(prs, "ali");
		expect(result).toHaveLength(2);
		expect(result.map((p) => p.author)).toEqual(["alice", "alice-dev"]);
	});

	test("case insensitive", () => {
		const result = filterPrsByAuthor(prs, "BOB");
		expect(result).toHaveLength(1);
		expect(result[0].author).toBe("Bob");
	});

	test("returns empty when no match", () => {
		expect(filterPrsByAuthor(prs, "zara")).toHaveLength(0);
	});

	test("handles empty PR list", () => {
		expect(filterPrsByAuthor([], "alice")).toHaveLength(0);
	});

	test("exact match returns the PR", () => {
		const result = filterPrsByAuthor(prs, "charlie");
		expect(result).toHaveLength(1);
		expect(result[0].number).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// deriveIsLoading
// ---------------------------------------------------------------------------

describe("deriveIsLoading", () => {
	test("true when query is loading", () => {
		expect(deriveIsLoading(true, false, false)).toBe(true);
	});

	test("true when no cached data and mutation is pending", () => {
		expect(deriveIsLoading(false, false, true)).toBe(true);
	});

	test("false when cached data exists and mutation is pending (refreshing, not loading)", () => {
		expect(deriveIsLoading(false, true, true)).toBe(false);
	});

	test("false when query done and has cached data", () => {
		expect(deriveIsLoading(false, true, false)).toBe(false);
	});

	test("false when query done, no cache, no mutation", () => {
		expect(deriveIsLoading(false, false, false)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// deriveIsDetailLoading
// ---------------------------------------------------------------------------

describe("deriveIsDetailLoading", () => {
	test("false when no PR is selected", () => {
		expect(deriveIsDetailLoading(null, true, null, true)).toBe(false);
	});

	test("true when selected and detail query is loading", () => {
		expect(deriveIsDetailLoading(42, true, null, false)).toBe(true);
	});

	test("true when selected, no cache, and mutation pending", () => {
		expect(deriveIsDetailLoading(42, false, null, true)).toBe(true);
	});

	test("false when selected and detail data exists (even if mutation pending)", () => {
		const detailData = { body: "test" }; // truthy = has cache
		expect(deriveIsDetailLoading(42, false, detailData, true)).toBe(false);
	});

	test("false when selected, query done, has data, no mutation", () => {
		const detailData = { body: "test" };
		expect(deriveIsDetailLoading(42, false, detailData, false)).toBe(false);
	});

	test("true when selected, query done, no data, mutation pending", () => {
		expect(deriveIsDetailLoading(42, false, undefined, true)).toBe(true);
	});
});
