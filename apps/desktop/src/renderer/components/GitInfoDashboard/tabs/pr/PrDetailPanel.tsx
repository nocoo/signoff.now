/**
 * PrDetailPanel — right panel showing selected PR details.
 *
 * Accepts a full PrDetail (list + detail fields) from the ViewModel,
 * with loading/refreshing/error states for the detail fetch.
 *
 * Follows the dashboard's visual conventions:
 * - StatNumber for label/value pairs
 * - DashboardCard for grouped sections
 * - Semantic badge colors: bg-{color}-500/15 text-{color}-400
 * - Standard spacing: gap-6 between sections, p-3 card padding
 */

import type { PrDetail } from "@signoff/pulse";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Skeleton } from "@signoff/ui/skeleton";
import { cn } from "@signoff/ui/utils";
import {
	AlertCircle,
	ArrowRight,
	ExternalLink,
	FileText,
	GitBranch,
	GitCommit,
	Globe,
	MessageSquare,
	RefreshCw,
	Shield,
	Tag,
	Users,
} from "lucide-react";
import { trpc } from "../../../../lib/trpc";
import { DashboardCard } from "../../DashboardCard";
import { relativeDate, StatNumber } from "../../StatNumber";
import { PrReviewBadge } from "./PrReviewBadge";
import { PrStateIcon } from "./PrStateIcon";

interface PrDetailPanelProps {
	/** Full PR detail (list + detail fields). null = no cache yet. */
	detail: PrDetail | null;
	/** True when a PR is selected (distinguishes "no selection" from "load failed"). */
	hasSelection: boolean;
	/** True when loading detail for a PR with no cache. */
	isLoading: boolean;
	/** True when refreshing an already-cached detail. */
	isRefreshing: boolean;
	/** Error message from detail fetch, if any. */
	error: string | null;
}

