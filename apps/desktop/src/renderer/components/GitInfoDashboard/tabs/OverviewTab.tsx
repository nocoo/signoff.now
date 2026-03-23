/**
 * OverviewTab — repo header, badges, summary stats, working tree, config.
 *
 * Combines the information that was spread across OverviewCard,
 * StatusCard, and ConfigCard into a single overview page.
 */

import type {
	GitBranches,
	GitConfig,
	GitContributors,
	GitFiles,
	GitLogs,
	GitMeta,
	GitStatus,
	GitTags,
} from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";
import { Copy, GitBranch, Globe } from "lucide-react";
import { useCallback, useState } from "react";
import { trpc } from "../../../lib/trpc";
import { INTERESTING_CONFIG_KEYS, REPO_STATE_LABELS } from "../constants";
import { DashboardCard } from "../DashboardCard";
import {
	formatNumber,
	formatSize,
	relativeDate,
	StatNumber,
} from "../StatNumber";

interface OverviewTabProps {
	meta: GitMeta;
	logs: GitLogs;
	status: GitStatus;
	config: GitConfig;
	files: GitFiles;
	contributors: GitContributors;
	branches: GitBranches;
	tags: GitTags;
}

export function OverviewTab({
	meta,
	logs,
	status,
	config,
	files,
	contributors,
	branches,
	tags,
}: OverviewTabProps) {
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
			const httpUrl = remoteUrl
				.replace(/^git@([^:]+):/, "https://$1/")
				.replace(/\.git$/, "");
			openUrlMutation.mutate({ url: httpUrl });
		}
	}, [remoteUrl, openUrlMutation]);

	const filteredConfig = INTERESTING_CONFIG_KEYS.flatMap((key) => {
		const values = config.localConfig[key];
		if (!values || values.length === 0) return [];
		return [{ key, value: values.join(", ") }];
	});

	const obj = config.objectStats;

	return (
		<div className="flex flex-col gap-6">
			{/* Repo header */}
			<div>
				<h3 className="text-lg font-semibold">{meta.repoName}</h3>
				<div className="mt-2 flex flex-wrap items-center gap-2">
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
						className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<Globe className="h-3 w-3 shrink-0" />
						<span className="truncate">{remoteUrl}</span>
					</button>
				)}
			</div>

			{/* Summary stat grid */}
			<div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
				<StatNumber label="Commits" value={formatNumber(logs.totalCommits)} />
				<StatNumber label="Merges" value={formatNumber(logs.totalMerges)} />
				<StatNumber label="Authors" value={contributors.totalAuthors} />
				<StatNumber label="Branches" value={branches.totalLocal} />
				<StatNumber label="Tags" value={tags.count} />
				<StatNumber
					label="Tracked files"
					value={formatNumber(files.trackedCount)}
				/>
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
						<span className="text-sm font-semibold font-mono tabular-nums">
							{relativeDate(logs.lastCommit.date)}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{logs.lastCommit.author}
						</span>
					</div>
				)}
			</div>

			{/* Working tree status */}
			<DashboardCard
				title="Working Tree"
				icon={<GitBranch className="h-4 w-4" />}
			>
				<div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
					<StatNumber label="Staged" value={status.staged.length} />
					<StatNumber label="Modified" value={status.modified.length} />
					<StatNumber label="Untracked" value={status.untracked.length} />
					<StatNumber label="Conflicted" value={status.conflicted.length} />
					<StatNumber label="Stashes" value={status.stashCount} />
				</div>

				{status.conflicted.length > 0 && (
					<FileList
						label="Conflicted"
						files={status.conflicted}
						className="text-red-400"
					/>
				)}
				{status.staged.length > 0 && (
					<FileList
						label="Staged"
						files={status.staged.map((s) => s.path)}
						className="text-green-400"
					/>
				)}
				{status.modified.length > 0 && (
					<FileList
						label="Modified"
						files={status.modified.map((s) => s.path)}
						className="text-yellow-400"
					/>
				)}
				{status.untracked.length > 0 && (
					<FileList
						label="Untracked"
						files={status.untracked}
						className="text-muted-foreground"
					/>
				)}
			</DashboardCard>

			{/* Config */}
			<DashboardCard title="Config" icon={<GitBranch className="h-4 w-4" />}>
				<div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
					<StatNumber
						label="Git dir"
						value={formatSize(config.gitDirSizeKiB)}
					/>
					<StatNumber label="Worktrees" value={config.worktreeCount} />
					<StatNumber label="Loose objects" value={obj.count} />
					<StatNumber label="Packed objects" value={obj.inPack} />
					<StatNumber label="Pack files" value={obj.packs} />
					<StatNumber label="Pack size" value={formatSize(obj.sizePackKiB)} />
				</div>

				{obj.garbage > 0 && (
					<div className="mb-3 rounded bg-yellow-500/15 px-2 py-1 text-xs text-yellow-400">
						⚠ {obj.garbage} garbage object{obj.garbage > 1 ? "s" : ""} (
						{formatSize(obj.sizeGarbageKiB)})
					</div>
				)}

				{config.hooks.length > 0 && (
					<div className="mb-3">
						<h4 className="mb-1 text-sm font-medium text-muted-foreground">
							Hooks
						</h4>
						<div className="flex flex-wrap gap-1">
							{config.hooks.map((hook) => (
								<span
									key={hook}
									className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
								>
									{hook}
								</span>
							))}
						</div>
					</div>
				)}

				{filteredConfig.length > 0 && (
					<div>
						<h4 className="mb-1 text-sm font-medium text-muted-foreground">
							Key config
						</h4>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="h-10 text-sm">Key</TableHead>
									<TableHead className="h-10 text-sm">Value</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredConfig.map(({ key, value }) => (
									<TableRow key={key}>
										<TableCell className="p-2 font-mono text-sm text-muted-foreground">
											{key}
										</TableCell>
										<TableCell className="p-2 text-sm">{value}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</DashboardCard>
		</div>
	);
}

/** Expandable file list for working tree status. */
function FileList({
	label,
	files,
	className,
}: {
	label: string;
	files: string[];
	className?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	if (files.length === 0) return null;

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				{expanded ? "▼" : "▶"} {label} ({files.length})
			</button>
			{expanded === true && (
				<div className="mt-1 max-h-32 overflow-y-auto pl-3">
					{files.map((f) => (
						<div
							key={f}
							className={cn("truncate font-mono text-xs", className)}
						>
							{f}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
