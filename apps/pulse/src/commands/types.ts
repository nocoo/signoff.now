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
	/** Whether more PRs are available via cursor pagination. */
	hasNextPage: boolean;
	/** Cursor to pass for the next page (null if no more pages). */
	endCursor: string | null;
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

// ---------------------------------------------------------------------------
// PR Detail types
// ---------------------------------------------------------------------------

/**
 * Report output from the `pr-detail` subcommand.
 */
export interface PrDetailReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: {
		owner: string;
		repo: string;
		url: string;
	};
	pr: PrDetail;
}

/**
 * Comprehensive detail for a single pull request.
 * Extends PullRequestInfo with body, reviews, comments, commits, files, etc.
 */
export interface PrDetail extends PullRequestInfo {
	/** PR description body in Markdown. */
	body: string;
	/** Whether the PR is mergeable. */
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	/** Detailed merge state. */
	mergeStateStatus:
		| "BEHIND"
		| "BLOCKED"
		| "CLEAN"
		| "DIRTY"
		| "DRAFT"
		| "HAS_HOOKS"
		| "UNKNOWN"
		| "UNSTABLE";
	/** Who merged the PR (login), null if not merged. */
	mergedBy: string | null;
	/** Total comment count (all types). */
	totalCommentsCount: number;
	/** Participants (logins). */
	participants: string[];
	/** Requested reviewers (logins or team slugs). */
	requestedReviewers: string[];
	/** Assignees (logins). */
	assignees: string[];
	/** Milestone name, if any. */
	milestone: string | null;
	/** Head commit OID. */
	headRefOid: string;
	/** Base commit OID. */
	baseRefOid: string;
	/** Whether this is a cross-repository PR (fork). */
	isCrossRepository: boolean;

	/** Reviews on this PR. */
	reviews: PrReview[];
	/** Issue comments (non-review discussion). */
	comments: PrComment[];
	/** Commits in this PR. */
	commits: PrCommit[];
	/** Changed files in this PR. */
	files: PrFile[];
}

/** A single review on a PR. */
export interface PrReview {
	author: string;
	state:
		| "APPROVED"
		| "CHANGES_REQUESTED"
		| "COMMENTED"
		| "DISMISSED"
		| "PENDING";
	body: string;
	submittedAt: string | null; // ISO 8601
	/** Line-level review comments attached to this review. */
	comments: PrReviewComment[];
}

/** A line-level comment on a pull request review. */
export interface PrReviewComment {
	author: string;
	/** File path the comment targets. */
	path: string;
	/** Line number in the new (right-side) diff. */
	line: number | null;
	/** Line number in the old (left-side) diff. */
	originalLine: number | null;
	/** Diff hunk context surrounding the comment. */
	diffHunk: string;
	body: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/** An issue comment (non-review). */
export interface PrComment {
	author: string;
	body: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/** A commit in the PR. */
export interface PrCommit {
	oid: string; // abbreviated
	message: string;
	author: string;
	authoredDate: string; // ISO 8601
	/** Combined status check state for this commit (null if no checks). */
	statusCheckRollup:
		| "SUCCESS"
		| "FAILURE"
		| "PENDING"
		| "ERROR"
		| "EXPECTED"
		| null;
	/** Individual CI check runs for this commit. */
	checkRuns: CheckRun[];
}

/** An individual CI check run on a commit. */
export interface CheckRun {
	/** Check name (e.g. "build", "test", "lint"). */
	name: string;
	/** Current execution status. */
	status:
		| "QUEUED"
		| "IN_PROGRESS"
		| "COMPLETED"
		| "WAITING"
		| "PENDING"
		| "REQUESTED";
	/** Final result (null if not yet completed). */
	conclusion:
		| "SUCCESS"
		| "FAILURE"
		| "NEUTRAL"
		| "CANCELLED"
		| "TIMED_OUT"
		| "ACTION_REQUIRED"
		| "SKIPPED"
		| "STALE"
		| null;
	/** URL to the CI run details page. */
	detailsUrl: string | null;
}

/** A changed file in the PR. */
export interface PrFile {
	path: string;
	additions: number;
	deletions: number;
	changeType:
		| "ADDED"
		| "MODIFIED"
		| "DELETED"
		| "RENAMED"
		| "COPIED"
		| "CHANGED";
}