export function PrDetailPanel({
	detail,
	hasSelection,
	isLoading,
	isRefreshing,
	error,
}: PrDetailPanelProps) {
	const openUrlMutation = trpc.external.openUrl.useMutation();

	// No PR selected — only when nothing is selected at all
	if (!hasSelection) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">Select a pull request to view details</p>
			</div>
		);
	}

	// Error with no cached detail — show centered error message
	if (!detail && !isLoading && error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6">
				<div className="flex items-start gap-1.5 rounded bg-red-500/15 px-3 py-2 text-sm text-red-400">
					<AlertCircle className="mt-0.5 size-4 shrink-0" />
					<span>{error}</span>
				</div>
			</div>
		);
	}

	// Loading skeleton (or waiting for detail to arrive — detail=null, no error yet)
	if (isLoading || !detail) {
		return (
			<div className="flex flex-col gap-6 p-6">
				<Skeleton className="h-8 w-3/4 rounded" />
				<Skeleton className="h-4 w-1/2 rounded" />
				<div className="grid grid-cols-3 gap-4">
					<Skeleton className="h-12 rounded" />
					<Skeleton className="h-12 rounded" />
					<Skeleton className="h-12 rounded" />
				</div>
				<Skeleton className="h-24 rounded" />
				<Skeleton className="h-32 rounded" />
			</div>
		);
	}

	// detail is guaranteed non-null here (guarded by early returns above)
	const pr = detail;

	const stateLabel = pr.merged
		? "Merged"
		: pr.draft
			? "Draft"
			: pr.state === "open"
				? "Open"
				: "Closed";

	const mergeableLabel =
		pr.mergeable === "MERGEABLE"
			? "Mergeable"
			: pr.mergeable === "CONFLICTING"
				? "Conflicting"
				: "Unknown";

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-6 p-6">
				{/* Refreshing indicator */}
				{isRefreshing ? (
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<RefreshCw className="size-3 animate-spin" />
						<span>Refreshing…</span>
					</div>
				) : null}

				{/* Error */}
				{error ? (
					<div className="flex items-start gap-1.5 rounded bg-red-500/15 px-2 py-1.5 text-xs text-red-400">
						<AlertCircle className="mt-0.5 size-3 shrink-0" />
						<span>{error}</span>
					</div>
				) : null}

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
						<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
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

					{/* Remote link */}
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

				{/* Summary stat grid */}
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

				{/* Merge status */}
				<DashboardCard
					title="Merge Status"
					icon={<Shield className="h-4 w-4" />}
				>
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={cn(
								"rounded px-2 py-0.5 text-xs font-medium",
								pr.mergeable === "MERGEABLE" &&
									"bg-green-500/15 text-green-400",
								pr.mergeable === "CONFLICTING" && "bg-red-500/15 text-red-400",
								pr.mergeable === "UNKNOWN" &&
									"bg-yellow-500/15 text-yellow-400",
							)}
						>
							{mergeableLabel}
						</span>
						<span className="text-xs text-muted-foreground">
							{pr.mergeStateStatus}
						</span>
						{pr.mergedBy ? (
							<span className="text-xs text-muted-foreground">
								Merged by {pr.mergedBy}
							</span>
						) : null}
					</div>
				</DashboardCard>

				{/* Branch + Changes card */}
				<DashboardCard
					title="Branch & Changes"
					icon={<GitBranch className="h-4 w-4" />}
				>
					<div className="mb-3 flex items-center gap-2 text-sm">
						<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
							{pr.headBranch}
						</span>
						<ArrowRight className="size-3.5 text-muted-foreground" />
						<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
							{pr.baseBranch}
						</span>
					</div>
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

				{/* Description */}
				{pr.body ? (
					<DashboardCard
						title="Description"
						icon={<FileText className="h-4 w-4" />}
					>
						<pre className="whitespace-pre-wrap text-xs text-muted-foreground">
							{pr.body}
						</pre>
					</DashboardCard>
				) : null}

				{/* Participants */}
				{(pr.participants.length > 0 ||
					pr.requestedReviewers.length > 0 ||
					pr.assignees.length > 0) && (
					<DashboardCard
						title="Participants"
						icon={<Users className="h-4 w-4" />}
					>
						<div className="flex flex-col gap-2">
							{pr.assignees.length > 0 && (
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Assignees:{" "}
									</span>
									<span className="text-xs">{pr.assignees.join(", ")}</span>
								</div>
							)}
							{pr.requestedReviewers.length > 0 && (
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Reviewers:{" "}
									</span>
									<span className="text-xs">
										{pr.requestedReviewers.join(", ")}
									</span>
								</div>
							)}
							{pr.participants.length > 0 && (
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Participants:{" "}
									</span>
									<span className="text-xs">{pr.participants.join(", ")}</span>
								</div>
							)}
						</div>
					</DashboardCard>
				)}

				{/* Reviews */}
				{pr.reviews.length > 0 && (
					<DashboardCard
						title={`Reviews (${pr.reviews.length})`}
						icon={<MessageSquare className="h-4 w-4" />}
					>
						<div className="flex flex-col gap-2">
							{pr.reviews.map((review, i) => (
								<div
									key={`${review.author}-${review.submittedAt ?? i}`}
									className="flex flex-col gap-0.5 rounded bg-muted/50 p-2"
								>
									<div className="flex items-center gap-2">
										<span className="text-xs font-medium">{review.author}</span>
										<span
											className={cn(
												"rounded px-1.5 py-0.5 text-[10px] font-medium",
												review.state === "APPROVED" &&
													"bg-green-500/15 text-green-400",
												review.state === "CHANGES_REQUESTED" &&
													"bg-red-500/15 text-red-400",
												review.state === "COMMENTED" &&
													"bg-blue-500/15 text-blue-400",
												review.state === "DISMISSED" &&
													"bg-yellow-500/15 text-yellow-400",
												review.state === "PENDING" &&
													"bg-muted text-muted-foreground",
											)}
										>
											{review.state}
										</span>
										{review.submittedAt ? (
											<span className="text-[10px] text-muted-foreground">
												{relativeDate(review.submittedAt)}
											</span>
										) : null}
									</div>
									{review.body ? (
										<p className="text-xs text-muted-foreground">
											{review.body.slice(0, 200)}
											{review.body.length > 200 ? "…" : null}
										</p>
									) : null}
								</div>
							))}
						</div>
					</DashboardCard>
				)}

				{/* Comments */}
				{pr.comments.length > 0 && (
					<DashboardCard
						title={`Comments (${pr.comments.length})`}
						icon={<MessageSquare className="h-4 w-4" />}
					>
						<div className="flex flex-col gap-2">
							{pr.comments.map((comment, i) => (
								<div
									key={`${comment.author}-${comment.createdAt}-${i}`}
									className="flex flex-col gap-0.5 rounded bg-muted/50 p-2"
								>
									<div className="flex items-center gap-2">
										<span className="text-xs font-medium">
											{comment.author}
										</span>
										<span className="text-[10px] text-muted-foreground">
											{relativeDate(comment.createdAt)}
										</span>
									</div>
									{comment.body ? (
										<p className="text-xs text-muted-foreground">
											{comment.body.slice(0, 300)}
											{comment.body.length > 300 ? "…" : null}
										</p>
									) : null}
								</div>
							))}
						</div>
					</DashboardCard>
				)}

				{/* Commits */}
				{pr.commits.length > 0 && (
					<DashboardCard
						title={`Commits (${pr.commits.length})`}
						icon={<GitCommit className="h-4 w-4" />}
					>
						<div className="flex flex-col gap-1.5">
							{pr.commits.map((commit) => (
								<div
									key={commit.oid}
									className="flex items-start gap-2 text-xs"
								>
									<span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
										{commit.oid}
									</span>
									<span className="flex-1 text-muted-foreground">
										{commit.message.split("\n")[0]}
									</span>
									{commit.statusCheckRollup ? (
										<span
											className={cn(
												"shrink-0 text-[10px]",
												commit.statusCheckRollup === "SUCCESS" &&
													"text-green-400",
												commit.statusCheckRollup === "FAILURE" &&
													"text-red-400",
												commit.statusCheckRollup === "PENDING" &&
													"text-yellow-400",
											)}
										>
											{commit.statusCheckRollup}
										</span>
									) : null}
								</div>
							))}
						</div>
					</DashboardCard>
				)}

				{/* Changed files */}
				{pr.files.length > 0 && (
					<DashboardCard
						title={`Files (${pr.files.length})`}
						icon={<FileText className="h-4 w-4" />}
					>
						<div className="flex flex-col gap-1">
							{pr.files.map((file) => (
								<div
									key={file.path}
									className="flex items-center gap-2 text-xs"
								>
									<span
										className={cn(
											"w-14 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-medium",
											file.changeType === "ADDED" &&
												"bg-green-500/15 text-green-400",
											file.changeType === "MODIFIED" &&
												"bg-blue-500/15 text-blue-400",
											file.changeType === "DELETED" &&
												"bg-red-500/15 text-red-400",
											file.changeType === "RENAMED" &&
												"bg-yellow-500/15 text-yellow-400",
											(file.changeType === "COPIED" ||
												file.changeType === "CHANGED") &&
												"bg-muted text-muted-foreground",
										)}
									>
										{file.changeType}
									</span>
									<span className="flex-1 truncate font-mono text-muted-foreground">
										{file.path}
									</span>
									<span className="shrink-0 font-mono tabular-nums text-muted-foreground">
										<span className="text-green-400">+{file.additions}</span>
										{" / "}
										<span className="text-red-400">-{file.deletions}</span>
									</span>
								</div>
							))}
						</div>
					</DashboardCard>
				)}

				{/* Labels */}
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
