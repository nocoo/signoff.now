import type { PullRequestDetail, PullRequestInfo } from "../commands/types.ts";

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

	/**
	 * Fetch detailed information for a single pull request.
	 *
	 * @param owner  - Repository owner (user or org)
	 * @param repo   - Repository name
	 * @param number - PR number
	 * @returns Comprehensive PR detail
	 */
	fetchPullRequestDetail(
		owner: string,
		repo: string,
		number: number,
	): Promise<FetchPullRequestDetailResult>;
}

export interface FetchPrsOptions {
	/** PR state filter for GraphQL query */
	states: GraphQLPullRequestState[];
	/** Max results to return (0 = unlimited) */
	limit: number;
	/** Filter by author login (client-side) */
	author: string | null;
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

/** GraphQL enum values for PullRequestState (used in query variables). */
export type GraphQLPullRequestState = "OPEN" | "CLOSED" | "MERGED";

export interface FetchPrsResult {
	pullRequests: PullRequestInfo[];
	totalCount: number;
	/** Whether more pages are available via cursor pagination. */
	hasNextPage: boolean;
	/** Cursor to pass for the next page (null if no more pages). */
	endCursor: string | null;
}

/** Raw GraphQL response shape from GitHub */
export interface GraphQLPullRequestNode {
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
				nodes: GraphQLPullRequestNode[];
			};
		};
	};
	errors?: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// PR Detail types
// ---------------------------------------------------------------------------

export interface FetchPullRequestDetailResult {
	pullRequest: PullRequestDetail; // was `pr`
}

/** Raw GraphQL response shape for a single PR detail query. */
export interface GraphQLPullRequestDetailResponse {
	data: {
		repository: {
			pullRequest: GraphQLPullRequestDetailNode;
		};
	};
	errors?: Array<{ message: string }>;
}

/** Shared page info shape for nested connections. */
export interface GraphQLPageInfo {
	hasNextPage: boolean;
	endCursor: string | null;
}

/** Extended GraphQL PR node with detail fields. */
export interface GraphQLPullRequestDetailNode extends GraphQLPullRequestNode {
	body: string;
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	mergeStateStatus:
		| "BEHIND"
		| "BLOCKED"
		| "CLEAN"
		| "DIRTY"
		| "DRAFT"
		| "HAS_HOOKS"
		| "UNKNOWN"
		| "UNSTABLE";
	mergedBy: { login: string } | null;
	totalCommentsCount: number | null;
	headRefOid: string;
	baseRefOid: string;
	isCrossRepository: boolean;
	participants: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{ login: string }>;
	};
	assignees: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{ login: string }>;
	};
	reviewRequests: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{
			requestedReviewer: { login?: string; slug?: string } | null;
		}>;
	};
	milestone: { title: string } | null;
	reviews: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{
			author: { login: string } | null;
			state: string;
			body: string;
			submittedAt: string | null;
			comments: {
				pageInfo: GraphQLPageInfo;
				nodes: Array<{
					author: { login: string } | null;
					path: string;
					line: number | null;
					originalLine: number | null;
					diffHunk: string;
					body: string;
					createdAt: string;
					updatedAt: string;
				}>;
			};
		}>;
	};
	comments: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{
			author: { login: string } | null;
			body: string;
			createdAt: string;
			updatedAt: string;
		}>;
	};
	commits: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{
			commit: {
				abbreviatedOid: string;
				message: string;
				author: { user: { login: string } | null; name: string } | null;
				authoredDate: string;
				statusCheckRollup: {
					state: string;
					contexts: {
						nodes: Array<{
							__typename: string;
							name?: string;
							status?: string;
							conclusion?: string | null;
							detailsUrl?: string | null;
						}>;
					};
				} | null;
			};
		}>;
	};
	files: {
		pageInfo: GraphQLPageInfo;
		nodes: Array<{
			path: string;
			additions: number;
			deletions: number;
			changeType: string;
		}>;
	} | null;
}

/** Response shape for nested connection follow-up queries. */
export interface GraphQLNestedConnectionResponse<T> {
	data: {
		repository: {
			pullRequest: {
				[connection: string]: {
					pageInfo: GraphQLPageInfo;
					nodes: T[];
				};
			};
		};
	};
	errors?: Array<{ message: string }>;
}
