import type { GitHubApiClient } from "../../api/types.ts";
import type { PrDetailReport } from "../types.ts";

export interface FetchPrDetailInput {
	owner: string;
	repo: string;
	number: number;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

/**
 * Fetch detailed information for a single PR and assemble the report.
 */
export async function fetchPrDetail(
	client: GitHubApiClient,
	input: FetchPrDetailInput,
): Promise<PrDetailReport> {
	const startTime = Date.now();

	const result = await client.fetchPullRequestDetail(
		input.owner,
		input.repo,
		input.number,
	);

	const durationMs = Date.now() - startTime;

	return {
		generatedAt: new Date().toISOString(),
		durationMs,
		repository: {
			owner: input.owner,
			repo: input.repo,
			url: `https://github.com/${input.owner}/${input.repo}`,
		},
		pr: result.pr,
	};
}
