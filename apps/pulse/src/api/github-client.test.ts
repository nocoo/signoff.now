import { afterEach, describe, expect, mock, test } from "bun:test";
import { GitHubClient } from "./github-client.ts";
import type { GraphQLPrsResponse } from "./types.ts";

const OK_RESPONSE: GraphQLPrsResponse = {
	data: {
		repository: {
			pullRequests: {
				pageInfo: { hasNextPage: false, endCursor: null },
				nodes: [
					{
						number: 1,
						title: "Test PR",
						state: "OPEN",
						isDraft: false,
						merged: false,
						mergedAt: null,
						author: { login: "alice" },
						createdAt: "2025-01-01T00:00:00Z",
						updatedAt: "2025-01-02T00:00:00Z",
						closedAt: null,
						headRefName: "feat",
						baseRefName: "main",
						url: "https://github.com/o/r/pull/1",
						labels: { nodes: [] },
						reviewDecision: null,
						additions: 10,
						deletions: 2,
						changedFiles: 1,
					},
				],
			},
		},
	},
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		statusText: status === 200 ? "OK" : "Bad Gateway",
		headers: { "Content-Type": "application/json" },
	});
}

/** Create a client with zero retry delay for fast tests. */
function fastClient(token = "test-token") {
	return new GitHubClient(token, { retryDelayMs: 0 });
}

