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

import type { PullRequestDetail } from "@signoff/pulse";
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
	GitFork,
	Globe,
	MessageSquare,
	Milestone,
	RefreshCw,
	Shield,
	Tag,
	Users,
} from "lucide-react";
import { useMemo } from "react";
import { trpc } from "../../../../lib/trpc";
import { DashboardCard } from "../../DashboardCard";
import { relativeDate, StatNumber } from "../../StatNumber";
import { CommitRow } from "./CommitRow";
import { GhLink } from "./GhLink";
import { GitHubUrlProvider } from "./GitHubUrlProvider";
import { type GitHubUrlContext, parseGitHubPrUrl } from "./github-urls";
import { PrReviewBadge } from "./PrReviewBadge";
import { PrStateIcon } from "./PrStateIcon";
import { ReviewCard } from "./ReviewCard";

interface PrDetailPanelProps {
	/** Full PR detail (list + detail fields). null = no cache yet. */
	detail: PullRequestDetail | null;
	/** True when a PR is selected (distinguishes "no selection" from "load failed"). */
	hasSelection: boolean;
	/** True when loading detail for a PR with no cache. */
	isLoading: boolean;
	/** True when refreshing an already-cached detail. */
	isRefreshing: boolean;
	/** Error message from detail fetch, if any. */
	error: string | null;
}

/** Humanize GitHub's SCREAMING_CASE mergeStateStatus to title-case. */
const MERGE_STATE_LABELS: Record<string, string> = {
	BEHIND: "Behind",
	BLOCKED: "Blocked",
	CLEAN: "Clean",
	DIRTY: "Dirty",
	DRAFT: "Draft",
	HAS_HOOKS: "Has hooks",
	UNKNOWN: "Unknown",
	UNSTABLE: "Unstable",
};

function humanizeMergeStateStatus(raw: string): string {
	return MERGE_STATE_LABELS[raw] ?? raw;
}

