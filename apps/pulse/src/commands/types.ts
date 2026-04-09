// ---------------------------------------------------------------------------
// Shared type aliases matching GitHub GraphQL enum names
// ---------------------------------------------------------------------------

/** Pull request state, matching GraphQL `PullRequestState` enum. */
export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

/** CLI-level state filter (lowercase for user-facing flags). */
export type PullRequestStateFilter = "open" | "closed" | "merged" | "all";

/** Review decision, matching GraphQL `PullRequestReviewDecision` enum. */
export type PullRequestReviewDecision =
	| "APPROVED"
	| "CHANGES_REQUESTED"
	| "REVIEW_REQUIRED";

/** Review state, matching GraphQL `PullRequestReviewState` enum. */
export type PullRequestReviewState =
	| "APPROVED"
	| "CHANGES_REQUESTED"
	| "COMMENTED"
	| "DISMISSED"
	| "PENDING";

/** Mergeable state, matching GraphQL `MergeableState` enum. */
export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/** Merge state status, matching GraphQL `MergeStateStatus` enum. */
export type MergeStateStatus =
	| "BEHIND"
	| "BLOCKED"
	| "CLEAN"
	| "DIRTY"
	| "DRAFT"
	| "HAS_HOOKS"
	| "UNKNOWN"
	| "UNSTABLE";

/** Combined status state, matching GraphQL `StatusState` enum. */
export type StatusState =
	| "SUCCESS"
	| "FAILURE"
	| "PENDING"
	| "ERROR"
	| "EXPECTED";

/** Check execution status, matching GraphQL `CheckStatusState` enum. */
export type CheckStatusState =
	| "QUEUED"
	| "IN_PROGRESS"
	| "COMPLETED"
	| "WAITING"
	| "PENDING"
	| "REQUESTED";

/** Check conclusion, matching GraphQL `CheckConclusionState` enum. */
export type CheckConclusionState =
	| "SUCCESS"
	| "FAILURE"
	| "NEUTRAL"
	| "CANCELLED"
	| "TIMED_OUT"
	| "ACTION_REQUIRED"
	| "SKIPPED"
	| "STARTUP_FAILURE"
	| "STALE";

/** File change type, matching GraphQL `PatchStatus` enum. */
export type PatchStatus =
	| "ADDED"
	| "MODIFIED"
	| "DELETED"
	| "RENAMED"
	| "COPIED"
	| "CHANGED";

// ---------------------------------------------------------------------------
// Shared sub-structures
// ---------------------------------------------------------------------------

/** Repository reference used in report outputs. */
export interface RepositoryRef {
	owner: string;
	name: string; // was `repo`; match GraphQL `Repository.name`
	url: string;
}

/** Identity reference used in report outputs. */
export interface IdentityRef {
	resolvedUser: string;
	resolvedVia: "direct" | "org" | "fallback";
}

// ---------------------------------------------------------------------------
// PullRequestInfo (list-level item)
// ---------------------------------------------------------------------------

/**
 * Normalized pull request info from GitHub GraphQL API.
 */
export interface PullRequestInfo {
	number: number;
	title: string;
	state: PullRequestState; // "OPEN" | "CLOSED" | "MERGED"
	isDraft: boolean; // was `draft`
	merged: boolean;
	mergedAt: string | null; // ISO 8601
	author: string; // unwrapped from { login }
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
	closedAt: string | null; // ISO 8601
	headRefName: string; // was `headBranch`
	baseRefName: string; // was `baseBranch`
	url: string; // HTML URL for the PR
	labels: string[]; // unwrapped from nodes[].name
	reviewDecision: PullRequestReviewDecision | null;
	additions: number;
	deletions: number;
	changedFiles: number;
	totalCommentsCount: number;
	commitsCount: number;
}

// ---------------------------------------------------------------------------
// PullRequestsReport (output of `prs` subcommand)
// ---------------------------------------------------------------------------

/**
 * Report output from the `prs` subcommand.
 */
export interface PullRequestsReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: RepositoryRef;
	identity: IdentityRef;
	filters: {
		state: PullRequestStateFilter;
		author: string | null;
		limit: number;
	};
	totalCount: number;
	/** Whether more PRs are available via cursor pagination. */
	hasNextPage: boolean;
	/** Cursor to pass for the next page (null if no more pages). */
	endCursor: string | null;
	pullRequests: PullRequestInfo[]; // was `prs`
}

// ---------------------------------------------------------------------------
// PullRequestDetail (extends PullRequestInfo)
// ---------------------------------------------------------------------------

/**
 * Comprehensive detail for a single pull request.
 * Extends PullRequestInfo with body, reviews, comments, commits, files, etc.
 */
