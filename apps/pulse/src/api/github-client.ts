import type {
	PullRequestChangedFileWithPatch,
	PullRequestInfo,
} from "../commands/types.ts";
import { mapPullRequestDetailNode } from "./map-pr-detail-node.ts";
import { mapPullRequestNode } from "./map-pr-node.ts";
import type {
	FetchPrsOptions,
	FetchPrsResult,
	FetchPullRequestDetailResult,
	FetchPullRequestFilesResult,
	GitHubApiClient,
	GraphQLNestedConnectionResponse,
	GraphQLPageInfo,
	GraphQLPrsResponse,
	GraphQLPullRequestDetailNode,
	GraphQLPullRequestDetailResponse,
	GraphQLSearchResponse,
	SearchPullRequestsOptions,
	SearchPullRequestsResult,
} from "./types.ts";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";
const MAX_PAGE_SIZE = 100;

/** Transient HTTP status codes that warrant a retry. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

function buildPrQuery(first: number): string {
	return `
query($owner: String!, $repo: String!, $states: [PullRequestState!], $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: $states, first: ${first}, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state isDraft
        merged mergedAt
        author { login }
        createdAt updatedAt closedAt
        headRefName baseRefName
        url
        labels(first: 10) { nodes { name } }
        reviewDecision
        additions deletions changedFiles
      }
    }
  }
}
`;
}

const PR_DETAIL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number title state isDraft
      merged mergedAt
      author { login }
      createdAt updatedAt closedAt
      headRefName baseRefName
      url
      labels(first: 20) { nodes { name } }
      reviewDecision
      additions deletions changedFiles

      body
      mergeable
      mergeStateStatus
      mergedBy { login }
      totalCommentsCount
      headRefOid baseRefOid
      isCrossRepository

      participants(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { login }
      }
      assignees(first: 20) {
        pageInfo { hasNextPage endCursor }
        nodes { login }
      }
      reviewRequests(first: 20) {
        pageInfo { hasNextPage endCursor }
        nodes { requestedReviewer { ... on User { login } ... on Team { slug } } }
      }
      milestone { title }

      reviews(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          author { login }
          state body submittedAt
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              author { login }
              path line originalLine diffHunk
              body createdAt updatedAt
            }
          }
        }
      }

      comments(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          author { login }
          body createdAt updatedAt
        }
      }

      commits(first: 250) {
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            abbreviatedOid message
            author { user { login } name }
            authoredDate
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                }
              }
            }
          }
        }
      }

      files(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          path additions deletions changeType
        }
      }
    }
  }
}
`;

function buildSearchQuery(first: number): string {
	return `
query($query: String!, $cursor: String) {
  search(type: ISSUE, query: $query, first: ${first}, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        __typename
        number title state isDraft
        merged mergedAt
        author { login }
        createdAt updatedAt closedAt
        headRefName baseRefName
        url
        labels(first: 10) { nodes { name } }
        reviewDecision
        additions deletions changedFiles
      }
    }
  }
}
`;
}

/**
 * Nested connection configurations for follow-up pagination.
 * Each entry maps a connection name to its GraphQL fragment and page size.
 */
interface NestedConnectionConfig {
	name: string;
	pageSize: number;
	fragment: string;
}

const NESTED_CONNECTIONS: NestedConnectionConfig[] = [
	{
		name: "reviews",
		pageSize: 100,
		fragment: `author { login } state body submittedAt
      comments(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } path line originalLine diffHunk body createdAt updatedAt }
      }`,
	},
	{
		name: "comments",
		pageSize: 100,
		fragment: "author { login } body createdAt updatedAt",
	},
	{
		name: "commits",
		pageSize: 250,
		fragment: `commit {
        abbreviatedOid message
        author { user { login } name }
        authoredDate
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes { __typename ... on CheckRun { name status conclusion detailsUrl } }
          }
        }
      }`,
	},
	{
		name: "files",
		pageSize: 100,
		fragment: "path additions deletions changeType",
	},
];

function buildNestedPageQuery(
	connectionName: string,
	pageSize: number,
	fragment: string,
): string {
	return `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${connectionName}(first: ${pageSize}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fragment} }
      }
    }
  }
}`;
}

export interface GitHubClientOptions {
	/** Base delay in ms for exponential backoff (default: 1000). */
	retryDelayMs?: number;
}

export class GitHubClient implements GitHubApiClient {
	private token: string;
	private retryDelayMs: number;

	constructor(token: string, options?: GitHubClientOptions) {
		this.token = token;
		this.retryDelayMs = options?.retryDelayMs ?? INITIAL_DELAY_MS;
	}

