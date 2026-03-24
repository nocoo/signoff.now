import { formatPrsReport } from "../commands/prs/format-prs.ts";
import type { PrsReport } from "../commands/types.ts";

/**
 * Format a PrsReport for output.
 * --pretty → human-readable text, otherwise compact JSON.
 */
export function formatOutput(report: PrsReport, pretty: boolean): string {
	if (pretty) {
		return formatPrsReport(report);
	}
	return JSON.stringify(report);
}