export interface PullRequestDetail extends PullRequestInfo {
	/** PR description body in Markdown. */
	body: string;
	/** Whether the PR is mergeable. */
	mergeable: MergeableState;
	/** Detailed merge state. */
	mergeStateStatus: MergeStateStatus;
	/** Who merged the PR (login), null if not merged. */
	mergedBy: string | null;
	/** Total comment count (all types). */
	totalCommentsCount: number;
	/** Participants (logins). */
	participants: string[];
	/** Requested reviewers (logins or team slugs). Was `requestedReviewers`. */
	reviewRequests: string[];
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
	reviews: PullRequestReview[];
	/** Issue comments (non-review discussion). */
	comments: IssueComment[]; // was `PrComment[]`
	/** Commits in this PR. */
	commits: PullRequestCommit[];
	/** Changed files in this PR. */
	files: PullRequestChangedFile[];
}

// ---------------------------------------------------------------------------
// PullRequestDetailReport (output of `pr show` subcommand)
// ---------------------------------------------------------------------------

/**
 * Report output from the `pr show` subcommand.
 */
export interface PullRequestDetailReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: RepositoryRef;
	pullRequest: PullRequestDetail; // was `pr`
}

// ---------------------------------------------------------------------------
// Nested types
// ---------------------------------------------------------------------------

/** A single review on a PR. Matches GraphQL `PullRequestReview` type. */
export interface PullRequestReview {
	author: string;
	state: PullRequestReviewState;
	body: string;
	submittedAt: string | null; // ISO 8601
	/** Line-level review comments attached to this review. */
	comments: PullRequestReviewComment[];
}

/** A line-level comment on a pull request review. Matches GraphQL `PullRequestReviewComment` type. */
export interface PullRequestReviewComment {
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

/** An issue comment (non-review). Matches GraphQL `IssueComment` type. */
export interface IssueComment {
	author: string;
	body: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/** A commit in the PR. Matches GraphQL `PullRequestCommit` type. */
export interface PullRequestCommit {
	abbreviatedOid: string;
	oid: string; // full 40-char SHA for reliable URL linking
	message: string;
	author: string;
	authoredDate: string; // ISO 8601
	/** Combined status check rollup (null if no checks configured). */
	statusCheckRollup: StatusCheckRollup | null;
}

/** Matches GraphQL `StatusCheckRollup` type structure. */
export interface StatusCheckRollup {
	state: StatusState;
	checkRuns: CheckRun[]; // filtered from contexts (CheckRun nodes only)
}

/** An individual CI check run on a commit. Matches GraphQL `CheckRun` type. */
export interface CheckRun {
	/** Check name (e.g. "build", "test", "lint"). */
	name: string;
	/** Current execution status. */
	status: CheckStatusState;
	/** Final result (null if not yet completed). */
	conclusion: CheckConclusionState | null;
	/** URL to the CI run details page. */
	detailsUrl: string | null;
}

/** A changed file in the PR. Matches GraphQL `PullRequestChangedFile` type. */
export interface PullRequestChangedFile {
	path: string;
	additions: number;
	deletions: number;
	changeType: PatchStatus;
}

// ---------------------------------------------------------------------------
// PR Diff types
// ---------------------------------------------------------------------------

/** A changed file with optional patch content (REST-only field). */
export interface PullRequestChangedFileWithPatch
	extends PullRequestChangedFile {
	/** Unified diff patch for this file (null for binary or too-large files). */
	patch: string | null;
}

/** Report output of `pr diff` command. */
export interface PullRequestDiffReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: RepositoryRef;
	pullRequest: { number: number };
	/** Full unified diff text. */
	diff: string;
	/** Changed files with patch content. */
	files: PullRequestChangedFileWithPatch[];
}

// ---------------------------------------------------------------------------
// PR Search types
// ---------------------------------------------------------------------------

/** Report output of `pr search` command. */
export interface PullRequestSearchReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: RepositoryRef;
	identity: IdentityRef;
	query: string;
	totalCount: number;
	hasNextPage: boolean;
	endCursor: string | null;
	pullRequests: PullRequestInfo[];
}

// ---------------------------------------------------------------------------
// Repository types
// ---------------------------------------------------------------------------

/** Full repository metadata from GitHub GraphQL API. */
export interface RepositoryInfo {
	owner: string;
	name: string;
	url: string;
	description: string | null;
	homepageUrl: string | null;
	stargazerCount: number;
	forkCount: number;
	isArchived: boolean;
	isPrivate: boolean;
	primaryLanguage: { name: string; color: string } | null;
	languages: Array<{ name: string; color: string }>;
	defaultBranchRef: string | null;
	licenseInfo: string | null;
	topics: string[];
	pushedAt: string;
	createdAt: string;
	updatedAt: string;
}

/** Report output of `repo` command. */
export interface RepositoryReport {
	generatedAt: string; // ISO 8601
	durationMs: number;
	repository: RepositoryInfo;
}
