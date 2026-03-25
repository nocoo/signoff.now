/**
 * DB-backed PR cache helpers.
 *
 * Pure data access functions — no tRPC or business logic.
 * Accepts a Drizzle DB instance (injected via getDb pattern).
 */

import {
	pullRequestDetails,
	pullRequestScans,
	pullRequests,
} from "@signoff/local-db";
import type {
	IssueComment,
	PullRequestChangedFile,
	PullRequestCommit,
	PullRequestDetail,
	PullRequestInfo,
	PullRequestReview,
} from "@signoff/pulse";
import { and, desc, eq, sql } from "drizzle-orm";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type Db = any;

// ---------------------------------------------------------------------------
// List layer (pull_requests)
// ---------------------------------------------------------------------------

/**
 * Batch upsert PullRequestInfo rows.
 *
 * Uses ON CONFLICT(project_id, number) DO UPDATE to refresh
 * existing rows without deleting them — preserving any
 * pull_request_details rows that reference the same PR.
 */
export function upsertPrs(
	db: Db,
	projectId: string,
	prs: PullRequestInfo[],
): void {
	if (prs.length === 0) return;

	const now = Date.now();

	for (const pr of prs) {
		db.insert(pullRequests)
			.values({
				projectId,
				number: pr.number,
				title: pr.title,
				state: pr.state,
				draft: pr.isDraft,
				merged: pr.merged,
				mergedAt: pr.mergedAt,
				author: pr.author,
				createdAt: pr.createdAt,
				updatedAt: pr.updatedAt,
				closedAt: pr.closedAt,
				headBranch: pr.headRefName,
				baseBranch: pr.baseRefName,
				url: pr.url,
				labels: pr.labels,
				reviewDecision: pr.reviewDecision,
				additions: pr.additions,
				deletions: pr.deletions,
				changedFiles: pr.changedFiles,
				fetchedAt: now,
			})
			.onConflictDoUpdate({
				target: [pullRequests.projectId, pullRequests.number],
				set: {
					title: sql`excluded.title`,
					state: sql`excluded.state`,
					draft: sql`excluded.draft`,
					merged: sql`excluded.merged`,
					mergedAt: sql`excluded.merged_at`,
					author: sql`excluded.author`,
					createdAt: sql`excluded.created_at`,
					updatedAt: sql`excluded.updated_at`,
					closedAt: sql`excluded.closed_at`,
					headBranch: sql`excluded.head_branch`,
					baseBranch: sql`excluded.base_branch`,
					url: sql`excluded.url`,
					labels: sql`excluded.labels`,
					reviewDecision: sql`excluded.review_decision`,
					additions: sql`excluded.additions`,
					deletions: sql`excluded.deletions`,
					changedFiles: sql`excluded.changed_files`,
					fetchedAt: sql`excluded.fetched_at`,
				},
			})
			.run();
	}
}

/**
 * Query cached PR list, optionally filtered by state.
 *
 * Returns PullRequestInfo[] ordered by createdAt DESC.
 * When state is "all" or omitted, returns all cached PRs.
 */
export function getCachedPrs(
	db: Db,
	projectId: string,
	state?: "open" | "closed" | "all",
): PullRequestInfo[] {
	const conditions = [eq(pullRequests.projectId, projectId)];
	if (state && state !== "all") {
		// DB stores uppercase PullRequestState values; map UI filter to DB value
		const dbState = state === "open" ? "OPEN" : "CLOSED";
		conditions.push(eq(pullRequests.state, dbState));
	}

	const rows = db
		.select()
		.from(pullRequests)
		.where(and(...conditions))
		.orderBy(desc(pullRequests.createdAt))
		.all();

	return rows.map(rowToPullRequestInfo);
}

// ---------------------------------------------------------------------------
// Detail layer (pull_request_details)
// ---------------------------------------------------------------------------

/**
 * Upsert a PR detail row AND refresh the corresponding list row.
 *
 * The detail fetch returns the full PrDetail (which extends PullRequestInfo),
 * so we update both tables in one call.
 */
