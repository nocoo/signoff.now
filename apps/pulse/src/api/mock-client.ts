import type {
	FetchPrsOptions,
	FetchPrsResult,
	GitHubApiClient,
} from "./types.ts";

export interface MockCall {
	owner: string;
	repo: string;
	opts: FetchPrsOptions;
}

/**
 * Deterministic mock client for unit tests.
 * Records all calls and returns pre-configured responses.
 */
export class MockGitHubClient implements GitHubApiClient {
	readonly calls: MockCall[] = [];
	private response: FetchPrsResult;

	constructor(response: FetchPrsResult) {
		this.response = response;
	}

	async fetchPullRequests(
		owner: string,
		repo: string,
		opts: FetchPrsOptions,
	): Promise<FetchPrsResult> {
		this.calls.push({ owner, repo, opts });
		return this.response;
	}
}
