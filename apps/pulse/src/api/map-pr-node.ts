import type { PullRequestInfo } from "../commands/types.ts";
import type { GraphQLPullRequestNode } from "./types.ts";

/**
 * Convert a raw GraphQL PR node to the normalized PullRequestInfo.
 */
export function mapPullRequestNode(
	node: GraphQLPullRequestNode,
): PullRequestInfo {
	return {
		number: node.number,
		title: node.title,
		state: node.state,
		isDraft: node.isDraft,
		merged: node.merged,
		mergedAt: node.mergedAt,
		author: node.author?.login ?? "ghost",
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		closedAt: node.closedAt,
		headRefName: node.headRefName,
		baseRefName: node.baseRefName,
		url: node.url,
		labels: node.labels.nodes.map((l) => l.name),
		reviewDecision:
			(node.reviewDecision as PullRequestInfo["reviewDecision"]) ?? null,
		additions: node.additions,
		deletions: node.deletions,
		changedFiles: node.changedFiles,
		totalCommentsCount: node.totalCommentsCount ?? 0,
		commitsCount: node.commits.totalCount,
	};
}
