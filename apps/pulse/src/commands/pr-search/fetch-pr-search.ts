import type { GitHubApiClient } from "../../api/types.ts";
import type { PullRequestSearchReport } from "../types.ts";

export interface FetchPrSearchInput {
	owner: string;
	repo: string;
	query: string;
	limit: number;
	cursor?: string | null;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

/**
 * Search PRs and assemble the PullRequestSearchReport.
 */
export async function fetchPrSearch(
	client: GitHubApiClient,
	input: FetchPrSearchInput,
): Promise<PullRequestSearchReport> {
	const startTime = Date.now();

	const result = await client.searchPullRequests(input.owner, input.repo, {
		query: input.query,
		limit: input.limit,
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
		query: input.query,
		totalCount: result.totalCount,
		hasNextPage: result.hasNextPage,
		endCursor: result.endCursor,
		pullRequests: result.pullRequests,
	};
}
