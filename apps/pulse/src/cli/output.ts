import { formatPrDetailReport } from "../commands/pr-detail/format-pr-detail.ts";
import { formatPrDiffReport } from "../commands/pr-diff/format-pr-diff.ts";
import { formatPrSearchReport } from "../commands/pr-search/format-pr-search.ts";
import { formatPrsReport } from "../commands/prs/format-prs.ts";
import { formatRepoReport } from "../commands/repo/format-repo.ts";
import type {
	PullRequestDetailReport,
	PullRequestDiffReport,
	PullRequestSearchReport,
	PullRequestsReport,
	RepositoryReport,
} from "../commands/types.ts";

type Report =
	| PullRequestsReport
	| PullRequestDetailReport
	| PullRequestDiffReport
	| PullRequestSearchReport
	| RepositoryReport;

/**
 * Format a report for output.
 * --pretty → human-readable text, otherwise compact JSON.
 */
export function formatOutput(report: Report, pretty: boolean): string {
	if (!pretty) {
		return JSON.stringify(report);
	}
	if ("query" in report) {
		return formatPrSearchReport(report);
	}
	if ("pullRequests" in report) {
		return formatPrsReport(report);
	}
	if ("diff" in report) {
		return formatPrDiffReport(report);
	}
	if ("pullRequest" in report) {
		return formatPrDetailReport(report);
	}
	return formatRepoReport(report);
}