describe("GitHubClient retry", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("succeeds on first attempt", async () => {
		const fetchMock = mock(() => Promise.resolve(jsonResponse(OK_RESPONSE)));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequests("o", "r", {
			states: ["OPEN"],
			limit: 0,
			author: null,
		});

		expect(result.totalCount).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("retries on 502 and eventually succeeds", async () => {
		let callCount = 0;
		const fetchMock = mock(() => {
			callCount++;
			if (callCount <= 2) {
				return Promise.resolve(jsonResponse({}, 502));
			}
			return Promise.resolve(jsonResponse(OK_RESPONSE));
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequests("o", "r", {
			states: ["OPEN"],
			limit: 0,
			author: null,
		});

		expect(result.totalCount).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("throws after exhausting retries on 502", async () => {
		const fetchMock = mock(() => Promise.resolve(jsonResponse({}, 502)));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = fastClient();
		await expect(
			client.fetchPullRequests("o", "r", {
				states: ["OPEN"],
				limit: 0,
				author: null,
			}),
		).rejects.toThrow("GitHub API error: 502");

		// 1 initial + 3 retries = 4 total
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	test("does not retry on 401", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response("Unauthorized", {
					status: 401,
					statusText: "Unauthorized",
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = fastClient("bad-token");
		await expect(
			client.fetchPullRequests("o", "r", {
				states: ["OPEN"],
				limit: 0,
				author: null,
			}),
		).rejects.toThrow("GitHub API error: 401");

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("retries on 503 and 504", async () => {
		let callCount = 0;
		const fetchMock = mock(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve(jsonResponse({}, 503));
			if (callCount === 2) return Promise.resolve(jsonResponse({}, 504));
			return Promise.resolve(jsonResponse(OK_RESPONSE));
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequests("o", "r", {
			states: ["OPEN"],
			limit: 0,
			author: null,
		});

		expect(result.totalCount).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

// ---------------------------------------------------------------------------
// REST: fetchPullRequestFiles
// ---------------------------------------------------------------------------

describe("GitHubClient.fetchPullRequestFiles", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("maps REST file entries to PullRequestChangedFileWithPatch", async () => {
		const restFiles = [
			{
				filename: "src/index.ts",
				status: "modified",
				additions: 5,
				deletions: 2,
				changes: 7,
				patch: "@@ -1 +1 @@\n-old\n+new",
			},
			{
				filename: "README.md",
				status: "added",
				additions: 10,
				deletions: 0,
				changes: 10,
			},
		];

		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(restFiles)),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestFiles("o", "r", 42);

		expect(result.files).toHaveLength(2);
		expect(result.files[0]).toEqual({
			path: "src/index.ts",
			additions: 5,
			deletions: 2,
			changeType: "MODIFIED",
			patch: "@@ -1 +1 @@\n-old\n+new",
		});
		expect(result.files[1]).toEqual({
			path: "README.md",
			additions: 10,
			deletions: 0,
			changeType: "ADDED",
			patch: null,
		});
	});

	test("paginates when page is full (100 items)", async () => {
		const fullPage = Array.from({ length: 100 }, (_, i) => ({
			filename: `file-${i}.ts`,
			status: "modified",
			additions: 1,
			deletions: 0,
			changes: 1,
			patch: "+line",
		}));
		const lastPage = [
			{
				filename: "last.ts",
				status: "added",
				additions: 1,
				deletions: 0,
				changes: 1,
			},
		];

		let callCount = 0;
		globalThis.fetch = mock(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve(jsonResponse(fullPage));
			return Promise.resolve(jsonResponse(lastPage));
		}) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestFiles("o", "r", 42);

		expect(result.files).toHaveLength(101);
		expect(result.files[100]?.path).toBe("last.ts");
	});

	test("retries on 502 for REST endpoint", async () => {
		const files = [
			{
				filename: "a.ts",
				status: "modified",
				additions: 1,
				deletions: 0,
				changes: 1,
			},
		];

		let callCount = 0;
		globalThis.fetch = mock(() => {
			callCount++;
			if (callCount <= 2) return Promise.resolve(jsonResponse({}, 502));
			return Promise.resolve(jsonResponse(files));
		}) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestFiles("o", "r", 42);

		expect(result.files).toHaveLength(1);
		expect(callCount).toBe(3);
	});

	test("throws on non-retryable REST error (401)", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response("Unauthorized", {
					status: 401,
					statusText: "Unauthorized",
				}),
			),
		) as unknown as typeof fetch;

		const client = fastClient();
		await expect(client.fetchPullRequestFiles("o", "r", 42)).rejects.toThrow(
			"GitHub API error: 401",
		);
	});

	test("maps all REST status values correctly", async () => {
		const files = [
			{
				filename: "a.ts",
				status: "added",
				additions: 1,
				deletions: 0,
				changes: 1,
			},
			{
				filename: "b.ts",
				status: "removed",
				additions: 0,
				deletions: 1,
				changes: 1,
			},
			{
				filename: "c.ts",
				status: "modified",
				additions: 1,
				deletions: 1,
				changes: 2,
			},
			{
				filename: "d.ts",
				status: "renamed",
				additions: 0,
				deletions: 0,
				changes: 0,
			},
			{
				filename: "e.ts",
				status: "copied",
				additions: 1,
				deletions: 0,
				changes: 1,
			},
			{
				filename: "f.ts",
				status: "changed",
				additions: 1,
				deletions: 0,
				changes: 1,
			},
			{
				filename: "g.ts",
				status: "unknown_status",
				additions: 0,
				deletions: 0,
				changes: 0,
			},
		];

		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(files)),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestFiles("o", "r", 42);

		expect(result.files.map((f) => f.changeType)).toEqual([
			"ADDED",
			"DELETED",
			"MODIFIED",
			"RENAMED",
			"COPIED",
			"MODIFIED", // "changed" maps to MODIFIED
			"CHANGED", // unknown falls through to default
		]);
	});
});

// ---------------------------------------------------------------------------
// REST: fetchPullRequestDiff
// ---------------------------------------------------------------------------

describe("GitHubClient.fetchPullRequestDiff", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("returns raw diff text", async () => {
		const diffText =
			"diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n+new line";

		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(diffText, { status: 200 })),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestDiff("o", "r", 42);

		expect(result).toBe(diffText);
	});

	test("sends correct Accept header for diff format", async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = mock((_url: string, init?: RequestInit) => {
			capturedHeaders = new Headers(init?.headers);
			return Promise.resolve(new Response("diff content", { status: 200 }));
		}) as unknown as typeof fetch;

		const client = fastClient();
		await client.fetchPullRequestDiff("o", "r", 42);

		expect(capturedHeaders?.get("Accept")).toBe("application/vnd.github.diff");
	});

	test("retries on 503 for diff endpoint", async () => {
		let callCount = 0;
		globalThis.fetch = mock(() => {
			callCount++;
			if (callCount <= 1) {
				return Promise.resolve(
					new Response("Bad Gateway", {
						status: 503,
						statusText: "Service Unavailable",
					}),
				);
			}
			return Promise.resolve(new Response("diff content", { status: 200 }));
		}) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchPullRequestDiff("o", "r", 42);

		expect(result).toBe("diff content");
		expect(callCount).toBe(2);
	});

	test("throws after exhausting retries for diff endpoint", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
			),
		) as unknown as typeof fetch;

		const client = fastClient();
		await expect(client.fetchPullRequestDiff("o", "r", 42)).rejects.toThrow(
			"GitHub API error: 502",
		);
	});
});

// ---------------------------------------------------------------------------
// GraphQL: searchPullRequests
// ---------------------------------------------------------------------------

function searchResponse(
	nodes: Record<string, unknown>[],
	pageInfo = { hasNextPage: false, endCursor: null as string | null },
	issueCount = nodes.length,
) {
	return {
		data: {
			search: {
				issueCount,
				pageInfo,
				nodes,
			},
		},
	};
}

function makeSearchNode(overrides?: Record<string, unknown>) {
	return {
		__typename: "PullRequest",
		number: 1,
		title: "Test PR",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: { login: "alice" },
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-02T00:00:00Z",
		closedAt: null,
		headRefName: "feat",
		baseRefName: "main",
		url: "https://github.com/o/r/pull/1",
		labels: { nodes: [] },
		reviewDecision: null,
		additions: 10,
		deletions: 2,
		changedFiles: 1,
		...overrides,
	};
}

describe("GitHubClient.searchPullRequests", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("returns mapped PR results from search", async () => {
		const resp = searchResponse([makeSearchNode()]);
		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(resp)),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.searchPullRequests("o", "r", {
			query: "created:2025-01-01..2025-01-31",
			limit: 100,
		});

		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0]?.number).toBe(1);
		expect(result.totalCount).toBe(1);
		expect(result.hasNextPage).toBe(false);
	});

	test("includes repo scope and is:pr in search query", async () => {
		let capturedBody = "";
		globalThis.fetch = mock((_url: string, init?: RequestInit) => {
			capturedBody = (init?.body as string) ?? "";
			return Promise.resolve(jsonResponse(searchResponse([])));
		}) as unknown as typeof fetch;

		const client = fastClient();
		await client.searchPullRequests("acme", "widget", {
			query: "created:>2025-01-01",
			limit: 10,
		});

		const parsed = JSON.parse(capturedBody);
		expect(parsed.variables.query).toContain("repo:acme/widget");
		expect(parsed.variables.query).toContain("is:pr");
		expect(parsed.variables.query).toContain("created:>2025-01-01");
	});

	test("filters out non-PullRequest nodes", async () => {
		const resp = searchResponse([
			makeSearchNode({ number: 1 }),
			{ __typename: "Issue", number: 2, title: "An Issue" },
			makeSearchNode({ number: 3 }),
		]);
		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(resp)),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.searchPullRequests("o", "r", {
			query: "label:bug",
			limit: 100,
		});

		expect(result.pullRequests).toHaveLength(2);
		expect(result.pullRequests.map((p) => p.number)).toEqual([1, 3]);
	});

	test("respects limit and stops early", async () => {
		const resp = searchResponse(
			[
				makeSearchNode({ number: 1 }),
				makeSearchNode({ number: 2 }),
				makeSearchNode({ number: 3 }),
			],
			{ hasNextPage: true, endCursor: "cursor-1" },
			50,
		);
		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(resp)),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.searchPullRequests("o", "r", {
			query: "is:open",
			limit: 2,
		});

		expect(result.pullRequests).toHaveLength(2);
		expect(result.totalCount).toBe(50);
		expect(result.hasNextPage).toBe(true);
	});

	test("paginates across multiple pages", async () => {
		let callCount = 0;
		globalThis.fetch = mock(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve(
					jsonResponse(
						searchResponse(
							[makeSearchNode({ number: 1 })],
							{ hasNextPage: true, endCursor: "cursor-1" },
							2,
						),
					),
				);
			}
			return Promise.resolve(
				jsonResponse(searchResponse([makeSearchNode({ number: 2 })])),
			);
		}) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.searchPullRequests("o", "r", {
			query: "is:open",
			limit: 0,
		});

		expect(result.pullRequests).toHaveLength(2);
		expect(callCount).toBe(2);
	});

	test("throws on GraphQL error", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				jsonResponse({
					data: { search: null },
					errors: [{ message: "Bad query" }],
				}),
			),
		) as unknown as typeof fetch;

		const client = fastClient();
		await expect(
			client.searchPullRequests("o", "r", {
				query: "invalid",
				limit: 10,
			}),
		).rejects.toThrow("GitHub GraphQL error: Bad query");
	});
});