	async fetchPullRequests(
		owner: string,
		repo: string,
		opts: FetchPrsOptions,
	): Promise<FetchPrsResult> {
		const allPrs: PullRequestInfo[] = [];
		let cursor: string | null = opts.cursor ?? null;
		let hasNextPage = true;

		while (hasNextPage) {
			// Request only as many as we still need (or MAX_PAGE_SIZE if unlimited)
			const remaining =
				opts.limit > 0 ? opts.limit - allPrs.length : MAX_PAGE_SIZE;
			const pageSize = Math.min(remaining, MAX_PAGE_SIZE);

			const response = await this.queryGraphQL(
				owner,
				repo,
				opts.states,
				cursor,
				pageSize,
			);

			if (response.errors?.length) {
				throw new Error(
					`GitHub GraphQL error: ${response.errors.map((e) => e.message).join(", ")}`,
				);
			}

			const { nodes, pageInfo } = response.data.repository.pullRequests;

			for (const node of nodes) {
				const pr = mapPullRequestNode(node);

				// Client-side author filter
				if (opts.author && pr.author !== opts.author) {
					continue;
				}

				allPrs.push(pr);

				// Stop early if we hit the limit
				if (opts.limit > 0 && allPrs.length >= opts.limit) {
					return {
						pullRequests: allPrs.slice(0, opts.limit),
						totalCount: allPrs.length,
						hasNextPage:
							pageInfo.hasNextPage || nodes.indexOf(node) < nodes.length - 1,
						endCursor: pageInfo.endCursor,
					};
				}
			}

			hasNextPage = pageInfo.hasNextPage;
			cursor = pageInfo.endCursor;
		}

		return {
			pullRequests: allPrs,
			totalCount: allPrs.length,
			hasNextPage: false,
			endCursor: null,
		};
	}

	async fetchPullRequestDetail(
		owner: string,
		repo: string,
		number: number,
	): Promise<FetchPullRequestDetailResult> {
		const response = await this.postGraphQL<GraphQLPullRequestDetailResponse>(
			PR_DETAIL_QUERY,
			{ owner, repo, number },
		);

		if (response.errors?.length) {
			throw new Error(
				`GitHub GraphQL error: ${response.errors.map((e) => e.message).join(", ")}`,
			);
		}

		const node = response.data.repository.pullRequest;
		if (!node) {
			throw new Error(`Pull request #${number} not found in ${owner}/${repo}`);
		}

		// Follow-up pagination for nested connections
		await this.paginateNestedConnections(owner, repo, number, node);

		return { pullRequest: mapPullRequestDetailNode(node) };
	}

	async fetchPullRequestFiles(
		owner: string,
		repo: string,
		number: number,
	): Promise<FetchPullRequestFilesResult> {
		const allFiles: PullRequestChangedFileWithPatch[] = [];
		let page = 1;
		const perPage = 100;

		while (true) {
			const url = `${REST_BASE}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`;
			const items = await this.getRest<RESTFileEntry[]>(url);

			for (const item of items) {
				allFiles.push({
					path: item.filename,
					additions: item.additions,
					deletions: item.deletions,
					changeType: mapRESTStatus(item.status),
					patch: item.patch ?? null,
				});
			}

			if (items.length < perPage) break;
			page++;
		}

		return { files: allFiles };
	}

	async fetchPullRequestDiff(
		owner: string,
		repo: string,
		number: number,
	): Promise<string> {
		const url = `${REST_BASE}/repos/${owner}/${repo}/pulls/${number}`;
		return this.getRestText(url, "application/vnd.github.diff");
	}

	async searchPullRequests(
		owner: string,
		repo: string,
		opts: SearchPullRequestsOptions,
	): Promise<SearchPullRequestsResult> {
		const allPrs: PullRequestInfo[] = [];
		let cursor: string | null = opts.cursor ?? null;
		let hasNextPage = true;
		let totalCount = 0;

		// Build scoped query: repo:owner/repo + user qualifier
		const scopedQuery = `repo:${owner}/${repo} is:pr ${opts.query}`;

		while (hasNextPage) {
			const remaining =
				opts.limit > 0 ? opts.limit - allPrs.length : MAX_PAGE_SIZE;
			const pageSize = Math.min(remaining, MAX_PAGE_SIZE);

			const response = await this.postGraphQL<GraphQLSearchResponse>(
				buildSearchQuery(pageSize),
				{ query: scopedQuery, cursor },
			);

			if (response.errors?.length) {
				throw new Error(
					`GitHub GraphQL error: ${response.errors.map((e) => e.message).join(", ")}`,
				);
			}

			const { issueCount, nodes, pageInfo } = response.data.search;
			totalCount = issueCount;

			for (const node of nodes) {
				// Search may return issues too; filter to PRs only
				if (node.__typename !== "PullRequest") continue;

				allPrs.push(mapPullRequestNode(node));

				if (opts.limit > 0 && allPrs.length >= opts.limit) {
					return {
						pullRequests: allPrs.slice(0, opts.limit),
						totalCount,
						hasNextPage:
							pageInfo.hasNextPage || nodes.indexOf(node) < nodes.length - 1,
						endCursor: pageInfo.endCursor,
					};
				}
			}

			hasNextPage = pageInfo.hasNextPage;
			cursor = pageInfo.endCursor;
		}

		return {
			pullRequests: allPrs,
			totalCount,
			hasNextPage: false,
			endCursor: null,
		};
	}

