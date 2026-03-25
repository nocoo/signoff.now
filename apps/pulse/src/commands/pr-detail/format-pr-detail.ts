import type { PullRequestDetail, PullRequestDetailReport } from "../types.ts";

/**
 * Format a PullRequestDetailReport as human-readable terminal output.
 */
export function formatPrDetailReport(report: PullRequestDetailReport): string {
	const lines: string[] = [];
	const { pullRequest: pr } = report;
	const repo = `${report.repository.owner}/${report.repository.name}`;

	// Header
	const stateIcon = getDetailStateIcon(pr);
	lines.push(`${stateIcon} #${pr.number} ${pr.title}`);
	lines.push(`${repo} — ${pr.headRefName} → ${pr.baseRefName}`);
	lines.push("");

	// Metadata
	formatMetadata(lines, pr);

	// Body
	if (pr.body.trim()) {
		lines.push("─── Description ───");
		lines.push(pr.body.trim());
		lines.push("");
	}

	// Sections
	formatReviews(lines, pr);
	formatComments(lines, pr);
	formatCommits(lines, pr);
	formatFiles(lines, pr);

	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}

function formatMetadata(lines: string[], pr: PullRequestDetail): void {
	lines.push(`  Author:    @${pr.author}`);
	lines.push(
		`  State:     ${pr.state}${pr.isDraft ? " (draft)" : ""}${pr.merged ? " (merged)" : ""}`,
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
	if (pr.reviewRequests.length > 0) {
		lines.push(`  Reviewers: ${pr.reviewRequests.join(", ")}`);
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
}

function formatReviews(lines: string[], pr: PullRequestDetail): void {
	if (pr.reviews.length === 0) return;

	lines.push(`─── Reviews (${pr.reviews.length}) ───`);
	for (const review of pr.reviews) {
		const state = review.state.toLowerCase().replace(/_/g, " ");
		lines.push(
			`  @${review.author} — ${state}${review.submittedAt ? ` at ${review.submittedAt}` : ""}`,
		);
		if (review.body.trim()) {
			lines.push(`    ${review.body.trim().split("\n").join("\n    ")}`);
		}
		for (const rc of review.comments) {
			const loc = rc.line ? `${rc.path}:${rc.line}` : rc.path;
			const firstLine = rc.body.trim().split("\n")[0];
			lines.push(`    ${loc} — ${firstLine}`);
		}
	}
	lines.push("");
}

function formatComments(lines: string[], pr: PullRequestDetail): void {
	if (pr.comments.length === 0) return;

	lines.push(`─── Comments (${pr.comments.length}) ───`);
	for (const comment of pr.comments) {
		lines.push(`  @${comment.author} at ${comment.createdAt}`);
		lines.push(`    ${comment.body.trim().split("\n").join("\n    ")}`);
	}
	lines.push("");
}

function formatCommits(lines: string[], pr: PullRequestDetail): void {
	if (pr.commits.length === 0) return;

	lines.push(`─── Commits (${pr.commits.length}) ───`);
	for (const commit of pr.commits) {
		const status = commit.statusCheckRollup
			? ` [${commit.statusCheckRollup.state.toLowerCase()}]`
			: "";
		const firstLine = commit.message.split("\n")[0];
		lines.push(
			`  ${commit.abbreviatedOid} ${firstLine}${status}  @${commit.author}`,
		);
		if (commit.statusCheckRollup) {
			for (const cr of commit.statusCheckRollup.checkRuns) {
				const icon = getCheckRunIcon(cr.conclusion);
				const conclusion = cr.conclusion
					? cr.conclusion.toLowerCase()
					: cr.status.toLowerCase();
				lines.push(`    ${icon} ${cr.name} [${conclusion}]`);
			}
		}
	}
	lines.push("");
}

function formatFiles(lines: string[], pr: PullRequestDetail): void {
	if (pr.files.length === 0) return;

	lines.push(`─── Files (${pr.files.length}) ───`);
	for (const file of pr.files) {
		const type = file.changeType.charAt(0);
		lines.push(`  ${type} ${file.path}  +${file.additions} -${file.deletions}`);
	}
	lines.push("");
}

function getDetailStateIcon(pr: {
	merged: boolean;
	isDraft: boolean;
	state: string;
}): string {
	if (pr.merged) return "⬣";
	if (pr.isDraft) return "◌";
	if (pr.state === "OPEN") return "●";
	return "○";
}

function getCheckRunIcon(conclusion: string | null): string {
	switch (conclusion) {
		case "SUCCESS":
			return "✓";
		case "FAILURE":
		case "TIMED_OUT":
			return "✗";
		case "CANCELLED":
		case "SKIPPED":
		case "NEUTRAL":
			return "○";
		default:
			return "⏳";
	}
}
