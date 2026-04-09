import { describe, expect, test } from "bun:test";
import { mapPullRequestNode } from "./map-pr-node.ts";
import { MockGitHubClient } from "./mock-client.ts";
import type { GraphQLPullRequestNode } from "./types.ts";

function makePrNode(
	overrides?: Partial<GraphQLPullRequestNode>,
): GraphQLPullRequestNode {
	return {
		number: 42,
		title: "Add feature X",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: { login: "alice" },
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-16T12:00:00Z",
		closedAt: null,
		headRefName: "feature-x",
		baseRefName: "main",
		url: "https://github.com/acme/repo/pull/42",
		labels: { nodes: [{ name: "enhancement" }, { name: "v2" }] },
		reviewDecision: "APPROVED",
		additions: 50,
		deletions: 10,
		changedFiles: 3,
		totalCommentsCount: 5,
		commits: { totalCount: 2 },
		...overrides,
	};
}

describe("mapPullRequestNode", () => {
	test("maps OPEN PR correctly", () => {
		const result = mapPullRequestNode(makePrNode());
		expect(result).toEqual({
			number: 42,
			title: "Add feature X",
			state: "OPEN",
			isDraft: false,
			merged: false,
			mergedAt: null,
			author: "alice",
			createdAt: "2025-01-15T10:00:00Z",
			updatedAt: "2025-01-16T12:00:00Z",
			closedAt: null,
			headRefName: "feature-x",
			baseRefName: "main",
			url: "https://github.com/acme/repo/pull/42",
			labels: ["enhancement", "v2"],
			reviewDecision: "APPROVED",
			additions: 50,
			deletions: 10,
			changedFiles: 3,
			totalCommentsCount: 5,
			commitsCount: 2,
		});
	});

	test("maps CLOSED PR state", () => {
		const result = mapPullRequestNode(makePrNode({ state: "CLOSED" }));
		expect(result.state).toBe("CLOSED");
	});

	test("maps MERGED PR state preserving MERGED value", () => {
		const result = mapPullRequestNode(
			makePrNode({
				state: "MERGED",
				merged: true,
				mergedAt: "2025-01-17T08:00:00Z",
			}),
		);
		expect(result.state).toBe("MERGED");
		expect(result.merged).toBe(true);
		expect(result.mergedAt).toBe("2025-01-17T08:00:00Z");
	});

	test("maps draft PR", () => {
		const result = mapPullRequestNode(makePrNode({ isDraft: true }));
		expect(result.isDraft).toBe(true);
	});

	test("maps null author to 'ghost'", () => {
		const result = mapPullRequestNode(makePrNode({ author: null }));
		expect(result.author).toBe("ghost");
	});

	test("maps empty labels", () => {
		const result = mapPullRequestNode(makePrNode({ labels: { nodes: [] } }));
		expect(result.labels).toEqual([]);
	});

	test("maps null reviewDecision", () => {
		const result = mapPullRequestNode(makePrNode({ reviewDecision: null }));
		expect(result.reviewDecision).toBeNull();
	});

	test("maps closedAt for closed PR", () => {
		const result = mapPullRequestNode(
			makePrNode({
				state: "CLOSED",
				closedAt: "2025-01-18T14:00:00Z",
			}),
		);
		expect(result.closedAt).toBe("2025-01-18T14:00:00Z");
	});
});

describe("MockGitHubClient", () => {
	test("returns configured response", async () => {
		const response = {
			pullRequests: [mapPullRequestNode(makePrNode())],
			totalCount: 1,
		};
		const client = new MockGitHubClient(response);

		const result = await client.fetchPullRequests("acme", "repo", {
			states: ["OPEN"],
			limit: 0,
			author: null,
		});

		expect(result).toEqual({
			...response,
			hasNextPage: false,
			endCursor: null,
		});
	});

	test("records calls", async () => {
		const client = new MockGitHubClient({ pullRequests: [], totalCount: 0 });

		await client.fetchPullRequests("acme", "repo", {
			states: ["OPEN"],
			limit: 10,
			author: "bob",
		});

		expect(client.calls).toHaveLength(1);
		expect(client.calls[0]).toEqual({
			owner: "acme",
			repo: "repo",
			opts: { states: ["OPEN"], limit: 10, author: "bob" },
		});
	});

	test("returns same response for multiple calls", async () => {
		const client = new MockGitHubClient({ pullRequests: [], totalCount: 0 });

		await client.fetchPullRequests("a", "b", {
			states: ["OPEN"],
			limit: 0,
			author: null,
		});
		await client.fetchPullRequests("c", "d", {
			states: ["CLOSED"],
			limit: 5,
			author: null,
		});

		expect(client.calls).toHaveLength(2);
	});
});
