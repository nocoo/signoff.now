import { afterEach, describe, expect, mock, test } from "bun:test";
import { GitHubClient } from "./github-client.ts";
import type {
	GraphQLPullRequestDetailNode,
	GraphQLPullRequestDetailResponse,
} from "./types.ts";

const NO_MORE_PAGES = { hasNextPage: false, endCursor: null };

function makeMinimalDetailNode(
	overrides?: Partial<GraphQLPullRequestDetailNode>,
): GraphQLPullRequestDetailNode {
	return {
		number: 1,
		title: "Test PR",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: { login: "alice" },
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		closedAt: null,
		headRefName: "feature",
		baseRefName: "main",
		url: "https://github.com/acme/repo/pull/1",
		labels: { nodes: [] },
		reviewDecision: null,
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		body: "",
		mergeable: "UNKNOWN",
		mergeStateStatus: "UNKNOWN",
		mergedBy: null,
		totalCommentsCount: 0,
		headRefOid: "aaa",
		baseRefOid: "bbb",
		isCrossRepository: false,
		participants: { pageInfo: NO_MORE_PAGES, nodes: [] },
		assignees: { pageInfo: NO_MORE_PAGES, nodes: [] },
		reviewRequests: { pageInfo: NO_MORE_PAGES, nodes: [] },
		milestone: null,
		reviews: { pageInfo: NO_MORE_PAGES, nodes: [] },
		comments: { pageInfo: NO_MORE_PAGES, nodes: [] },
		commits: { pageInfo: NO_MORE_PAGES, nodes: [] },
		files: { pageInfo: NO_MORE_PAGES, nodes: [] },
		...overrides,
	};
}

function wrapDetailResponse(
	node: GraphQLPullRequestDetailNode,
): GraphQLPullRequestDetailResponse {
	return {
		data: { repository: { pullRequest: node } },
	};
}

