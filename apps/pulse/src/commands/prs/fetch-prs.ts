import type {
	GitHubApiClient,
	GraphQLPullRequestState,
} from "../../api/types.ts";
import type { PullRequestStateFilter, PullRequestsReport } from "../types.ts";

export interface FetchPrsInput {
	owner: string;
	repo: string;
	state: PullRequestStateFilter;
	limit: number;
	author: string | null;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
	/** Cursor for pagination (null = first page). */
	cursor?: string | null;
}

/**
 * Map CLI --state flag to GitHub GraphQL PullRequestState enum values.
 */
export function mapStatesToGraphQL(
	state: PullRequestStateFilter,
): GraphQLPullRequestState[] {
	switch (state) {
		case "open":
			return ["OPEN"];
		case "closed":
			return ["CLOSED"];
		case "merged":
			return ["MERGED"];
		case "all":
			return ["OPEN", "CLOSED", "MERGED"];
	}
}

/**
 * Fetch PRs and assemble the full PullRequestsReport.
 */
export async function fetchPrs(
	client: GitHubApiClient,
	input: FetchPrsInput,
): Promise<PullRequestsReport> {
	const startTime = Date.now();

	const states = mapStatesToGraphQL(input.state);
	const result = await client.fetchPullRequests(input.owner, input.repo, {
		states,
		limit: input.limit,
		author: input.author,
		cursor: input.cursor ?? null,
	});

	const durationMs = Date.now() - startTime;

	return {
		generatedAt: new Date().toISOString(),
		durationMs,
		repository: {
			owner: input.owner,
			name: input.repo,
			url: `https://github.com/${input.owner}/${input.repo}`,
		},
		identity: {
			resolvedUser: input.resolvedUser,
			resolvedVia: input.resolvedVia,
		},
		filters: {
			state: input.state,
			author: input.author,
			limit: input.limit,
		},
		totalCount: result.totalCount,
		hasNextPage: result.hasNextPage,
		endCursor: result.endCursor,
		pullRequests: result.pullRequests,
	};
}
