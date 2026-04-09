import { describe, expect, test } from "bun:test";
import { mapPullRequestNode } from "./map-pr-node.ts";
import type { GraphQLPullRequestNode } from "./types.ts";

function makeNode(
	overrides: Partial<GraphQLPullRequestNode> = {},
): GraphQLPullRequestNode {
	return {
		number: 123,
		title: "Test PR",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: { login: "testuser" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
		closedAt: null,
		headRefName: "feature/test",
		baseRefName: "main",
		url: "https://github.com/owner/repo/pull/123",
		labels: { nodes: [] },
		reviewDecision: null,
		additions: 10,
		deletions: 5,
		changedFiles: 3,
		totalCommentsCount: null,
		commits: { totalCount: 2 },
		...overrides,
	};
}

describe("mapPullRequestNode", () => {
	test("maps all fields correctly", () => {
		const node = makeNode({
			number: 456,
			title: "Add feature X",
			state: "MERGED",
			isDraft: true,
			merged: true,
			mergedAt: "2026-01-03T12:00:00Z",
			author: { login: "alice" },
			createdAt: "2026-01-01T08:00:00Z",
			updatedAt: "2026-01-03T12:00:00Z",
			closedAt: "2026-01-03T12:00:00Z",
			headRefName: "feature/x",
			baseRefName: "develop",
			url: "https://github.com/owner/repo/pull/456",
			labels: { nodes: [{ name: "bug" }, { name: "priority" }] },
			reviewDecision: "APPROVED",
			additions: 100,
			deletions: 50,
			changedFiles: 10,
			totalCommentsCount: 5,
			commits: { totalCount: 8 },
		});

		const result = mapPullRequestNode(node);

		expect(result).toEqual({
			number: 456,
			title: "Add feature X",
			state: "MERGED",
			isDraft: true,
			merged: true,
			mergedAt: "2026-01-03T12:00:00Z",
			author: "alice",
			createdAt: "2026-01-01T08:00:00Z",
			updatedAt: "2026-01-03T12:00:00Z",
			closedAt: "2026-01-03T12:00:00Z",
			headRefName: "feature/x",
			baseRefName: "develop",
			url: "https://github.com/owner/repo/pull/456",
			labels: ["bug", "priority"],
			reviewDecision: "APPROVED",
			additions: 100,
			deletions: 50,
			changedFiles: 10,
			totalCommentsCount: 5,
			commitsCount: 8,
		});
	});

	test('falls back to "ghost" when author is null', () => {
		const node = makeNode({ author: null });

		const result = mapPullRequestNode(node);

		expect(result.author).toBe("ghost");
	});

	test("extracts label names from nodes array", () => {
		const node = makeNode({
			labels: {
				nodes: [
					{ name: "enhancement" },
					{ name: "documentation" },
					{ name: "good first issue" },
				],
			},
		});

		const result = mapPullRequestNode(node);

		expect(result.labels).toEqual([
			"enhancement",
			"documentation",
			"good first issue",
		]);
	});

	test("returns empty array when no labels", () => {
		const node = makeNode({ labels: { nodes: [] } });

		const result = mapPullRequestNode(node);

		expect(result.labels).toEqual([]);
	});

	test("preserves null reviewDecision", () => {
		const node = makeNode({ reviewDecision: null });

		const result = mapPullRequestNode(node);

		expect(result.reviewDecision).toBeNull();
	});

	test("maps reviewDecision when present", () => {
		const node = makeNode({ reviewDecision: "CHANGES_REQUESTED" });

		const result = mapPullRequestNode(node);

		expect(result.reviewDecision).toBe("CHANGES_REQUESTED");
	});

	test("falls back to 0 when totalCommentsCount is null", () => {
		const node = makeNode({ totalCommentsCount: null });

		const result = mapPullRequestNode(node);

		expect(result.totalCommentsCount).toBe(0);
	});

	test("maps totalCommentsCount when present", () => {
		const node = makeNode({ totalCommentsCount: 42 });

		const result = mapPullRequestNode(node);

		expect(result.totalCommentsCount).toBe(42);
	});

	test("maps commitsCount from commits.totalCount", () => {
		const node = makeNode({ commits: { totalCount: 15 } });

		const result = mapPullRequestNode(node);

		expect(result.commitsCount).toBe(15);
	});
});
