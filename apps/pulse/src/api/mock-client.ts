import type {
	FetchPrsOptions,
	FetchPrsResult,
	FetchPullRequestDetailResult,
	FetchPullRequestFilesResult,
	GitHubApiClient,
	SearchPullRequestsOptions,
	SearchPullRequestsResult,
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

export interface MockSearchCall {
	owner: string;
	repo: string;
	opts: SearchPullRequestsOptions;
}

/**
 * Deterministic mock client for unit tests.
 * Records all calls and returns pre-configured responses.
 */
export class MockGitHubClient implements GitHubApiClient {
	readonly calls: MockCall[] = [];
	readonly detailCalls: MockDetailCall[] = [];
	readonly filesCalls: MockDetailCall[] = [];
	readonly diffCalls: MockDetailCall[] = [];
	readonly searchCalls: MockSearchCall[] = [];
	private response: FetchPrsResult;
	private detailResponse: FetchPullRequestDetailResult | null;
	private filesResponse: FetchPullRequestFilesResult | null;
	private diffResponse: string | null;
	private searchResponse: SearchPullRequestsResult | null;

	constructor(
		response: Omit<FetchPrsResult, "hasNextPage" | "endCursor"> &
			Partial<Pick<FetchPrsResult, "hasNextPage" | "endCursor">>,
		detailResponse?: FetchPullRequestDetailResult,
		filesResponse?: FetchPullRequestFilesResult,
		diffResponse?: string,
		searchResponse?: SearchPullRequestsResult,
	) {
		this.response = {
			hasNextPage: false,
			endCursor: null,
			...response,
		};
		this.detailResponse = detailResponse ?? null;
		this.filesResponse = filesResponse ?? null;
		this.diffResponse = diffResponse ?? null;
		this.searchResponse = searchResponse ?? null;
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

	async fetchPullRequestFiles(
		owner: string,
		repo: string,
		number: number,
	): Promise<FetchPullRequestFilesResult> {
		this.filesCalls.push({ owner, repo, number });
		if (!this.filesResponse) {
			throw new Error(`No mock files response configured for PR #${number}`);
		}
		return this.filesResponse;
	}

	async fetchPullRequestDiff(
		owner: string,
		repo: string,
		number: number,
	): Promise<string> {
		this.diffCalls.push({ owner, repo, number });
		if (this.diffResponse === null) {
			throw new Error(`No mock diff response configured for PR #${number}`);
		}
		return this.diffResponse;
	}

	async searchPullRequests(
		owner: string,
		repo: string,
		opts: SearchPullRequestsOptions,
	): Promise<SearchPullRequestsResult> {
		this.searchCalls.push({ owner, repo, opts });
		if (!this.searchResponse) {
			throw new Error("No mock search response configured");
		}
		return this.searchResponse;
	}
}
