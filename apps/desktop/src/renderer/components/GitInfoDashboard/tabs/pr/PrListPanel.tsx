/**
 * PrListPanel — left panel showing the PR list in an email-thread style.
 *
 * Pure presentational: receives all data and callbacks from the ViewModel.
 * No local data state — filter values are lifted to the parent.
 */

import type { PullRequestInfo } from "@signoff/pulse";
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
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { relativeDate } from "../../StatNumber";
import { PrReviewBadge } from "./PrReviewBadge";
import { PrStateIcon } from "./PrStateIcon";

interface PrListPanelProps {
	prs: PullRequestInfo[];
	isLoading: boolean;
	isRefreshing: boolean;
	scanError: string | null;
	hasNextPage: boolean;
	stateFilter: "open" | "closed" | "all";
	onStateFilterChange: (filter: "open" | "closed" | "all") => void;
	authorFilter: string;
	onAuthorFilterChange: (filter: string) => void;
	onScan: () => void;
	onLoadMore: () => void;
	selectedPr: number | null;
	onSelectPr: (prNumber: number) => void;
}

export function PrListPanel({
	prs,
	isLoading,
	isRefreshing,
	scanError,
	hasNextPage,
	stateFilter,
	onStateFilterChange,
	authorFilter,
	onAuthorFilterChange,
	onScan,
	onLoadMore,
	selectedPr,
	onSelectPr,
}: PrListPanelProps) {
	const isScanning = isLoading || isRefreshing;

	return (
		<div className="flex h-full min-w-0 min-h-0 flex-col border-r border-border">
			{/* Header: Scan + filter bar */}
			<div className="flex min-w-0 flex-col gap-2 border-b border-border p-3">
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						onClick={onScan}
						disabled={isScanning}
						className="gap-1.5"
					>
						<RefreshCw
							className={cn("size-3.5", isScanning && "animate-spin")}
						/>
						{isScanning ? "Scanning…" : "Scan PRs"}
					</Button>
					{prs.length > 0 && (
						<span className="font-mono text-xs tabular-nums text-muted-foreground">
							{prs.length} shown
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Select
						value={stateFilter}
						onValueChange={(v) =>
							onStateFilterChange(v as "open" | "closed" | "all")
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
							onChange={(e) => onAuthorFilterChange(e.target.value)}
							placeholder="Filter by author…"
							className="h-8 pl-7 text-xs"
						/>
					</div>
				</div>

				{/* Scan error */}
				{scanError !== null && (
					<div className="flex items-start gap-1.5 rounded bg-red-500/15 px-2 py-1.5 text-xs text-red-400">
						<AlertCircle className="mt-0.5 size-3 shrink-0" />
						<span>{scanError}</span>
					</div>
				)}
			</div>

			{/* PR list */}
			<ScrollArea className="min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
				{isLoading ? (
					<div className="flex flex-col gap-2 p-3">
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
						<Skeleton className="h-16 w-full rounded-md" />
					</div>
				) : prs.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
						<p className="text-sm text-muted-foreground">
							{isRefreshing
								? "Scanning for pull requests…"
								: "Click Scan PRs to fetch pull requests"}
						</p>
					</div>
				) : (
					<div className="flex min-w-0 flex-col">
						{prs.map((pr) => (
							<PrRow
								key={pr.number}
								pr={pr}
								isSelected={selectedPr === pr.number}
								onSelect={() => onSelectPr(pr.number)}
							/>
						))}
						{hasNextPage ? (
							<div className="p-3">
								<Button
									variant="outline"
									size="sm"
									className="w-full"
									onClick={onLoadMore}
									disabled={isScanning}
								>
									{isScanning ? "Loading…" : "Load more"}
								</Button>
							</div>
						) : null}
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
				"flex w-full min-w-0 flex-col gap-1 border-b border-border px-3 py-2.5 text-left transition-colors",
				isSelected ? "bg-accent" : "hover:bg-accent/50",
			)}
		>
			{/* Row 1: state icon + title + PR number */}
			<div className="flex min-w-0 items-start gap-2">
				<PrStateIcon
					state={pr.state}
					draft={pr.draft}
					merged={pr.merged}
					className="mt-0.5 shrink-0"
				/>
				<span className="min-w-0 flex-1 truncate text-sm leading-snug">
					{pr.title}
				</span>
				<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
					#{pr.number}
				</span>
			</div>

			{/* Row 2: author · date · labels */}
			<div className="flex min-w-0 items-center gap-2 overflow-hidden pl-6 text-xs text-muted-foreground">
				<span className="shrink-0 font-medium">{pr.author}</span>
				<span>·</span>
				<span className="shrink-0">{relativeDate(pr.createdAt)}</span>
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
			<div className="flex min-w-0 items-center gap-2 overflow-hidden pl-6">
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
