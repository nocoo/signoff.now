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
