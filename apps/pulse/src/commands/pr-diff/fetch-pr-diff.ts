import type { GitHubApiClient } from "../../api/types.ts";
import type { PullRequestDiffReport } from "../types.ts";

export interface FetchPrDiffInput {
	owner: string;
	repo: string;
	number: number;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

/**
 * Fetch PR diff and assemble the PullRequestDiffReport.
 */
export async function fetchPrDiff(
	client: GitHubApiClient,
	input: FetchPrDiffInput,
): Promise<PullRequestDiffReport> {
	const startTime = Date.now();

	const [diff, { files }] = await Promise.all([
		client.fetchPullRequestDiff(input.owner, input.repo, input.number),
		client.fetchPullRequestFiles(input.owner, input.repo, input.number),
	]);

	const durationMs = Date.now() - startTime;

	return {
		generatedAt: new Date().toISOString(),
		durationMs,
		repository: {
			owner: input.owner,
			name: input.repo,
			url: `https://github.com/${input.owner}/${input.repo}`,
		},
		pullRequest: { number: input.number },
		diff,
		files,
	};
}