function mockFetchSequence(responses: unknown[]) {
	let callIndex = 0;
	return mock(() => {
		const body = responses[callIndex++];
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(body),
		});
	});
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("GitHubClient nested pagination", () => {
	test("does not issue follow-up queries when all connections fit in first page", async () => {
		const node = makeMinimalDetailNode({
			comments: {
				pageInfo: NO_MORE_PAGES,
				nodes: [
					{
						author: { login: "bob" },
						body: "LGTM",
						createdAt: "2025-01-01T00:00:00Z",
						updatedAt: "2025-01-01T00:00:00Z",
					},
				],
			},
		});

		const fetchMock = mockFetchSequence([wrapDetailResponse(node)]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.comments).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("paginates comments when hasNextPage is true", async () => {
		const node = makeMinimalDetailNode({
			comments: {
				pageInfo: { hasNextPage: true, endCursor: "cursor1" },
				nodes: [
					{
						author: { login: "alice" },
						body: "Page 1",
						createdAt: "2025-01-01T00:00:00Z",
						updatedAt: "2025-01-01T00:00:00Z",
					},
				],
			},
		});

		const page2Response = {
			data: {
				repository: {
					pullRequest: {
						comments: {
							pageInfo: NO_MORE_PAGES,
							nodes: [
								{
									author: { login: "bob" },
									body: "Page 2",
									createdAt: "2025-01-02T00:00:00Z",
									updatedAt: "2025-01-02T00:00:00Z",
								},
							],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([
			wrapDetailResponse(node),
			page2Response,
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.comments).toHaveLength(2);
		expect(result.pullRequest.comments[0]?.body).toBe("Page 1");
		expect(result.pullRequest.comments[1]?.body).toBe("Page 2");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("paginates files across multiple pages", async () => {
		const node = makeMinimalDetailNode({
			files: {
				pageInfo: { hasNextPage: true, endCursor: "fc1" },
				nodes: [
					{
						path: "a.ts",
						additions: 1,
						deletions: 0,
						changeType: "ADDED",
					},
				],
			},
		});

		const page2Response = {
			data: {
				repository: {
					pullRequest: {
						files: {
							pageInfo: { hasNextPage: true, endCursor: "fc2" },
							nodes: [
								{
									path: "b.ts",
									additions: 2,
									deletions: 1,
									changeType: "MODIFIED",
								},
							],
						},
					},
				},
			},
		};

		const page3Response = {
			data: {
				repository: {
					pullRequest: {
						files: {
							pageInfo: NO_MORE_PAGES,
							nodes: [
								{
									path: "c.ts",
									additions: 0,
									deletions: 5,
									changeType: "DELETED",
								},
							],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([
			wrapDetailResponse(node),
			page2Response,
			page3Response,
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.files).toHaveLength(3);
		expect(result.pullRequest.files.map((f) => f.path)).toEqual([
			"a.ts",
			"b.ts",
			"c.ts",
		]);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("paginates reviews and commits independently", async () => {
		const node = makeMinimalDetailNode({
			reviews: {
				pageInfo: { hasNextPage: true, endCursor: "rc1" },
				nodes: [
					{
						id: "review-1",
						author: { login: "reviewer1" },
						state: "APPROVED",
						body: "LGTM",
						submittedAt: "2025-01-01T00:00:00Z",
						comments: { pageInfo: NO_MORE_PAGES, nodes: [] },
					},
				],
			},
			commits: {
				pageInfo: { hasNextPage: true, endCursor: "cc1" },
				nodes: [
					{
						commit: {
							abbreviatedOid: "aaa",
							oid: "aaa0000000000000000000000000000000000000a",
							message: "commit 1",
							author: { user: { login: "alice" }, name: "Alice" },
							authoredDate: "2025-01-01T00:00:00Z",
							statusCheckRollup: null,
						},
					},
				],
			},
		});

		// Reviews page 2
		const reviewsPage2 = {
			data: {
				repository: {
					pullRequest: {
						reviews: {
							pageInfo: NO_MORE_PAGES,
							nodes: [
								{
									id: "review-2",
									author: { login: "reviewer2" },
									state: "CHANGES_REQUESTED",
									body: "Fix this",
									submittedAt: "2025-01-02T00:00:00Z",
									comments: { pageInfo: NO_MORE_PAGES, nodes: [] },
								},
							],
						},
					},
				},
			},
		};

		// Commits page 2
		const commitsPage2 = {
			data: {
				repository: {
					pullRequest: {
						commits: {
							pageInfo: NO_MORE_PAGES,
							nodes: [
								{
									commit: {
										abbreviatedOid: "bbb",
										oid: "bbb0000000000000000000000000000000000000b",
										message: "commit 2",
										author: { user: { login: "alice" }, name: "Alice" },
										authoredDate: "2025-01-02T00:00:00Z",
										statusCheckRollup: null,
									},
								},
							],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([
			wrapDetailResponse(node),
			reviewsPage2,
			commitsPage2,
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.reviews).toHaveLength(2);
		expect(result.pullRequest.commits).toHaveLength(2);
		expect(result.pullRequest.reviews[1]?.author).toBe("reviewer2");
		expect(result.pullRequest.commits[1]?.abbreviatedOid).toBe("bbb");
		// 1 initial + 1 reviews page + 1 commits page = 3 calls
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("skips pagination for null files connection", async () => {
		const node = makeMinimalDetailNode({ files: null });

		const fetchMock = mockFetchSequence([wrapDetailResponse(node)]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.files).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("throws on GraphQL errors in follow-up query", async () => {
		const node = makeMinimalDetailNode({
			comments: {
				pageInfo: { hasNextPage: true, endCursor: "cursor1" },
				nodes: [],
			},
		});

		const errorResponse = {
			data: { repository: { pullRequest: { comments: null } } },
			errors: [{ message: "Rate limited" }],
		};

		const fetchMock = mockFetchSequence([
			wrapDetailResponse(node),
			errorResponse,
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		expect(client.fetchPullRequestDetail("acme", "repo", 1)).rejects.toThrow(
			"Rate limited",
		);
	});

	test("paginates participants when hasNextPage is true", async () => {
		const node = makeMinimalDetailNode({
			participants: {
				pageInfo: { hasNextPage: true, endCursor: "p-cursor" },
				nodes: [{ login: "alice" }],
			},
		});

		const page2 = {
			data: {
				repository: {
					pullRequest: {
						participants: {
							pageInfo: NO_MORE_PAGES,
							nodes: [{ login: "bob" }],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([wrapDetailResponse(node), page2]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.participants).toEqual(["alice", "bob"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("paginates assignees when hasNextPage is true", async () => {
		const node = makeMinimalDetailNode({
			assignees: {
				pageInfo: { hasNextPage: true, endCursor: "a-cursor" },
				nodes: [{ login: "alice" }],
			},
		});

		const page2 = {
			data: {
				repository: {
					pullRequest: {
						assignees: {
							pageInfo: NO_MORE_PAGES,
							nodes: [{ login: "charlie" }],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([wrapDetailResponse(node), page2]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.assignees).toEqual(["alice", "charlie"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("paginates reviewRequests when hasNextPage is true", async () => {
		const node = makeMinimalDetailNode({
			reviewRequests: {
				pageInfo: { hasNextPage: true, endCursor: "rr-cursor" },
				nodes: [{ requestedReviewer: { login: "alice" } }],
			},
		});

		const page2 = {
			data: {
				repository: {
					pullRequest: {
						reviewRequests: {
							pageInfo: NO_MORE_PAGES,
							nodes: [{ requestedReviewer: { slug: "team-a" } }],
						},
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([wrapDetailResponse(node), page2]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.reviewRequests).toEqual(["alice", "team-a"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("paginates review comments via node(id:) query", async () => {
		const node = makeMinimalDetailNode({
			reviews: {
				pageInfo: NO_MORE_PAGES,
				nodes: [
					{
						id: "review-abc",
						author: { login: "reviewer1" },
						state: "COMMENTED",
						body: "",
						submittedAt: "2025-01-01T00:00:00Z",
						comments: {
							pageInfo: { hasNextPage: true, endCursor: "rc-cursor" },
							nodes: [
								{
									author: { login: "reviewer1" },
									path: "src/a.ts",
									line: 10,
									originalLine: 10,
									diffHunk: "@@ -1 +1 @@",
									body: "comment 1",
									createdAt: "2025-01-01T00:00:00Z",
									updatedAt: "2025-01-01T00:00:00Z",
								},
							],
						},
					},
				],
			},
		});

		const commentsPage2 = {
			data: {
				node: {
					comments: {
						pageInfo: NO_MORE_PAGES,
						nodes: [
							{
								author: { login: "reviewer1" },
								path: "src/b.ts",
								line: 20,
								originalLine: 20,
								diffHunk: "@@ -5 +5 @@",
								body: "comment 2",
								createdAt: "2025-01-02T00:00:00Z",
								updatedAt: "2025-01-02T00:00:00Z",
							},
						],
					},
				},
			},
		};

		const fetchMock = mockFetchSequence([
			wrapDetailResponse(node),
			commentsPage2,
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		expect(result.pullRequest.reviews).toHaveLength(1);
		const review = result.pullRequest.reviews[0];
		expect(review?.comments).toHaveLength(2);
		expect(review?.comments[0]?.body).toBe("comment 1");
		expect(review?.comments[1]?.body).toBe("comment 2");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("skips review comments pagination when review has no id", async () => {
		const node = makeMinimalDetailNode({
			reviews: {
				pageInfo: NO_MORE_PAGES,
				nodes: [
					{
						// no id field
						author: { login: "reviewer1" },
						state: "APPROVED",
						body: "LGTM",
						submittedAt: "2025-01-01T00:00:00Z",
						comments: {
							pageInfo: { hasNextPage: true, endCursor: "should-skip" },
							nodes: [],
						},
					} as unknown as GraphQLPullRequestDetailNode["reviews"]["nodes"][0],
				],
			},
		});

		const fetchMock = mockFetchSequence([wrapDetailResponse(node)]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new GitHubClient("test-token");
		const result = await client.fetchPullRequestDetail("acme", "repo", 1);

		// Should only make the initial call, no follow-up for review comments
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.pullRequest.reviews).toHaveLength(1);
	});
});
