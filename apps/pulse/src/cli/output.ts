import { formatPrDetailReport } from "../commands/pr-detail/format-pr-detail.ts";
import { formatPrDiffReport } from "../commands/pr-diff/format-pr-diff.ts";
import { formatPrSearchReport } from "../commands/pr-search/format-pr-search.ts";
import { formatPrsReport } from "../commands/prs/format-prs.ts";
import type {
	PullRequestDetailReport,
	PullRequestDiffReport,
	PullRequestSearchReport,
	PullRequestsReport,
} from "../commands/types.ts";

type Report =
	| PullRequestsReport
	| PullRequestDetailReport
	| PullRequestDiffReport
	| PullRequestSearchReport;

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
	return formatPrDetailReport(report);
}
