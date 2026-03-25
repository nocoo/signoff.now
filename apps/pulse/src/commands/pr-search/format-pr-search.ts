import { formatPrLine } from "../prs/format-prs.ts";
import type { PullRequestSearchReport } from "../types.ts";

/**
 * Format a PullRequestSearchReport as human-readable terminal output.
 */
export function formatPrSearchReport(report: PullRequestSearchReport): string {
	const lines: string[] = [];

	// Header
	lines.push(
		`${report.repository.owner}/${report.repository.name} — search: ${report.query}`,
	);
	lines.push(
		`Identity: ${report.identity.resolvedUser} (via ${report.identity.resolvedVia})`,
	);
	lines.push(`Results: ${report.totalCount} match(es)`);
	lines.push("");

	if (report.pullRequests.length === 0) {
		lines.push("No pull requests found.");
		return lines.join("\n");
	}

	for (const pr of report.pullRequests) {
		lines.push(formatPrLine(pr));
	}

	if (report.hasNextPage) {
		lines.push("");
		lines.push(`(more results available — cursor: ${report.endCursor})`);
	}

	lines.push("");
	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}
