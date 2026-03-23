/**
 * OverviewCard — repository overview: name, branch, HEAD, remote, commit stats.
 */

import type { GitConfig, GitLogs, GitMeta, GitStatus } from "@signoff/gitinfo";
import { cn } from "@signoff/ui/utils";
import { GitBranch, Globe, Info } from "lucide-react";
import { DashboardCard } from "./DashboardCard";
import {
	formatNumber,
	formatSize,
	relativeDate,
	StatNumber,
} from "./StatNumber";

const REPO_STATE_LABELS: Record<string, { label: string; color: string }> = {
	clean: { label: "Clean", color: "bg-green-500/15 text-green-400" },
	merge: { label: "Merging", color: "bg-yellow-500/15 text-yellow-400" },
	"rebase-interactive": {
		label: "Interactive Rebase",
		color: "bg-yellow-500/15 text-yellow-400",
	},
	rebase: { label: "Rebasing", color: "bg-yellow-500/15 text-yellow-400" },
	"cherry-pick": {
		label: "Cherry-picking",
		color: "bg-yellow-500/15 text-yellow-400",
	},
	bisect: { label: "Bisecting", color: "bg-yellow-500/15 text-yellow-400" },
	revert: { label: "Reverting", color: "bg-yellow-500/15 text-yellow-400" },
};

interface OverviewCardProps {
	meta: GitMeta;
	logs: GitLogs;
	status: GitStatus;
	config: GitConfig;
}

export function OverviewCard({
	meta,
	logs,
	status,
	config,
}: OverviewCardProps) {
	const stateInfo = REPO_STATE_LABELS[status.repoState] ?? {
		label: status.repoState,
		color: "bg-muted text-muted-foreground",
	};
	const hasConflicts = status.conflicted.length > 0;
	const remoteUrl = meta.remotes[0]?.fetchUrl;

	return (
		<DashboardCard title="Overview" icon={<Info className="h-4 w-4" />}>
			{/* Repo name + branch */}
			<div className="mb-3">
				<h3 className="text-lg font-semibold">{meta.repoName}</h3>
				<div className="mt-1 flex flex-wrap items-center gap-2">
					{meta.currentBranch && (
						<span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
							<GitBranch className="h-3 w-3" />
							{meta.currentBranch}
						</span>
					)}
					{meta.defaultBranch && meta.defaultBranch !== meta.currentBranch && (
						<span className="text-xs text-muted-foreground">
							default: {meta.defaultBranch}
						</span>
					)}
					{meta.headShort && (
						<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{meta.headShort}
						</code>
					)}
				</div>
			</div>

			{/* Badges row */}
			<div className="mb-3 flex flex-wrap gap-2">
				<span
					className={cn(
						"rounded px-2 py-0.5 text-xs font-medium",
						stateInfo.color,
					)}
				>
					{stateInfo.label}
				</span>
				{hasConflicts && (
					<span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
						{status.conflicted.length} Conflict
						{status.conflicted.length > 1 ? "s" : ""}
					</span>
				)}
				{meta.isShallow && (
					<span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400">
						Shallow Clone
					</span>
				)}
			</div>

			{/* Remote */}
			{remoteUrl && (
				<div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Globe className="h-3 w-3 shrink-0" />
					<span className="truncate">{remoteUrl}</span>
				</div>
			)}

			{/* Stats grid */}
			<div className="grid grid-cols-3 gap-3">
				<StatNumber label="Commits" value={formatNumber(logs.totalCommits)} />
				<StatNumber label="Merges" value={formatNumber(logs.totalMerges)} />
				<StatNumber label="Git dir" value={formatSize(config.gitDirSizeKiB)} />
				{logs.firstCommitDate && (
					<StatNumber
						label="First commit"
						value={relativeDate(logs.firstCommitDate)}
					/>
				)}
				{logs.lastCommit && (
					<StatNumber
						label="Last commit"
						value={relativeDate(logs.lastCommit.date)}
					/>
				)}
			</div>
		</DashboardCard>
	);
}
