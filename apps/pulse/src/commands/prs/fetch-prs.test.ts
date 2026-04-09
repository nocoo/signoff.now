import { describe, expect, test } from "bun:test";
import { MockGitHubClient } from "../../api/mock-client.ts";
import type { PullRequestInfo } from "../types.ts";
import { fetchPrs, mapStatesToGraphQL } from "./fetch-prs.ts";

function makePr(overrides?: Partial<PullRequestInfo>): PullRequestInfo {
	return {
		number: 1,
		title: "Test PR",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-16T12:00:00Z",
		closedAt: null,
		headRefName: "feature",
		baseRefName: "main",
		url: "https://github.com/acme/repo/pull/1",
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

describe("mapStatesToGraphQL", () => {
	test("maps 'open' to OPEN", () => {
		expect(mapStatesToGraphQL("open")).toEqual(["OPEN"]);
	});

	test("maps 'closed' to CLOSED only", () => {
		expect(mapStatesToGraphQL("closed")).toEqual(["CLOSED"]);
	});

	test("maps 'merged' to MERGED", () => {
		expect(mapStatesToGraphQL("merged")).toEqual(["MERGED"]);
	});

	test("maps 'all' to OPEN, CLOSED, MERGED", () => {
		expect(mapStatesToGraphQL("all")).toEqual(["OPEN", "CLOSED", "MERGED"]);
	});
});

describe("fetchPrs", () => {
	test("assembles PullRequestsReport from API response", async () => {
		const prs = [makePr({ number: 1 }), makePr({ number: 2 })];
		const client = new MockGitHubClient({
			pullRequests: prs,
			totalCount: 2,
		});

		const report = await fetchPrs(client, {
			owner: "acme",
			repo: "repo",
			state: "open",
			limit: 0,
			author: null,
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.repository).toEqual({
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
		});
		expect(report.identity).toEqual({
			resolvedUser: "alice",
			resolvedVia: "direct",
		});
		expect(report.filters).toEqual({
			state: "open",
			author: null,
			limit: 0,
		});
		expect(report.totalCount).toBe(2);
		expect(report.pullRequests).toHaveLength(2);
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
		expect(report.generatedAt).toBeTruthy();
	});

	test("passes correct states to API client", async () => {
		const client = new MockGitHubClient({
			pullRequests: [],
			totalCount: 0,
		});

		await fetchPrs(client, {
			owner: "acme",
			repo: "repo",
			state: "closed",
			limit: 10,
			author: "bob",
			resolvedUser: "alice",
			resolvedVia: "org",
		});

		expect(client.calls).toHaveLength(1);
		expect(client.calls[0]?.opts.states).toEqual(["CLOSED"]);
		expect(client.calls[0]?.opts.limit).toBe(10);
		expect(client.calls[0]?.opts.author).toBe("bob");
	});

	test("returns empty pullRequests array when no PRs found", async () => {
		const client = new MockGitHubClient({
			pullRequests: [],
			totalCount: 0,
		});

		const report = await fetchPrs(client, {
			owner: "acme",
			repo: "empty",
			state: "all",
			limit: 0,
			author: null,
			resolvedUser: "alice",
			resolvedVia: "fallback",
		});

		expect(report.pullRequests).toEqual([]);
		expect(report.totalCount).toBe(0);
	});

	test("includes author and limit in filters", async () => {
		const client = new MockGitHubClient({
			pullRequests: [],
			totalCount: 0,
		});

		const report = await fetchPrs(client, {
			owner: "acme",
			repo: "repo",
			state: "open",
			limit: 5,
			author: "bob",
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.filters.author).toBe("bob");
		expect(report.filters.limit).toBe(5);
	});
});
