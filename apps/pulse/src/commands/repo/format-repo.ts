import type { RepositoryReport } from "../types.ts";

/**
 * Format a RepositoryReport as human-readable terminal output.
 */
export function formatRepoReport(report: RepositoryReport): string {
	const { repository: repo } = report;
	const lines: string[] = [];

	// Header
	lines.push(`${repo.owner}/${repo.name}`);
	if (repo.description) {
		lines.push(repo.description);
	}
	lines.push(repo.url);
	lines.push("");

	// Metadata
	const flags: string[] = [];
	if (repo.isPrivate) flags.push("private");
	if (repo.isArchived) flags.push("archived");
	if (flags.length > 0) {
		lines.push(`Flags: ${flags.join(", ")}`);
	}

	if (repo.primaryLanguage) {
		lines.push(`Language: ${repo.primaryLanguage.name}`);
	}
	if (repo.languages.length > 0) {
		lines.push(`Languages: ${repo.languages.map((l) => l.name).join(", ")}`);
	}
	if (repo.licenseInfo) {
		lines.push(`License: ${repo.licenseInfo}`);
	}
	lines.push(`Default branch: ${repo.defaultBranchRef}`);
	lines.push(`Stars: ${repo.stargazerCount}  Forks: ${repo.forkCount}`);

	if (repo.homepageUrl) {
		lines.push(`Homepage: ${repo.homepageUrl}`);
	}

	if (repo.topics.length > 0) {
		lines.push(`Topics: ${repo.topics.join(", ")}`);
	}

	lines.push("");
	lines.push(`Created: ${repo.createdAt}`);
	lines.push(`Updated: ${repo.updatedAt}`);
	lines.push(`Pushed:  ${repo.pushedAt}`);

	lines.push("");
	lines.push(`Completed in ${report.durationMs}ms`);

	return lines.join("\n");
}
