import type {
	GitBranches,
	GitConfig,
	GitContributors,
	GitFiles,
	GitInfoReport,
	GitLogs,
	GitMeta,
	GitStatus,
	GitTags,
} from "../types.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function heading(title: string): string {
	return `\n${BOLD}${CYAN}═══ ${title} ═══${RESET}\n`;
}

function kv(key: string, value: string | number | boolean | null): string {
	const display = value === null ? `${DIM}null${RESET}` : String(value);
	return `  ${GREEN}${key}${RESET}: ${display}`;
}

function formatMeta(meta: GitMeta): string {
	const lines = [
		heading("Meta"),
		kv("Git Version", meta.gitVersion),
		kv("Repository", meta.repoName),
		kv("Root", meta.repoRoot),
		kv("HEAD", meta.headShort),
		kv("Branch", meta.currentBranch),
		kv("Default Branch", meta.defaultBranch),
		kv("Shallow", meta.isShallow),
		kv("First Commit", meta.firstCommitAuthorDate),
	];
	if (meta.remotes.length > 0) {
		lines.push(`  ${GREEN}Remotes${RESET}:`);
		for (const r of meta.remotes) {
			lines.push(`    ${r.name}: ${r.fetchUrl}`);
		}
	}
	return lines.join("\n");
}

function formatStatus(status: GitStatus): string {
	const lines = [
		heading("Status"),
		kv("State", status.repoState),
		kv("Staged", status.staged.length),
		kv("Modified", status.modified.length),
		kv("Untracked", status.untracked.length),
		kv("Conflicted", status.conflicted.length),
		kv("Stashes", status.stashCount),
	];
	return lines.join("\n");
}

function formatBranches(branches: GitBranches): string {
	const lines = [
		heading("Branches"),
		kv("Current", branches.current),
		kv("Local", branches.totalLocal),
		kv("Remote", branches.totalRemote),
	];
	if (branches.local.length > 0) {
		lines.push(`  ${GREEN}Local branches${RESET}:`);
		for (const b of branches.local) {
			const upstream = b.upstream ? ` → ${b.upstream}` : "";
			const ahead = b.aheadBehind
				? ` ${YELLOW}↑${b.aheadBehind.ahead} ↓${b.aheadBehind.behind}${RESET}`
				: "";
			const merged = b.isMerged ? ` ${DIM}(merged)${RESET}` : "";
			lines.push(`    ${b.name}${upstream}${ahead}${merged}`);
		}
	}
	return lines.join("\n");
}

function formatLogs(logs: GitLogs): string {
	const lines = [
		heading("Logs"),
		kv("Total Commits", logs.totalCommits),
		kv("Merges", logs.totalMerges),
		kv("First Commit", logs.firstCommitDate),
	];
	if (logs.lastCommit) {
		const c = logs.lastCommit;
		lines.push(`  ${GREEN}Last Commit${RESET}:`);
		lines.push(`    ${c.shaShort} ${c.subject}`);
		lines.push(`    ${DIM}${c.author} · ${c.date}${RESET}`);
	}
	if (logs.conventionalTypes) {
		lines.push(`  ${GREEN}Conventional Types${RESET}:`);
		for (const [type, count] of Object.entries(logs.conventionalTypes)) {
			lines.push(`    ${type}: ${count}`);
		}
	}
	return lines.join("\n");
}

function formatContributors(contrib: GitContributors): string {
	const lines = [
		heading("Contributors"),
		kv("Total Authors", contrib.totalAuthors),
		kv("Active (90d)", contrib.activeRecent),
	];
	if (contrib.authors.length > 0) {
		lines.push(`  ${GREEN}Top Authors${RESET}:`);
		const top = contrib.authors.slice(0, 10);
		for (const a of top) {
			lines.push(`    ${a.name} <${a.email}> (${a.commits} commits)`);
		}
	}
	return lines.join("\n");
}

function formatTags(tags: GitTags): string {
	const lines = [
		heading("Tags"),
		kv("Count", tags.count),
		kv("Latest Reachable", tags.latestReachableTag),
		kv("Commits Since Tag", tags.commitsSinceTag),
	];
	if (tags.tags.length > 0) {
		lines.push(`  ${GREEN}Tags${RESET}:`);
		for (const t of tags.tags) {
			const type = `${DIM}(${t.type})${RESET}`;
			lines.push(`    ${t.name} ${type}`);
		}
	}
	return lines.join("\n");
}

function formatFiles(files: GitFiles): string {
	const lines = [
		heading("Files"),
		kv("Tracked", files.trackedCount),
		kv("Total Lines", files.totalLines),
	];
	if (Object.keys(files.typeDistribution).length > 0) {
		lines.push(`  ${GREEN}Type Distribution${RESET}:`);
		const sorted = Object.entries(files.typeDistribution).sort(
			(a, b) => b[1] - a[1],
		);
		for (const [ext, count] of sorted.slice(0, 10)) {
			lines.push(`    .${ext}: ${count}`);
		}
	}
	if (files.largestTracked.length > 0) {
		lines.push(`  ${GREEN}Largest Files${RESET}:`);
		for (const f of files.largestTracked.slice(0, 5)) {
			const sizeKiB = (f.sizeBytes / 1024).toFixed(1);
			lines.push(`    ${f.path} (${sizeKiB} KiB)`);
		}
	}
	return lines.join("\n");
}

function formatConfig(config: GitConfig): string {
	const lines = [
		heading("Config"),
		kv("Git Dir Size", `${config.gitDirSizeKiB} KiB`),
		kv("Worktrees", config.worktreeCount),
		kv("Loose Objects", config.objectStats.count),
		kv("Packed Objects", config.objectStats.inPack),
		kv("Pack Files", config.objectStats.packs),
	];
	if (config.hooks.length > 0) {
		lines.push(`  ${GREEN}Hooks${RESET}: ${config.hooks.join(", ")}`);
	}
	return lines.join("\n");
}

export function formatPretty(report: GitInfoReport): string {
	const sections = [
		formatMeta(report.meta),
		formatStatus(report.status),
		formatBranches(report.branches),
		formatLogs(report.logs),
		formatContributors(report.contributors),
		formatTags(report.tags),
		formatFiles(report.files),
		formatConfig(report.config),
	];

	const header = `${BOLD}gitinfo${RESET} — generated ${report.generatedAt} (${report.durationMs}ms)`;
	const errors =
		report.errors.length > 0
			? `\n${YELLOW}⚠ ${report.errors.length} collector error(s)${RESET}`
			: "";

	return `${header}${errors}\n${sections.join("\n")}`;
}

export function formatPrettySection(
	report: GitInfoReport,
	section: string,
): string {
	const formatters: Record<string, () => string> = {
		meta: () => formatMeta(report.meta),
		status: () => formatStatus(report.status),
		branches: () => formatBranches(report.branches),
		logs: () => formatLogs(report.logs),
		contributors: () => formatContributors(report.contributors),
		tags: () => formatTags(report.tags),
		files: () => formatFiles(report.files),
		config: () => formatConfig(report.config),
	};

	const formatter = formatters[section];
	if (!formatter) return JSON.stringify(report, null, 2);
	return formatter();
}
