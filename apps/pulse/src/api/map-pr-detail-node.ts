import type { PrDetail } from "../commands/types.ts";
import { mapPrNode } from "./map-pr-node.ts";
import type { GraphQLPrDetailNode } from "./types.ts";

/**
 * Convert a raw GraphQL PR detail node to the normalized PrDetail.
 */
export function mapPrDetailNode(node: GraphQLPrDetailNode): PrDetail {
	const base = mapPrNode(node);

	return {
		...base,
		body: node.body,
		mergeable: node.mergeable,
		mergeStateStatus: node.mergeStateStatus,
		mergedBy: node.mergedBy?.login ?? null,
		totalCommentsCount: node.totalCommentsCount ?? 0,
		participants: node.participants.nodes.map((p) => p.login),
		requestedReviewers: node.reviewRequests.nodes
			.map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.slug)
			.filter((v): v is string => v !== null && v !== undefined),
		assignees: node.assignees.nodes.map((a) => a.login),
		milestone: node.milestone?.title ?? null,
		headRefOid: node.headRefOid,
		baseRefOid: node.baseRefOid,
		isCrossRepository: node.isCrossRepository,

		reviews: node.reviews.nodes.map((r) => ({
			author: r.author?.login ?? "ghost",
			state: r.state as PrDetail["reviews"][number]["state"],
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

		commits: node.commits.nodes.map((c) => ({
			oid: c.commit.abbreviatedOid,
			message: c.commit.message,
			author:
				c.commit.author?.user?.login ?? c.commit.author?.name ?? "unknown",
			authoredDate: c.commit.authoredDate,
			statusCheckRollup:
				(c.commit.statusCheckRollup
					?.state as PrDetail["commits"][number]["statusCheckRollup"]) ?? null,
			checkRuns: (c.commit.statusCheckRollup?.contexts.nodes ?? [])
				.filter(
					(ctx) =>
						ctx.__typename === "CheckRun" &&
						ctx.name !== null &&
						ctx.name !== undefined,
				)
				.map((cr) => ({
					name: cr.name ?? "",
					status:
						cr.status as PrDetail["commits"][number]["checkRuns"][number]["status"],
					conclusion:
						(cr.conclusion as PrDetail["commits"][number]["checkRuns"][number]["conclusion"]) ??
						null,
					detailsUrl: cr.detailsUrl ?? null,
				})),
		})),

		files: (node.files?.nodes ?? []).map((f) => ({
			path: f.path,
			additions: f.additions,
			deletions: f.deletions,
			changeType: f.changeType as PrDetail["files"][number]["changeType"],
		})),
	};
}
