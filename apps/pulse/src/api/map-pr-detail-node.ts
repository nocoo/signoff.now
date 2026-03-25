import type {
	CheckConclusionState,
	CheckStatusState,
	PatchStatus,
	PullRequestDetail,
	PullRequestReviewState,
	StatusState,
} from "../commands/types.ts";
import { mapPullRequestNode } from "./map-pr-node.ts";
import type { GraphQLPullRequestDetailNode } from "./types.ts";

/**
 * Convert a raw GraphQL PR detail node to the normalized PullRequestDetail.
 */
export function mapPullRequestDetailNode(
	node: GraphQLPullRequestDetailNode,
): PullRequestDetail {
	const base = mapPullRequestNode(node);

	return {
		...base,
		body: node.body,
		mergeable: node.mergeable,
		mergeStateStatus: node.mergeStateStatus,
		mergedBy: node.mergedBy?.login ?? null,
		totalCommentsCount: node.totalCommentsCount ?? 0,
		participants: node.participants.nodes.map((p) => p.login),
		reviewRequests: node.reviewRequests.nodes
			.map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.slug)
			.filter((v): v is string => v !== null && v !== undefined),
		assignees: node.assignees.nodes.map((a) => a.login),
		milestone: node.milestone?.title ?? null,
		headRefOid: node.headRefOid,
		baseRefOid: node.baseRefOid,
		isCrossRepository: node.isCrossRepository,

		reviews: node.reviews.nodes.map((r) => ({
			author: r.author?.login ?? "ghost",
			state: r.state as PullRequestReviewState,
			body: r.body,
			submittedAt: r.submittedAt,
			comments: r.comments.nodes.map((rc) => ({
				author: rc.author?.login ?? "ghost",
				path: rc.path,
				line: rc.line,
				originalLine: rc.originalLine,
				diffHunk: rc.diffHunk,
				body: rc.body,
				createdAt: rc.createdAt,
				updatedAt: rc.updatedAt,
			})),
		})),

		comments: node.comments.nodes.map((c) => ({
			author: c.author?.login ?? "ghost",
			body: c.body,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		})),

		commits: node.commits.nodes.map((c) => {
			const rollup = c.commit.statusCheckRollup;
			const checkRuns = rollup
				? rollup.contexts.nodes
						.filter(
							(ctx) =>
								ctx.__typename === "CheckRun" &&
								ctx.name !== null &&
								ctx.name !== undefined,
						)
						.map((cr) => ({
							name: cr.name ?? "",
							status: cr.status as CheckStatusState,
							conclusion: (cr.conclusion as CheckConclusionState) ?? null,
							detailsUrl: cr.detailsUrl ?? null,
						}))
				: [];

			return {
				abbreviatedOid: c.commit.abbreviatedOid,
				message: c.commit.message,
				author:
					c.commit.author?.user?.login ?? c.commit.author?.name ?? "unknown",
				authoredDate: c.commit.authoredDate,
				statusCheckRollup: rollup
					? {
							state: rollup.state as StatusState,
							checkRuns,
						}
					: null,
			};
		}),

		files: (node.files?.nodes ?? []).map((f) => ({
			path: f.path,
			additions: f.additions,
			deletions: f.deletions,
			changeType: f.changeType as PatchStatus,
		})),
	};
}
