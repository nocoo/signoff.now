import type { GitHubApiClient } from "../../api/types.ts";
import type { RepositoryReport } from "../types.ts";

export interface FetchRepoInput {
	owner: string;
	repo: string;
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

/**
 * Fetch repository metadata and assemble the RepositoryReport.
 */
export async function fetchRepo(
	client: GitHubApiClient,
	input: FetchRepoInput,
): Promise<RepositoryReport> {
	const startTime = Date.now();

	const result = await client.fetchRepository(input.owner, input.repo);

	const durationMs = Date.now() - startTime;

	return {
		generatedAt: new Date().toISOString(),
		durationMs,
		repository: result.repository,
	};
}
