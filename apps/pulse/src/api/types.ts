import type { PullRequestInfo } from "../commands/types.ts";

/**
 * Abstraction over GitHub API calls.
 * Real implementation uses fetch(); tests use MockGitHubClient.
 */
export interface GitHubApiClient {
	/**
	 * Fetch pull requests for a repository.
	 *
	 * @param owner - Repository owner (user or org)
	 * @param repo  - Repository name
	 * @param opts  - Query options
	 * @returns Array of normalized PR info
	 */
	fetchPullRequests(
		owner: string,
		repo: string,
		opts: FetchPrsOptions,
	): Promise<FetchPrsResult>;
}

export interface FetchPrsOptions {
	/** PR state filter for GraphQL query */
	states: PullRequestState[];
	/** Max results to return (0 = unlimited) */
	limit: number;
	/** Filter by author login (client-side) */
	author: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

export interface FetchPrsResult {
	pullRequests: PullRequestInfo[];
	totalCount: number;
	/** Whether more pages are available via cursor pagination. */
	hasNextPage: boolean;
	/** Cursor to pass for the next page (null if no more pages). */
	endCursor: string | null;
}

/** Raw GraphQL response shape from GitHub */
export interface GraphQLPrNode {
	number: number;
	title: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	merged: boolean;
	mergedAt: string | null;
	author: { login: string } | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	headRefName: string;
	baseRefName: string;
	url: string;
	labels: { nodes: Array<{ name: string }> };
	reviewDecision: string | null;
	additions: number;
	deletions: number;
	changedFiles: number;
}

export interface GraphQLPrsResponse {
	data: {
		repository: {
			pullRequests: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: GraphQLPrNode[];
			};
		};
	};
	errors?: Array<{ message: string }>;
}
