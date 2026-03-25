import { describe, expect, test } from "bun:test";
import { MockGitHubClient } from "../../api/mock-client.ts";
import { fetchPrSearch } from "./fetch-pr-search.ts";

function makePrInfo(number: number) {
	return {
		number,
		title: `PR #${number}`,
		state: "OPEN" as const,
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-02T00:00:00Z",
		closedAt: null,
		headRefName: "feat",
		baseRefName: "main",
		url: `https://github.com/acme/repo/pull/${number}`,
		labels: [],
		reviewDecision: null,
		additions: 10,
		deletions: 2,
		changedFiles: 1,
	};
}

describe("fetchPrSearch", () => {
	const searchResponse = {
		pullRequests: [makePrInfo(1), makePrInfo(2)],
		totalCount: 42,
		hasNextPage: true,
		endCursor: "cursor-abc",
	};

	test("assembles search report from API result", async () => {
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			searchResponse,
		);

		const report = await fetchPrSearch(client, {
			owner: "acme",
			repo: "repo",
			query: "created:>2025-01-01",
			limit: 100,
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.repository.owner).toBe("acme");
		expect(report.repository.name).toBe("repo");
		expect(report.repository.url).toBe("https://github.com/acme/repo");
		expect(report.identity.resolvedUser).toBe("alice");
		expect(report.query).toBe("created:>2025-01-01");
		expect(report.totalCount).toBe(42);
		expect(report.hasNextPage).toBe(true);
		expect(report.endCursor).toBe("cursor-abc");
		expect(report.pullRequests).toHaveLength(2);
		expect(report.generatedAt).toBeTruthy();
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("records search API call", async () => {
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			searchResponse,
		);

		await fetchPrSearch(client, {
			owner: "acme",
			repo: "widget",
			query: "label:bug",
			limit: 50,
			cursor: "page-2",
			resolvedUser: "bob",
			resolvedVia: "org",
		});

		expect(client.searchCalls).toHaveLength(1);
		expect(client.searchCalls[0]).toEqual({
			owner: "acme",
			repo: "widget",
			opts: { query: "label:bug", limit: 50, cursor: "page-2" },
		});
	});
});
