import { describe, expect, test } from "bun:test";
import type { PullRequestSearchReport } from "../types.ts";
import { formatPrSearchReport } from "./format-pr-search.ts";

function makeReport(
	overrides?: Partial<PullRequestSearchReport>,
): PullRequestSearchReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 200,
		repository: {
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
		},
		identity: {
			resolvedUser: "alice",
			resolvedVia: "direct",
		},
		query: "created:>2025-01-01",
		totalCount: 2,
		hasNextPage: false,
		endCursor: null,
		pullRequests: [
			{
				number: 42,
				title: "Add feature",
				state: "OPEN",
				isDraft: false,
				merged: false,
				mergedAt: null,
				author: "alice",
				createdAt: "2025-01-10T00:00:00Z",
				updatedAt: "2025-01-11T00:00:00Z",
				closedAt: null,
				headRefName: "feat",
				baseRefName: "main",
				url: "https://github.com/acme/repo/pull/42",
				labels: [],
				reviewDecision: null,
				additions: 10,
				deletions: 2,
				changedFiles: 1,
			},
		],
		...overrides,
	};
}

describe("formatPrSearchReport", () => {
	test("includes search query and repo", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).toContain("acme/repo");
		expect(output).toContain("search: created:>2025-01-01");
	});

	test("includes identity", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).toContain("alice (via direct)");
	});

	test("includes result count", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).toContain("Results: 2 match(es)");
	});

	test("includes PR lines", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).toContain("#42");
		expect(output).toContain("Add feature");
	});

	test("includes duration", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).toContain("Completed in 200ms");
	});

	test("shows no results message", () => {
		const output = formatPrSearchReport(
			makeReport({ pullRequests: [], totalCount: 0 }),
		);
		expect(output).toContain("No pull requests found.");
	});

	test("shows pagination hint when hasNextPage", () => {
		const output = formatPrSearchReport(
			makeReport({ hasNextPage: true, endCursor: "cursor-abc" }),
		);
		expect(output).toContain("more results available");
		expect(output).toContain("cursor-abc");
	});

	test("hides pagination hint when no more pages", () => {
		const output = formatPrSearchReport(makeReport());
		expect(output).not.toContain("more results available");
	});
});
