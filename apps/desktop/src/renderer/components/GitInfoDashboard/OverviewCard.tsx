/**
 * OverviewCard — repository overview: name, branch, HEAD, remote, commit stats.
 */

import type { GitConfig, GitLogs, GitMeta, GitStatus } from "@signoff/gitinfo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";
import { Copy, GitBranch, Globe, Info } from "lucide-react";
import { useCallback } from "react";
import { trpc } from "../../lib/trpc";
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

	const openUrlMutation = trpc.external.openUrl.useMutation();

	const handleCopyHead = useCallback(() => {
		if (meta.headShort) {
			navigator.clipboard.writeText(meta.head ?? meta.headShort);
		}
	}, [meta.head, meta.headShort]);

	const handleOpenRemote = useCallback(() => {
		if (remoteUrl) {
			// Convert git SSH URLs to HTTPS for browser
			const httpUrl = remoteUrl
				.replace(/^git@([^:]+):/, "https://$1/")
				.replace(/\.git$/, "");
			openUrlMutation.mutate({ url: httpUrl });
		}
	}, [remoteUrl, openUrlMutation]);

	return (
		<DashboardCard title="Overview" icon={<Info className="h-4 w-4" />}>
			{/* Repo name + branch */}
			<div className="mb-3">
				<h3 className="text-lg font-semibold">{meta.repoName}</h3>
				<div className="mt-1 flex flex-wrap items-center gap-2">
					{meta.currentBranch !== null && (
						<span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
							<GitBranch className="h-3 w-3" />
							{meta.currentBranch}
						</span>
					)}
					{meta.defaultBranch !== null &&
						meta.defaultBranch !== meta.currentBranch && (
							<span className="text-xs text-muted-foreground">
								default: {meta.defaultBranch}
							</span>
						)}
					{meta.headShort !== null && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={handleCopyHead}
									className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-mono hover:bg-muted/80"
								>
									{meta.headShort}
									<Copy className="h-2.5 w-2.5 text-muted-foreground" />
								</button>
							</TooltipTrigger>
							<TooltipContent>Copy full SHA</TooltipContent>
						</Tooltip>
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
				{meta.isShallow === true && (
					<span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400">
						Shallow Clone
					</span>
				)}
			</div>

			{/* Remote */}
			{remoteUrl !== null && (
				<button
					type="button"
					onClick={handleOpenRemote}
					className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
				>
					<Globe className="h-3 w-3 shrink-0" />
					<span className="truncate">{remoteUrl}</span>
				</button>
			)}

			{/* Stats grid */}
			<div className="grid grid-cols-3 gap-3">
				<StatNumber label="Commits" value={formatNumber(logs.totalCommits)} />
				<StatNumber label="Merges" value={formatNumber(logs.totalMerges)} />
				<StatNumber label="Git dir" value={formatSize(config.gitDirSizeKiB)} />
				{logs.firstCommitDate !== null && (
					<StatNumber
						label="First commit"
						value={relativeDate(logs.firstCommitDate)}
					/>
				)}
				{logs.lastCommit !== null && (
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-muted-foreground">Last commit</span>
						<span className="text-lg font-semibold tabular-nums">
							{relativeDate(logs.lastCommit.date)}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{logs.lastCommit.author}
						</span>
					</div>
				)}
			</div>
		</DashboardCard>
	);
}
