/**
 * PrDetailPanel — right panel showing selected PR details.
 *
 * Follows the dashboard's visual conventions:
 * - StatNumber for label/value pairs
 * - DashboardCard for grouped sections
 * - Semantic badge colors: bg-{color}-500/15 text-{color}-400
 * - Standard spacing: gap-6 between sections, p-3 card padding
 */

import type { PullRequestInfo } from "@signoff/pulse";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { cn } from "@signoff/ui/utils";
import { ArrowRight, ExternalLink, GitBranch, Globe, Tag } from "lucide-react";
import { trpc } from "../../../../lib/trpc";
import { DashboardCard } from "../../DashboardCard";
import { relativeDate, StatNumber } from "../../StatNumber";
import { PrReviewBadge } from "./PrReviewBadge";
import { PrStateIcon } from "./PrStateIcon";

interface PrDetailPanelProps {
	pr: PullRequestInfo | null;
}

export function PrDetailPanel({ pr }: PrDetailPanelProps) {
	const openUrlMutation = trpc.external.openUrl.useMutation();

	if (!pr) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">Select a pull request to view details</p>
			</div>
		);
	}

	const stateLabel = pr.merged
		? "Merged"
		: pr.draft
			? "Draft"
			: pr.state === "open"
				? "Open"
				: "Closed";

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-6 p-6">
				{/* Header: title + badges + remote link */}
				<div>
					<div className="flex items-start gap-2">
						<PrStateIcon
							state={pr.state}
							draft={pr.draft}
							merged={pr.merged}
							className="mt-1 size-5"
						/>
						<h3 className="text-lg font-semibold leading-snug">{pr.title}</h3>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							#{pr.number}
						</span>
						<span
							className={cn(
								"rounded px-2 py-0.5 text-xs font-medium",
								pr.merged && "bg-purple-500/15 text-purple-400",
								!pr.merged &&
									pr.state === "open" &&
									"bg-green-500/15 text-green-400",
								!pr.merged &&
									pr.state === "closed" &&
									"bg-red-500/15 text-red-400",
							)}
						>
							{stateLabel}
						</span>
						<PrReviewBadge reviewDecision={pr.reviewDecision} />
					</div>

					{/* Remote link — matches OverviewTab's remote URL style */}
					<button
						type="button"
						onClick={() => openUrlMutation.mutate({ url: pr.url })}
						className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<Globe className="h-3 w-3 shrink-0" />
						<span className="truncate">Open on GitHub</span>
						<ExternalLink className="h-3 w-3 shrink-0" />
					</button>
				</div>

				{/* Summary stat grid — matches OverviewTab's grid layout */}
				<div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
					<StatNumber label="Author" value={pr.author} />
					<StatNumber label="Created" value={relativeDate(pr.createdAt)} />
					<StatNumber label="Updated" value={relativeDate(pr.updatedAt)} />
					{pr.mergedAt !== null && (
						<StatNumber label="Merged" value={relativeDate(pr.mergedAt)} />
					)}
					{pr.closedAt !== null && !pr.merged && (
						<StatNumber label="Closed" value={relativeDate(pr.closedAt)} />
					)}
					<StatNumber label="Changed files" value={pr.changedFiles} />
				</div>

				{/* Branch + Changes card */}
				<DashboardCard
					title="Branch & Changes"
					icon={<GitBranch className="h-4 w-4" />}
				>
					{/* Branch flow */}
					<div className="mb-3 flex items-center gap-2 text-sm">
						<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{pr.headBranch}
						</span>
						<ArrowRight className="size-3.5 text-muted-foreground" />
						<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{pr.baseBranch}
						</span>
					</div>

					{/* Code stats — matches diff stat pattern: green +N / red -N */}
					<div className="grid grid-cols-3 gap-3">
						<StatNumber
							label="Additions"
							value={`+${pr.additions}`}
							className="[&>span:last-child]:text-green-400"
						/>
						<StatNumber
							label="Deletions"
							value={`-${pr.deletions}`}
							className="[&>span:last-child]:text-red-400"
						/>
						<StatNumber label="Files" value={pr.changedFiles} />
					</div>
				</DashboardCard>

				{/* Labels — uses neutral badge style from OverviewTab hooks */}
				{pr.labels.length > 0 && (
					<DashboardCard title="Labels" icon={<Tag className="h-4 w-4" />}>
						<div className="flex flex-wrap gap-1">
							{pr.labels.map((label) => (
								<span
									key={label}
									className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
								>
									{label}
								</span>
							))}
						</div>
					</DashboardCard>
				)}
			</div>
		</ScrollArea>
	);
}
