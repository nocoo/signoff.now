import type { PrDetailReport } from "../types.ts";

/**
 * Format a PrDetailReport as human-readable terminal output.
 */
export function formatPrDetailReport(report: PrDetailReport): string {
	const lines: string[] = [];
	const { pr } = report;
	const repo = `${report.repository.owner}/${report.repository.repo}`;

	// Header
	const stateIcon = getDetailStateIcon(pr);
	lines.push(`${stateIcon} #${pr.number} ${pr.title}`);
	lines.push(`${repo} — ${pr.headBranch} → ${pr.baseBranch}`);
	lines.push("");

	// Metadata
	lines.push(`  Author:    @${pr.author}`);
	lines.push(
		`  State:     ${pr.state}${pr.draft ? " (draft)" : ""}${pr.merged ? " (merged)" : ""}`,
	);
	lines.push(
		`  Mergeable: ${pr.mergeable.toLowerCase()} (${pr.mergeStateStatus.toLowerCase()})`,
	);
	if (pr.mergedBy) {
		lines.push(`  Merged by: @${pr.mergedBy}`);
	}
	if (pr.assignees.length > 0) {
		lines.push(`  Assignees: ${pr.assignees.map((a) => `@${a}`).join(", ")}`);
	}
	if (pr.requestedReviewers.length > 0) {
		lines.push(`  Reviewers: ${pr.requestedReviewers.join(", ")}`);
	}
	if (pr.milestone) {
		lines.push(`  Milestone: ${pr.milestone}`);
	}
	if (pr.labels.length > 0) {
		lines.push(`  Labels:    ${pr.labels.join(", ")}`);
	}
	lines.push(
		`  Stats:     +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)`,
	);
	lines.push(`  Created:   ${pr.createdAt}`);
	lines.push(`  Updated:   ${pr.updatedAt}`);
	lines.push(`  URL:       ${pr.url}`);
	lines.push("");

	// Body
	if (pr.body.trim()) {
		lines.push("─── Description ───");
		lines.push(pr.body.trim());
		lines.push("");
	}

	// Reviews
	if (pr.reviews.length > 0) {
		lines.push(`─── Reviews (${pr.reviews.length}) ───`);
		for (const review of pr.reviews) {
			const state = review.state.toLowerCase().replace(/_/g, " ");
			lines.push(
				`  @${review.author} — ${state}${review.submittedAt ? ` at ${review.submittedAt}` : ""}`,
			);
			if (review.body.trim()) {
				lines.push(`    ${review.body.trim().split("\n").join("\n    ")}`);
			}
		}
		lines.push("");
	}

	// Comments
	if (pr.comments.length > 0) {
		lines.push(`─── Comments (${pr.comments.length}) ───`);
		for (const comment of pr.comments) {
			lines.push(`  @${comment.author} at ${comment.createdAt}`);
			lines.push(`    ${comment.body.trim().split("\n").join("\n    ")}`);
		}
		lines.push("");
	}

	// Commits
	if (pr.commits.length > 0) {
		lines.push(`─── Commits (${pr.commits.length}) ───`);
		for (const commit of pr.commits) {
			const status = commit.statusCheckRollup
				? ` [${commit.statusCheckRollup.toLowerCase()}]`
				: "";
			const firstLine = commit.message.split("\n")[0];
			lines.push(`  ${commit.oid} ${firstLine}${status}  @${commit.author}`);
		}
		lines.push("");
	}

	// Files
	if (pr.files.length > 0) {
		lines.push(`─── Files (${pr.files.length}) ───`);
		for (const file of pr.files) {
			const type = file.changeType.charAt(0);
			lines.push(
				`  ${type} ${file.path}  +${file.additions} -${file.deletions}`,
			);
		}
		lines.push("");
	}

	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}

function getDetailStateIcon(pr: {
	merged: boolean;
	draft: boolean;
	state: string;
}): string {
	if (pr.merged) return "⬣";
	if (pr.draft) return "◌";
	if (pr.state === "open") return "●";
	return "○";
}
