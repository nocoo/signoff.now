import { formatPrDetailReport } from "../commands/pr-detail/format-pr-detail.ts";
import { formatPrsReport } from "../commands/prs/format-prs.ts";
import type {
	PullRequestDetailReport,
	PullRequestsReport,
} from "../commands/types.ts";

type Report = PullRequestsReport | PullRequestDetailReport;

/**
 * Format a report for output.
 * --pretty → human-readable text, otherwise compact JSON.
 */
export function formatOutput(report: Report, pretty: boolean): string {
	if (!pretty) {
		return JSON.stringify(report);
	}
	if ("pullRequests" in report) {
		return formatPrsReport(report);
	}
	return formatPrDetailReport(report);
}
