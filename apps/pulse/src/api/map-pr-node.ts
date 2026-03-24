import type { PullRequestInfo } from "../commands/types.ts";
import type { GraphQLPrNode } from "./types.ts";

/**
 * Convert a raw GraphQL PR node to the normalized PullRequestInfo.
 */
export function mapPrNode(node: GraphQLPrNode): PullRequestInfo {
	return {
		number: node.number,
		title: node.title,
		state: node.state === "OPEN" ? "open" : "closed",
		draft: node.isDraft,
		merged: node.merged,
		mergedAt: node.mergedAt,
		author: node.author?.login ?? "ghost",
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		closedAt: node.closedAt,
		headBranch: node.headRefName,
		baseBranch: node.baseRefName,
		url: node.url,
		labels: node.labels.nodes.map((l) => l.name),
		reviewDecision: node.reviewDecision,
		additions: node.additions,
		deletions: node.deletions,
		changedFiles: node.changedFiles,
	};
}
