/**
 * PrDetailPanel — right panel showing selected PR details.
 *
 * Displays:
 * - PR title + number as header
 * - Metadata grid: author, branch, dates
 * - Labels as badges
 * - Review decision
 * - Code stats (additions/deletions/changed files)
 * - Link to open in browser
 */

import type { PullRequestInfo } from "@signoff/pulse";
import { Badge } from "@signoff/ui/badge";
import { Button } from "@signoff/ui/button";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Separator } from "@signoff/ui/separator";
import { cn } from "@signoff/ui/utils";
import {
	ArrowRight,
	Calendar,
	ExternalLink,
	FileCode2,
	GitBranch,
	User,
} from "lucide-react";
import { trpc } from "../../../../lib/trpc";
import { DashboardCard } from "../../DashboardCard";
import { relativeDate } from "../../StatNumber";
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
			<div className="flex flex-col gap-4 p-4">
				{/* Header */}
				<div className="flex flex-col gap-2">
					<div className="flex items-start gap-2">
						<PrStateIcon
							state={pr.state}
							draft={pr.draft}
							merged={pr.merged}
							className="mt-1 size-5"
						/>
						<div className="flex-1">
							<h2 className="text-lg font-semibold leading-snug">{pr.title}</h2>
							<div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
								<span className="font-mono text-xs">#{pr.number}</span>
								<Badge
									variant="outline"
									className={cn(
										"text-[10px]",
										pr.merged && "border-purple-500/30 text-purple-400",
										!pr.merged &&
											pr.state === "open" &&
											"border-green-500/30 text-green-400",
										!pr.merged &&
											pr.state === "closed" &&
											"border-red-500/30 text-red-400",
									)}
								>
									{stateLabel}
								</Badge>
								<PrReviewBadge reviewDecision={pr.reviewDecision} />
							</div>
						</div>
					</div>

					<Button
						variant="outline"
						size="sm"
						className="w-fit gap-1.5"
						onClick={() => openUrlMutation.mutate({ url: pr.url })}
					>
						<ExternalLink className="size-3.5" />
						Open on GitHub
					</Button>
				</div>

				<Separator />

				{/* Metadata */}
				<DashboardCard title="Details" icon={<FileCode2 className="size-4" />}>
					<div className="grid grid-cols-2 gap-3 text-sm">
						<MetaItem
							icon={<User className="size-3.5" />}
							label="Author"
							value={pr.author}
						/>
						<MetaItem
							icon={<Calendar className="size-3.5" />}
							label="Created"
							value={relativeDate(pr.createdAt)}
						/>
						<MetaItem
							icon={<Calendar className="size-3.5" />}
							label="Updated"
							value={relativeDate(pr.updatedAt)}
						/>
						{pr.mergedAt !== null && (
							<MetaItem
								icon={<Calendar className="size-3.5" />}
								label="Merged"
								value={relativeDate(pr.mergedAt)}
							/>
						)}
						{pr.closedAt !== null && !pr.merged && (
							<MetaItem
								icon={<Calendar className="size-3.5" />}
								label="Closed"
								value={relativeDate(pr.closedAt)}
							/>
						)}
					</div>
				</DashboardCard>

				{/* Branch info */}
				<DashboardCard title="Branch" icon={<GitBranch className="size-4" />}>
					<div className="flex items-center gap-2 text-sm">
						<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{pr.headBranch}
						</code>
						<ArrowRight className="size-3.5 text-muted-foreground" />
						<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{pr.baseBranch}
						</code>
					</div>
				</DashboardCard>

				{/* Code stats */}
				<DashboardCard title="Changes" icon={<FileCode2 className="size-4" />}>
					<div className="flex items-center gap-4 text-sm">
						<span className="tabular-nums">
							<span className="font-medium text-green-400">
								+{pr.additions}
							</span>
						</span>
						<span className="tabular-nums">
							<span className="font-medium text-red-400">-{pr.deletions}</span>
						</span>
						<span className="text-muted-foreground">
							{pr.changedFiles} file{pr.changedFiles !== 1 ? "s" : ""} changed
						</span>
					</div>
				</DashboardCard>

				{/* Labels */}
				{pr.labels.length > 0 && (
					<DashboardCard
						title="Labels"
						icon={
							<Badge variant="outline" className="size-4 p-0 text-[8px]">
								#
							</Badge>
						}
					>
						<div className="flex flex-wrap gap-1.5">
							{pr.labels.map((label) => (
								<Badge key={label} variant="secondary">
									{label}
								</Badge>
							))}
						</div>
					</DashboardCard>
				)}
			</div>
		</ScrollArea>
	);
}

/** Single metadata row with icon + label + value. */
function MetaItem({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
				{icon}
				{label}
			</span>
			<span className="text-sm font-medium">{value}</span>
		</div>
	);
}
