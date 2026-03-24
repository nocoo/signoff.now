import type { PrsReport, PullRequestInfo } from "../types.ts";

/**
 * Format a PrsReport as human-readable terminal output.
 */
export function formatPrsReport(report: PrsReport): string {
	const lines: string[] = [];

	// Header
	lines.push(
		`${report.repository.owner}/${report.repository.repo} — ${report.totalCount} PR(s)`,
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

	if (report.prs.length === 0) {
		lines.push("No pull requests found.");
		return lines.join("\n");
	}

	// PR list
	for (const pr of report.prs) {
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
	const stats = `+${pr.additions} -${pr.deletions}`;

	return `  ${stateIcon} #${pr.number} ${pr.title}${labels}${review}  ${stats}  @${pr.author}`;
}

function getStateIcon(pr: PullRequestInfo): string {
	if (pr.merged) return "⬣";
	if (pr.draft) return "◌";
	if (pr.state === "open") return "●";
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