// ---------------------------------------------------------------------------
// GraphQL: fetchRepository
// ---------------------------------------------------------------------------

function repoResponse(node: Record<string, unknown>) {
	return {
		data: {
			repository: node,
		},
	};
}

function makeRepoNode(overrides?: Record<string, unknown>) {
	return {
		name: "repo",
		url: "https://github.com/o/repo",
		description: "A test repo",
		homepageUrl: "https://example.com",
		stargazerCount: 42,
		forkCount: 5,
		isArchived: false,
		isPrivate: false,
		primaryLanguage: { name: "TypeScript", color: "#3178c6" },
		languages: { nodes: [{ name: "TypeScript", color: "#3178c6" }] },
		defaultBranchRef: { name: "main" },
		licenseInfo: { spdxId: "MIT" },
		repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
		pushedAt: "2025-01-10T00:00:00Z",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2025-01-10T00:00:00Z",
		...overrides,
	};
}

describe("GitHubClient.fetchRepository", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("maps repository node to RepositoryInfo", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(repoResponse(makeRepoNode()))),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchRepository("o", "repo");

		expect(result.repository.owner).toBe("o");
		expect(result.repository.name).toBe("repo");
		expect(result.repository.description).toBe("A test repo");
		expect(result.repository.stargazerCount).toBe(42);
		expect(result.repository.defaultBranchRef).toBe("main");
		expect(result.repository.licenseInfo).toBe("MIT");
		expect(result.repository.topics).toEqual(["cli"]);
		expect(result.repository.languages).toEqual([
			{ name: "TypeScript", color: "#3178c6" },
		]);
	});

	test("handles null optional fields", async () => {
		const node = makeRepoNode({
			description: null,
			homepageUrl: null,
			primaryLanguage: null,
			defaultBranchRef: null,
			licenseInfo: null,
			repositoryTopics: { nodes: [] },
		});
		globalThis.fetch = mock(() =>
			Promise.resolve(jsonResponse(repoResponse(node))),
		) as unknown as typeof fetch;

		const client = fastClient();
		const result = await client.fetchRepository("o", "repo");

		expect(result.repository.description).toBeNull();
		expect(result.repository.homepageUrl).toBeNull();
		expect(result.repository.primaryLanguage).toBeNull();
		expect(result.repository.defaultBranchRef).toBeNull();
		expect(result.repository.licenseInfo).toBeNull();
		expect(result.repository.topics).toEqual([]);
	});

	test("throws on GraphQL error", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				jsonResponse({
					data: { repository: null },
					errors: [{ message: "Not Found" }],
				}),
			),
		) as unknown as typeof fetch;

		const client = fastClient();
		await expect(client.fetchRepository("o", "nonexistent")).rejects.toThrow(
			"GitHub GraphQL error: Not Found",
		);
	});
});