export function upsertPrDetail(
	db: Db,
	projectId: string,
	detail: PullRequestDetail,
): void {
	const now = Date.now();

	// 1. Refresh list-level row
	upsertPrs(db, projectId, [detail]);

	// 2. Upsert detail-only fields
	db.insert(pullRequestDetails)
		.values({
			projectId,
			number: detail.number,
			body: detail.body,
			mergeable: detail.mergeable,
			mergeStateStatus: detail.mergeStateStatus,
			mergedBy: detail.mergedBy,
			totalCommentsCount: detail.totalCommentsCount,
			headRefOid: detail.headRefOid,
			baseRefOid: detail.baseRefOid,
			isCrossRepository: detail.isCrossRepository,
			participants: detail.participants,
			requestedReviewers: detail.reviewRequests,
			assignees: detail.assignees,
			milestone: detail.milestone,
			reviews: detail.reviews,
			comments: detail.comments,
			commits: detail.commits,
			files: detail.files,
			fetchedAt: now,
		})
		.onConflictDoUpdate({
			target: [pullRequestDetails.projectId, pullRequestDetails.number],
			set: {
				body: sql`excluded.body`,
				mergeable: sql`excluded.mergeable`,
				mergeStateStatus: sql`excluded.merge_state_status`,
				mergedBy: sql`excluded.merged_by`,
				totalCommentsCount: sql`excluded.total_comments_count`,
				headRefOid: sql`excluded.head_ref_oid`,
				baseRefOid: sql`excluded.base_ref_oid`,
				isCrossRepository: sql`excluded.is_cross_repository`,
				participants: sql`excluded.participants`,
				requestedReviewers: sql`excluded.requested_reviewers`,
				assignees: sql`excluded.assignees`,
				milestone: sql`excluded.milestone`,
				reviews: sql`excluded.reviews`,
				comments: sql`excluded.comments`,
				commits: sql`excluded.commits`,
				files: sql`excluded.files`,
				fetchedAt: sql`excluded.fetched_at`,
			},
		})
		.run();
}

/**
 * Query cached PR detail by project + number.
 *
 * JOINs pull_requests + pull_request_details to produce a full PrDetail.
 * Returns null if either row is missing.
 */
export function getCachedPrDetail(
	db: Db,
	projectId: string,
	number: number,
): PullRequestDetail | null {
	const row = db
		.select()
		.from(pullRequests)
		.innerJoin(
			pullRequestDetails,
			and(
				eq(pullRequestDetails.projectId, pullRequests.projectId),
				eq(pullRequestDetails.number, pullRequests.number),
			),
		)
		.where(
			and(
				eq(pullRequests.projectId, projectId),
				eq(pullRequests.number, number),
			),
		)
		.get();

	if (!row) return null;

	const pr = row.pull_requests;
	const det = row.pull_request_details;

	return {
		// List fields
		number: pr.number,
		title: pr.title,
		state: pr.state as PullRequestInfo["state"],
		isDraft: pr.draft,
		merged: pr.merged,
		mergedAt: pr.mergedAt,
		author: pr.author,
		createdAt: pr.createdAt,
		updatedAt: pr.updatedAt,
		closedAt: pr.closedAt,
		headRefName: pr.headBranch,
		baseRefName: pr.baseBranch,
		url: pr.url,
		labels: pr.labels as string[],
		reviewDecision: pr.reviewDecision,
		additions: pr.additions,
		deletions: pr.deletions,
		changedFiles: pr.changedFiles,

		// Detail fields
		body: det.body,
		mergeable: det.mergeable as PullRequestDetail["mergeable"],
		mergeStateStatus:
			det.mergeStateStatus as PullRequestDetail["mergeStateStatus"],
		mergedBy: det.mergedBy,
		totalCommentsCount: det.totalCommentsCount,
		headRefOid: det.headRefOid,
		baseRefOid: det.baseRefOid,
		isCrossRepository: det.isCrossRepository,
		participants: det.participants as string[],
		reviewRequests: det.requestedReviewers as string[],
		assignees: det.assignees as string[],
		milestone: det.milestone,
		reviews: det.reviews as PullRequestReview[],
		comments: det.comments as IssueComment[],
		commits: det.commits as PullRequestCommit[],
		files: det.files as PullRequestChangedFile[],
	};
}

