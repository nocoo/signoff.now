import type { PullRequestInfo } from "../commands/types.ts";
import { mapPrNode } from "./map-pr-node.ts";
import type {
	FetchPrsOptions,
	FetchPrsResult,
	GitHubApiClient,
	GraphQLPrsResponse,
} from "./types.ts";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const PAGE_SIZE = 100;

/** Transient HTTP status codes that warrant a retry. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

const PR_QUERY = `
query($owner: String!, $repo: String!, $states: [PullRequestState!], $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: $states, first: ${PAGE_SIZE}, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
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
		let cursor: string | null = null;
		let hasNextPage = true;

		while (hasNextPage) {
			const response = await this.queryGraphQL(
				owner,
				repo,
				opts.states,
				cursor,
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
					};
				}
			}

			hasNextPage = pageInfo.hasNextPage;
			cursor = pageInfo.endCursor;
		}

		return { pullRequests: allPrs, totalCount: allPrs.length };
	}

	private async queryGraphQL(
		owner: string,
		repo: string,
		states: readonly string[],
		cursor: string | null,
	): Promise<GraphQLPrsResponse> {
		const body = JSON.stringify({
			query: PR_QUERY,
			variables: { owner, repo, states, cursor },
		});

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
				return (await response.json()) as GraphQLPrsResponse;
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
