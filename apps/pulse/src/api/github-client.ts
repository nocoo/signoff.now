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

export class GitHubClient implements GitHubApiClient {
	private token: string;

	constructor(token: string) {
		this.token = token;
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

		const response = await fetch(GRAPHQL_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `bearer ${this.token}`,
				"Content-Type": "application/json",
				"User-Agent": "pulse-cli",
			},
			body,
		});

		if (!response.ok) {
			throw new Error(
				`GitHub API error: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as GraphQLPrsResponse;
	}
}
