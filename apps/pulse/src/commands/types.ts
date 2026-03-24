/**
 * Report output from the `prs` subcommand.
 */
export interface PrsReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: {
		owner: string;
		repo: string;
		url: string; // https://github.com/{owner}/{repo}
	};
	identity: {
		resolvedUser: string; // which gh user was used
		resolvedVia: "direct" | "org" | "fallback";
	};
	filters: {
		state: "open" | "closed" | "all";
		author: string | null;
		limit: number;
	};
	totalCount: number;
	prs: PullRequestInfo[];
}

/**
 * Normalized pull request info from GitHub GraphQL API.
 */
export interface PullRequestInfo {
	number: number;
	title: string;
	state: "open" | "closed";
	draft: boolean;
	merged: boolean;
	mergedAt: string | null; // ISO 8601
	author: string; // login
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
	closedAt: string | null; // ISO 8601
	headBranch: string;
	baseBranch: string;
	url: string; // HTML URL for the PR
	labels: string[];
	reviewDecision: string | null; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
	additions: number;
	deletions: number;
	changedFiles: number;
}
