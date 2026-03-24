/**
 * PrListPanel — left panel showing the PR list in an email-thread style.
 *
 * Follows the dashboard's visual conventions:
 * - text-xs / text-sm sizing (no text-[11px] or text-[9px])
 * - Semantic badges: rounded bg-{color}-500/15 text-{color}-400
 * - Neutral badges: rounded bg-muted px-1.5 py-0.5 text-[10px]
 * - font-mono tabular-nums for numbers
 * - text-muted-foreground for secondary content
 */

import type { PrsReport, PullRequestInfo } from "@signoff/pulse";
import { Button } from "@signoff/ui/button";
import { Input } from "@signoff/ui/input";
import { ScrollArea } from "@signoff/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@signoff/ui/select";
import { Skeleton } from "@signoff/ui/skeleton";
import { cn } from "@signoff/ui/utils";
import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { trpc } from "../../../../lib/trpc";
import { relativeDate } from "../../StatNumber";
import { PrReviewBadge } from "./PrReviewBadge";
import { PrStateIcon } from "./PrStateIcon";

interface PrListPanelProps {
	projectId: string;
	selectedPr: number | null;
	onSelectPr: (prNumber: number) => void;
}

export function PrListPanel({
	projectId,
	selectedPr,
	onSelectPr,
}: PrListPanelProps) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);
	const [authorFilter, setAuthorFilter] = useState("");

	// Fetch cached report on mount
	const { data: cachedReport, refetch: refetchCached } =
		trpc.pulse.getCachedReport.useQuery({ projectId });

	// Scan mutation
	const scanMutation = trpc.pulse.fetchPrs.useMutation({
		onSuccess: () => {
			refetchCached();
		},
	});

	const handleScan = () => {
		scanMutation.mutate({
			projectId,
			state: stateFilter,
			author: authorFilter.trim() || null,
		});
	};

	const report: PrsReport | null = scanMutation.data ?? cachedReport ?? null;
	const isScanning = scanMutation.isPending;

	// Client-side author filter for cached results
	const filteredPrs =
		report?.prs.filter((pr) => {
			if (
				authorFilter.trim() &&
				!pr.author.toLowerCase().includes(authorFilter.toLowerCase())
			) {
				return false;
			}
			return true;
		}) ?? [];

	return (
		<div className="flex h-full flex-col border-r border-border">
			{/* Header: Scan + filter bar */}
			<div className="flex flex-col gap-2 border-b border-border p-3">
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						onClick={handleScan}
						disabled={isScanning}
						className="gap-1.5"
					>
						<RefreshCw
							className={cn("size-3.5", isScanning && "animate-spin")}
						/>
						{isScanning ? "Scanning…" : "Scan PRs"}
					</Button>
					{report !== null && (
						<span className="text-xs text-muted-foreground font-mono tabular-nums">
							{report.totalCount} total
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Select
						value={stateFilter}
						onValueChange={(v) =>
							setStateFilter(v as "open" | "closed" | "all")
						}
					>
						<SelectTrigger size="sm" className="w-24">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="open">Open</SelectItem>
							<SelectItem value="closed">Closed</SelectItem>
							<SelectItem value="all">All</SelectItem>
						</SelectContent>
					</Select>
					<div className="relative flex-1">
						<Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={authorFilter}
							onChange={(e) => setAuthorFilter(e.target.value)}
							placeholder="Filter by author…"
							className="h-8 pl-7 text-xs"
						/>
					</div>
				</div>
			</div>

			{/* PR list */}
			<ScrollArea className="flex-1">
				{isScanning && !report ? (
					<div className="flex flex-col gap-2 p-3">
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
					</div>
				) : filteredPrs.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
						<p className="text-sm text-muted-foreground">
							{report
								? "No pull requests match the current filters"
								: "Click Scan PRs to fetch pull requests"}
						</p>
					</div>
				) : (
					<div className="flex flex-col">
						{filteredPrs.map((pr) => (
							<PrRow
								key={pr.number}
								pr={pr}
								isSelected={selectedPr === pr.number}
								onSelect={() => onSelectPr(pr.number)}
							/>
						))}
					</div>
				)}
			</ScrollArea>
		</div>
	);
}

/** Single PR row in the email-style list. */
function PrRow({
	pr,
	isSelected,
	onSelect,
}: {
	pr: PullRequestInfo;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left transition-colors",
				isSelected ? "bg-accent" : "hover:bg-accent/50",
			)}
		>
			{/* Row 1: state icon + title + PR number */}
			<div className="flex items-start gap-2">
				<PrStateIcon
					state={pr.state}
					draft={pr.draft}
					merged={pr.merged}
					className="mt-0.5"
				/>
				<span
					className={cn(
						"flex-1 text-sm leading-snug",
						isSelected && "font-medium",
					)}
				>
					{pr.title}
				</span>
				<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
					#{pr.number}
				</span>
			</div>

			{/* Row 2: author · date · labels */}
			<div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
				<span className="font-medium">{pr.author}</span>
				<span>·</span>
				<span>{relativeDate(pr.createdAt)}</span>
				{pr.labels.length > 0 && (
					<>
						<span>·</span>
						<div className="flex items-center gap-1">
							{pr.labels.slice(0, 3).map((label) => (
								<span
									key={label}
									className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
								>
									{label}
								</span>
							))}
							{pr.labels.length > 3 && (
								<span className="text-[10px]">+{pr.labels.length - 3}</span>
							)}
						</div>
					</>
				)}
			</div>

			{/* Row 3: review badge + diff stats */}
			<div className="flex items-center gap-2 pl-6">
				<PrReviewBadge reviewDecision={pr.reviewDecision} />
				<span className="font-mono text-xs tabular-nums text-muted-foreground">
					<span className="text-green-400">+{pr.additions}</span>
					{" / "}
					<span className="text-red-400">-{pr.deletions}</span>
				</span>
			</div>
		</button>
	);
}
