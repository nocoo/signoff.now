import type { PullRequestInfo } from "../commands/types.ts";
import { mapPrDetailNode } from "./map-pr-detail-node.ts";
import { mapPrNode } from "./map-pr-node.ts";
import type {
	FetchPrDetailResult,
	FetchPrsOptions,
	FetchPrsResult,
	GitHubApiClient,
	GraphQLPrDetailResponse,
	GraphQLPrsResponse,
} from "./types.ts";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
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

      participants(first: 100) { nodes { login } }
      assignees(first: 20) { nodes { login } }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login } ... on Team { slug } } }
      }
      milestone { title }

      reviews(first: 100) {
        nodes {
          author { login }
          state body submittedAt
        }
      }

      comments(first: 100) {
        nodes {
          author { login }
          body createdAt updatedAt
        }
      }

      commits(first: 250) {
        nodes {
          commit {
            abbreviatedOid message
            author { user { login } name }
            authoredDate
            statusCheckRollup { state }
          }
        }
      }

      files(first: 100) {
        nodes {
          path additions deletions changeType
        }
      }
    }
  }
}
`;

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
				const pr = mapPrNode(node);

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
	): Promise<FetchPrDetailResult> {
		const response = await this.postGraphQL<GraphQLPrDetailResponse>(
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

		return { pr: mapPrDetailNode(node) };
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
}
