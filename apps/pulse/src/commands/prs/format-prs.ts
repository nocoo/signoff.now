import type { PullRequestInfo, PullRequestsReport } from "../types.ts";

/**
 * Format a PullRequestsReport as human-readable terminal output.
 */
export function formatPrsReport(report: PullRequestsReport): string {
	const lines: string[] = [];

	// Header
	lines.push(
		`${report.repository.owner}/${report.repository.name} — ${report.totalCount} PR(s)`,
	);
	lines.push(
		`Identity: ${report.identity.resolvedUser} (via ${report.identity.resolvedVia})`,
	);

	const filterParts: string[] = [`state=${report.filters.state}`];
	if (report.filters.author) {
		filterParts.push(`author=${report.filters.author}`);
	}
	if (report.filters.limit > 0) {
		filterParts.push(`limit=${report.filters.limit}`);
	}
	lines.push(`Filters: ${filterParts.join(", ")}`);
	lines.push("");

	if (report.pullRequests.length === 0) {
		lines.push("No pull requests found.");
		return lines.join("\n");
	}

	// PR list
	for (const pr of report.pullRequests) {
		lines.push(formatPrLine(pr));
	}

	lines.push("");
	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}

/**
 * Format a single PR as a one-line summary.
 */
export function formatPrLine(pr: PullRequestInfo): string {
	const stateIcon = getStateIcon(pr);
	const labels = pr.labels.length > 0 ? ` [${pr.labels.join(", ")}]` : "";
	const review = pr.reviewDecision
		? ` (${formatReviewDecision(pr.reviewDecision)})`
		: "";
	const stats = `+${pr.additions} -${pr.deletions} 💬${pr.totalCommentsCount} 📦${pr.commitsCount}`;

	return `  ${stateIcon} #${pr.number} ${pr.title}${labels}${review}  ${stats}  @${pr.author}`;
}

function getStateIcon(pr: PullRequestInfo): string {
	if (pr.merged) return "⬣";
	if (pr.isDraft) return "◌";
	if (pr.state === "OPEN") return "●";
	return "○";
}

function formatReviewDecision(decision: string): string {
	switch (decision) {
		case "APPROVED":
			return "approved";
		case "CHANGES_REQUESTED":
			return "changes requested";
		case "REVIEW_REQUIRED":
			return "review required";
		default:
			return decision.toLowerCase();
	}
}
