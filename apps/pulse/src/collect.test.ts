import { describe, expect, test } from "vitest";
import { MockGitHubClient } from "./api/mock-client.ts";
import {
	CollectError,
	collectPullRequestDetail,
	collectPullRequestDiff,
	collectPullRequestSearch,
	collectPullRequests,
	collectRepository,
} from "./collect.ts";
import type { PullRequestInfo } from "./commands/types.ts";
import { createMockExecutor } from "./executor/mock-executor.ts";
import type { MockResponse } from "./executor/types.ts";
import type { CacheStore } from "./identity/resolve-user.ts";
import type { IdentityMapCache } from "./identity/types.ts";

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

function identityCache(): CacheStore {
	const cache: IdentityMapCache = {
		createdAt: new Date().toISOString(),
		entries: [{ host: "github.com", owner: "acme", ghUser: "alice" }],
	};
	return {
		async read() {
			return cache;
		},
		async write() {},
	};
}

function baseExec(remoteUrl = "https://github.com/acme/repo.git") {
	return createMockExecutor(
		new Map<string, MockResponse>([
			["git remote get-url origin", { stdout: remoteUrl }],
			["gh auth token --user alice", { stdout: "gho_test_token" }],
			[
				"gh auth status --json hosts",
				{
					stdout: JSON.stringify({
						hosts: {
							"github.com": [
								{ login: "alice", active: true, host: "github.com" },
							],
						},
					}),
				},
			],
		]),
	);
}

describe("collectPullRequests", () => {
	test("resolves project and returns PR report", async () => {
		const prs = [makePr()];
		const apiClient = new MockGitHubClient({
			pullRequests: prs,
			totalCount: 1,
		});

		const report = await collectPullRequests({
			exec: baseExec(),
			cwd: "/tmp/repo",
			state: "open",
			limit: 0,
			author: null,
			cacheStore: identityCache(),
			apiClient,
		});

		expect(report.repository).toEqual({
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
		});
		expect(report.identity.resolvedUser).toBe("alice");
		expect(report.pullRequests).toHaveLength(1);
		expect(apiClient.calls).toHaveLength(1);
	});

	test("throws CollectError when remote is missing", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["git remote get-url origin", { stdout: "", exitCode: 128 }],
			]),
		);

		await expect(
			collectPullRequests({
				exec,
				cwd: "/tmp/repo",
				state: "open",
				limit: 0,
				author: null,
				apiClient: new MockGitHubClient({ pullRequests: [], totalCount: 0 }),
			}),
		).rejects.toThrow(CollectError);
	});

	test("throws CollectError for Azure DevOps remotes", async () => {
		await expect(
			collectPullRequests({
				exec: baseExec("https://dev.azure.com/org/project/_git/repo"),
				cwd: "/tmp/repo",
				state: "open",
				limit: 0,
				author: null,
				apiClient: new MockGitHubClient({ pullRequests: [], totalCount: 0 }),
			}),
		).rejects.toThrow(/Azure DevOps/);
	});

	test("throws CollectError for unparseable remote URLs", async () => {
		await expect(
			collectPullRequests({
				exec: baseExec("not-a-remote-url"),
				cwd: "/tmp/repo",
				state: "open",
				limit: 0,
				author: null,
				apiClient: new MockGitHubClient({ pullRequests: [], totalCount: 0 }),
			}),
		).rejects.toThrow(/Could not parse remote URL/);
	});

	test("throws CollectError when no identity is available", async () => {
		const emptyCache: CacheStore = {
			async read() {
				return {
					createdAt: new Date().toISOString(),
					entries: [],
				};
			},
			async write() {},
		};
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"git remote get-url origin",
					{ stdout: "https://github.com/acme/repo.git" },
				],
				["gh auth status --json hosts", { stdout: "", exitCode: 1 }],
			]),
		);

		await expect(
			collectPullRequests({
				exec,
				cwd: "/tmp/repo",
				state: "open",
				limit: 0,
				author: null,
				cacheStore: emptyCache,
				apiClient: new MockGitHubClient({ pullRequests: [], totalCount: 0 }),
			}),
		).rejects.toThrow(/No authenticated GitHub user/);
	});
});

describe("collectPullRequestDetail", () => {
	test("delegates to fetchPrDetail with resolved owner/repo", async () => {
		const detail = {
			...makePr({ number: 42 }),
			body: "hello",
			mergeable: "MERGEABLE" as const,
			mergeStateStatus: "CLEAN" as const,
			mergedBy: null,
			participants: ["alice"],
			reviewRequests: [],
			assignees: [],
			milestone: null,
			headRefOid: "abc",
			baseRefOid: "def",
			isCrossRepository: false,
			reviews: [],
			comments: [],
			commits: [],
			files: [],
		};
		const apiClient = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			{ pullRequest: detail },
		);

		const report = await collectPullRequestDetail({
			exec: baseExec(),
			cwd: "/tmp/repo",
			number: 42,
			cacheStore: identityCache(),
			apiClient,
		});

		expect(report.pullRequest.number).toBe(42);
		expect(apiClient.detailCalls).toEqual([
			{ owner: "acme", repo: "repo", number: 42 },
		]);
	});
});

describe("collectPullRequestDiff", () => {
	test("delegates to fetchPrDiff", async () => {
		const apiClient = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			{ files: [] },
			"diff --git a/x b/x",
		);

		const report = await collectPullRequestDiff({
			exec: baseExec(),
			cwd: "/tmp/repo",
			number: 7,
			cacheStore: identityCache(),
			apiClient,
		});

		expect(report.diff).toContain("diff --git");
		expect(apiClient.diffCalls).toEqual([
			{ owner: "acme", repo: "repo", number: 7 },
		]);
	});
});

describe("collectPullRequestSearch", () => {
	test("delegates to fetchPrSearch", async () => {
		const apiClient = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			{
				pullRequests: [makePr()],
				totalCount: 1,
				hasNextPage: false,
				endCursor: null,
			},
		);

		const report = await collectPullRequestSearch({
			exec: baseExec(),
			cwd: "/tmp/repo",
			query: "is:open",
			limit: 10,
			cacheStore: identityCache(),
			apiClient,
		});

		expect(report.query).toBe("is:open");
		expect(report.pullRequests).toHaveLength(1);
		expect(apiClient.searchCalls).toHaveLength(1);
	});
});

describe("collectRepository", () => {
	test("delegates to fetchRepo", async () => {
		const apiClient = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			undefined,
			{
				repository: {
					owner: "acme",
					name: "repo",
					url: "https://github.com/acme/repo",
					description: "demo",
					homepageUrl: null,
					stargazerCount: 1,
					forkCount: 0,
					isArchived: false,
					isPrivate: false,
					primaryLanguage: null,
					languages: [],
					defaultBranchRef: "main",
					licenseInfo: "MIT",
					topics: [],
					pushedAt: "2025-01-01T00:00:00Z",
					createdAt: "2025-01-01T00:00:00Z",
					updatedAt: "2025-01-01T00:00:00Z",
				},
			},
		);

		const report = await collectRepository({
			exec: baseExec(),
			cwd: "/tmp/repo",
			cacheStore: identityCache(),
			apiClient,
		});

		expect(report.repository.name).toBe("repo");
		expect(apiClient.repoCalls).toEqual([{ owner: "acme", repo: "repo" }]);
	});
});
