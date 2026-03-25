import type { PullRequestDiffReport } from "../types.ts";

/**
 * Format a PullRequestDiffReport as human-readable terminal output.
 */
export function formatPrDiffReport(report: PullRequestDiffReport): string {
	const lines: string[] = [];
	const repo = `${report.repository.owner}/${report.repository.name}`;

	lines.push(`Diff for PR #${report.pullRequest.number} — ${repo}`);
	lines.push("");

	// File summary
	if (report.files.length > 0) {
		lines.push(`─── Files (${report.files.length}) ───`);
		for (const file of report.files) {
			const type = file.changeType.charAt(0);
			lines.push(
				`  ${type} ${file.path}  +${file.additions} -${file.deletions}`,
			);
		}
		lines.push("");
	}

	// Full diff
	if (report.diff) {
		lines.push("─── Diff ───");
		lines.push(report.diff);
	}

	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}
