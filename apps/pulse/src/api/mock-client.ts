import type {
	FetchPrsOptions,
	FetchPrsResult,
	FetchPullRequestDetailResult,
	GitHubApiClient,
} from "./types.ts";

export interface MockCall {
	owner: string;
	repo: string;
	opts: FetchPrsOptions;
}

export interface MockDetailCall {
	owner: string;
	repo: string;
	number: number;
}

/**
 * Deterministic mock client for unit tests.
 * Records all calls and returns pre-configured responses.
 */
export class MockGitHubClient implements GitHubApiClient {
	readonly calls: MockCall[] = [];
	readonly detailCalls: MockDetailCall[] = [];
	private response: FetchPrsResult;
	private detailResponse: FetchPullRequestDetailResult | null;

	constructor(
		response: Omit<FetchPrsResult, "hasNextPage" | "endCursor"> &
			Partial<Pick<FetchPrsResult, "hasNextPage" | "endCursor">>,
		detailResponse?: FetchPullRequestDetailResult,
	) {
		this.response = {
			hasNextPage: false,
			endCursor: null,
			...response,
		};
		this.detailResponse = detailResponse ?? null;
	}

	async fetchPullRequests(
		owner: string,
		repo: string,
		opts: FetchPrsOptions,
	): Promise<FetchPrsResult> {
		this.calls.push({ owner, repo, opts });
		return this.response;
	}

	async fetchPullRequestDetail(
		owner: string,
		repo: string,
		number: number,
	): Promise<FetchPullRequestDetailResult> {
		this.detailCalls.push({ owner, repo, number });
		if (!this.detailResponse) {
			throw new Error(`No mock detail response configured for PR #${number}`);
		}
		return this.detailResponse;
	}
}