export function PrDetailPanel({
	detail,
	hasSelection,
	isLoading,
	isRefreshing,
	error,
}: PrDetailPanelProps) {
	const openUrlMutation = trpc.external.openUrl.useMutation();

	// Build GitHub URL context from the PR's url field (supports GHE).
	// Must be called before any early return to satisfy hook ordering rules.
	const ghCtx = useMemo((): GitHubUrlContext | null => {
		if (!detail) return null;
		const parsed = parseGitHubPrUrl(detail.url);
		if (!parsed) return null;
		return {
			...parsed,
			headRefOid: detail.headRefOid,
			baseRefOid: detail.baseRefOid,
		};
	}, [detail]);

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
		: pr.isDraft
			? "Draft"
			: pr.state === "OPEN"
				? "Open"
				: "Closed";

	const mergeableLabel =
		pr.mergeable === "MERGEABLE"
			? "Mergeable"
			: pr.mergeable === "CONFLICTING"
				? "Conflicting"
				: "Unknown";

	const content = (
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
				<div className="min-w-0">
					<div className="flex min-w-0 items-start gap-2">
						<PrStateIcon
							state={pr.state}
							isDraft={pr.isDraft}
							merged={pr.merged}
							className="mt-1 size-5 shrink-0"
						/>
						<h3 className="min-w-0 text-lg font-semibold leading-snug">
							{pr.title}
						</h3>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<GhLink
							target={{ type: "pr", number: pr.number }}
							className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
						>
							#{pr.number}
						</GhLink>
						<span
							className={cn(
								"rounded px-2 py-0.5 text-xs font-medium",
								pr.merged && "bg-purple-500/15 text-purple-400",
								!pr.merged &&
									pr.state === "OPEN" &&
									"bg-green-500/15 text-green-400",
								!pr.merged &&
									pr.state === "CLOSED" &&
									"bg-red-500/15 text-red-400",
							)}
						>
							{stateLabel}
						</span>
						<PrReviewBadge reviewDecision={pr.reviewDecision} />
						{pr.isCrossRepository ? (
							<span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
								<GitFork className="size-3" />
								Fork
							</span>
						) : null}
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
					<StatNumber
						label="Author"
						value={
							<GhLink
								target={{ type: "user", login: pr.author }}
								className="text-sm font-semibold"
							>
								{pr.author}
							</GhLink>
						}
					/>
					<StatNumber label="Created" value={relativeDate(pr.createdAt)} />
					<StatNumber label="Updated" value={relativeDate(pr.updatedAt)} />
					{pr.mergedAt !== null && (
						<StatNumber label="Merged" value={relativeDate(pr.mergedAt)} />
					)}
					{pr.closedAt !== null && !pr.merged && (
						<StatNumber label="Closed" value={relativeDate(pr.closedAt)} />
					)}
					<StatNumber label="Changed files" value={pr.changedFiles} />
					{pr.totalCommentsCount > 0 && (
						<StatNumber label="Comments" value={pr.totalCommentsCount} />
					)}
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
							{humanizeMergeStateStatus(pr.mergeStateStatus)}
						</span>
						{pr.mergedBy ? (
							<span className="text-xs text-muted-foreground">
								Merged by{" "}
								<GhLink target={{ type: "user", login: pr.mergedBy }}>
									{pr.mergedBy}
								</GhLink>
							</span>
						) : null}
					</div>
				</DashboardCard>

				{/* Branch + Changes card */}
				<DashboardCard
					title="Branch & Changes"
					icon={<GitBranch className="h-4 w-4" />}
				>
					<div className="mb-1 flex min-w-0 items-center gap-2 text-sm">
						<GhLink
							target={{ type: "branch", name: pr.headRefName }}
							className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
						>
							{pr.headRefName}
						</GhLink>
						<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
						<GhLink
							target={{ type: "branch", name: pr.baseRefName }}
							className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
						>
							{pr.baseRefName}
						</GhLink>
					</div>
					<div className="mb-3 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
						<GhLink target={{ type: "commit", sha: pr.headRefOid }}>
							<span title={pr.headRefOid}>{pr.headRefOid.slice(0, 7)}</span>
						</GhLink>
						<ArrowRight className="size-2.5 shrink-0" />
						<GhLink target={{ type: "commit", sha: pr.baseRefOid }}>
							<span title={pr.baseRefOid}>{pr.baseRefOid.slice(0, 7)}</span>
						</GhLink>
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
					pr.reviewRequests.length > 0 ||
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
									<span className="text-xs">
										{pr.assignees.map((login, i) => (
											<span key={login}>
												{i > 0 && ", "}
												<GhLink target={{ type: "user", login }}>
													{login}
												</GhLink>
											</span>
										))}
									</span>
								</div>
							)}
							{pr.reviewRequests.length > 0 && (
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Reviewers:{" "}
									</span>
									<span className="text-xs">
										{pr.reviewRequests.join(", ")}
									</span>
								</div>
							)}
							{pr.participants.length > 0 && (
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Participants:{" "}
									</span>
									<span className="text-xs">
										{pr.participants.map((login, i) => (
											<span key={login}>
												{i > 0 && ", "}
												<GhLink target={{ type: "user", login }}>
													{login}
												</GhLink>
											</span>
										))}
									</span>
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
								<ReviewCard
									key={`${review.author}-${review.submittedAt ?? i}`}
									review={review}
								/>
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
										<GhLink
											target={{ type: "user", login: comment.author }}
											className="text-xs font-medium"
										>
											{comment.author}
										</GhLink>
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
								<CommitRow key={commit.abbreviatedOid} commit={commit} />
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

				{/* Milestone */}
				{pr.milestone ? (
					<DashboardCard
						title="Milestone"
						icon={<Milestone className="h-4 w-4" />}
					>
						<span className="text-xs">{pr.milestone}</span>
					</DashboardCard>
				) : null}
			</div>
		</ScrollArea>
	);

	// Wrap in GitHubUrlProvider when context is available
	if (ghCtx) {
		return <GitHubUrlProvider value={ghCtx}>{content}</GitHubUrlProvider>;
	}
	return content;
}
