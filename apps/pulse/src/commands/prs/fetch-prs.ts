import type { GitHubApiClient, PullRequestState } from "../../api/types.ts";
import type { PrsReport } from "../types.ts";

export interface FetchPrsInput {
	owner: string;
	repo: string;
	state: "open" | "closed" | "all";
	limit: number;
	author: string | null;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

/**
 * Map CLI --state flag to GitHub GraphQL PullRequestState enum values.
 */
export function mapStatesToGraphQL(
	state: "open" | "closed" | "all",
): PullRequestState[] {
	switch (state) {
		case "open":
			return ["OPEN"];
		case "closed":
			return ["CLOSED", "MERGED"];
		case "all":
			return ["OPEN", "CLOSED", "MERGED"];
	}
}

/**
 * Fetch PRs and assemble the full PrsReport.
 */
export async function fetchPrs(
	client: GitHubApiClient,
	input: FetchPrsInput,
): Promise<PrsReport> {
	const startTime = Date.now();

	const states = mapStatesToGraphQL(input.state);
	const result = await client.fetchPullRequests(input.owner, input.repo, {
		states,
		limit: input.limit,
		author: input.author,
	});

	const durationMs = Date.now() - startTime;

	return {
		generatedAt: new Date().toISOString(),
		durationMs,
		repository: {
			owner: input.owner,
			repo: input.repo,
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
		prs: result.pullRequests,
	};
}