	/**
	 * Paginate all nested connections that have hasNextPage: true.
	 * Mutates the node in place by appending additional pages.
	 */
	private async paginateNestedConnections(
		owner: string,
		repo: string,
		number: number,
		node: GraphQLPullRequestDetailNode,
	): Promise<void> {
		for (const config of NESTED_CONNECTIONS) {
			const connection = node[
				config.name as keyof GraphQLPullRequestDetailNode
			] as { pageInfo: GraphQLPageInfo; nodes: unknown[] } | null;

			if (!connection?.pageInfo?.hasNextPage) continue;

			await this.paginateConnection(owner, repo, number, config, connection);
		}
	}

	/**
	 * Paginate a single nested connection to exhaustion.
	 * Appends nodes to the connection in place.
	 */
	private async paginateConnection(
		owner: string,
		repo: string,
		number: number,
		config: NestedConnectionConfig,
		connection: { pageInfo: GraphQLPageInfo; nodes: unknown[] },
	): Promise<void> {
		let cursor = connection.pageInfo.endCursor;
		let hasNextPage = connection.pageInfo.hasNextPage;

		while (hasNextPage && cursor) {
			const query = buildNestedPageQuery(
				config.name,
				config.pageSize,
				config.fragment,
			);
			const resp = await this.postGraphQL<
				GraphQLNestedConnectionResponse<unknown>
			>(query, { owner, repo, number, cursor });

			if (resp.errors?.length) {
				throw new Error(
					`GitHub GraphQL error: ${resp.errors.map((e) => e.message).join(", ")}`,
				);
			}

			const page = resp.data.repository.pullRequest[config.name];
			if (!page) break;

			connection.nodes.push(...page.nodes);
			hasNextPage = page.pageInfo.hasNextPage;
			cursor = page.pageInfo.endCursor;
		}

		// Mark as fully paginated
		connection.pageInfo.hasNextPage = false;
	}

	private async queryGraphQL(
		owner: string,
		repo: string,
		states: readonly string[],
		cursor: string | null,
		pageSize: number,
	): Promise<GraphQLPrsResponse> {
		return this.postGraphQL<GraphQLPrsResponse>(buildPrQuery(pageSize), {
			owner,
			repo,
			states,
			cursor,
		});
	}

	/**
	 * Post a GraphQL query to the GitHub API with retry on transient errors.
	 */
	private async postGraphQL<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const body = JSON.stringify({ query, variables });

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				const delay = this.retryDelayMs * 2 ** (attempt - 1);
				await new Promise((r) => setTimeout(r, delay));
			}

			const response = await fetch(GRAPHQL_ENDPOINT, {
				method: "POST",
				headers: {
					Authorization: `bearer ${this.token}`,
					"Content-Type": "application/json",
					"User-Agent": "pulse-cli",
				},
				body,
			});

			if (response.ok) {
				return (await response.json()) as T;
			}

			lastError = new Error(
				`GitHub API error: ${response.status} ${response.statusText}`,
			);

			// Only retry on transient errors
			if (!RETRYABLE_STATUSES.has(response.status)) {
				throw lastError;
			}
		}

		throw lastError;
	}

	/**
	 * GET a REST API endpoint and return parsed JSON with retry on transient errors.
	 */
	private async getRest<T>(
		url: string,
		accept = "application/vnd.github+json",
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				const delay = this.retryDelayMs * 2 ** (attempt - 1);
				await new Promise((r) => setTimeout(r, delay));
			}

			const response = await fetch(url, {
				headers: {
					Authorization: `bearer ${this.token}`,
					Accept: accept,
					"User-Agent": "pulse-cli",
				},
			});

			if (response.ok) {
				return (await response.json()) as T;
			}

			lastError = new Error(
				`GitHub API error: ${response.status} ${response.statusText}`,
			);

			if (!RETRYABLE_STATUSES.has(response.status)) {
				throw lastError;
			}
		}

		throw lastError;
	}

	/**
	 * GET a REST API endpoint and return raw text with retry on transient errors.
	 */
	private async getRestText(url: string, accept: string): Promise<string> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				const delay = this.retryDelayMs * 2 ** (attempt - 1);
				await new Promise((r) => setTimeout(r, delay));
			}

			const response = await fetch(url, {
				headers: {
					Authorization: `bearer ${this.token}`,
					Accept: accept,
					"User-Agent": "pulse-cli",
				},
			});

			if (response.ok) {
				return response.text();
			}

			lastError = new Error(
				`GitHub API error: ${response.status} ${response.statusText}`,
			);

			if (!RETRYABLE_STATUSES.has(response.status)) {
				throw lastError;
			}
		}

		throw lastError;
	}
}

// ---------------------------------------------------------------------------
// REST API types (not exported — internal to github-client)
// ---------------------------------------------------------------------------

interface RESTFileEntry {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
}

function mapRESTStatus(
	status: string,
): PullRequestChangedFileWithPatch["changeType"] {
	switch (status) {
		case "added":
			return "ADDED";
		case "removed":
			return "DELETED";
		case "modified":
		case "changed":
			return "MODIFIED";
		case "renamed":
			return "RENAMED";
		case "copied":
			return "COPIED";
		default:
			return "CHANGED";
	}
}