// ---------------------------------------------------------------------------
// Scan metadata (pull_request_scans)
// ---------------------------------------------------------------------------

/** Scan metadata row shape returned by getScanMeta. */
export interface ScanMeta {
	endCursor: string | null;
	hasNextPage: boolean;
	resolvedUser: string | null;
	resolvedVia: string | null;
	repoOwner: string | null;
	repoName: string | null;
	scannedAt: number;
}

/**
 * Get scan metadata for a project (pagination cursor, identity, etc.).
 */
export function getScanMeta(db: Db, projectId: string): ScanMeta | null {
	const row = db
		.select()
		.from(pullRequestScans)
		.where(eq(pullRequestScans.projectId, projectId))
		.get();

	if (!row) return null;

	return {
		endCursor: row.endCursor,
		hasNextPage: row.hasNextPage,
		resolvedUser: row.resolvedUser,
		resolvedVia: row.resolvedVia,
		repoOwner: row.repoOwner,
		repoName: row.repoName,
		scannedAt: row.scannedAt,
	};
}

/**
 * Upsert scan metadata after a GitHub API response.
 */
export function upsertScanMeta(
	db: Db,
	projectId: string,
	meta: {
		endCursor: string | null;
		hasNextPage: boolean;
		resolvedUser?: string | null;
		resolvedVia?: string | null;
		repoOwner?: string | null;
		repoName?: string | null;
	},
): void {
	const now = Date.now();

	db.insert(pullRequestScans)
		.values({
			projectId,
			endCursor: meta.endCursor,
			hasNextPage: meta.hasNextPage,
			resolvedUser: meta.resolvedUser ?? null,
			resolvedVia: meta.resolvedVia ?? null,
			repoOwner: meta.repoOwner ?? null,
			repoName: meta.repoName ?? null,
			scannedAt: now,
		})
		.onConflictDoUpdate({
			target: [pullRequestScans.projectId],
			set: {
				endCursor: sql`excluded.end_cursor`,
				hasNextPage: sql`excluded.has_next_page`,
				resolvedUser: sql`excluded.resolved_user`,
				resolvedVia: sql`excluded.resolved_via`,
				repoOwner: sql`excluded.repo_owner`,
				repoName: sql`excluded.repo_name`,
				scannedAt: sql`excluded.scanned_at`,
			},
		})
		.run();
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/**
 * Delete all cached PR data for a project (all 3 tables).
 */
export function clearCache(db: Db, projectId: string): void {
	db.delete(pullRequestDetails)
		.where(eq(pullRequestDetails.projectId, projectId))
		.run();
	db.delete(pullRequests).where(eq(pullRequests.projectId, projectId)).run();
	db.delete(pullRequestScans)
		.where(eq(pullRequestScans.projectId, projectId))
		.run();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a Drizzle pull_requests row to PullRequestInfo.
 */
// biome-ignore lint/suspicious/noExplicitAny: row shape varies by query
function rowToPullRequestInfo(row: any): PullRequestInfo {
	return {
		number: row.number,
		title: row.title,
		state: row.state,
		isDraft: row.draft,
		merged: row.merged,
		mergedAt: row.mergedAt,
		author: row.author,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		closedAt: row.closedAt,
		headRefName: row.headBranch,
		baseRefName: row.baseBranch,
		url: row.url,
		labels: row.labels as string[],
		reviewDecision: row.reviewDecision,
		additions: row.additions,
		deletions: row.deletions,
		changedFiles: row.changedFiles,
	};
}
