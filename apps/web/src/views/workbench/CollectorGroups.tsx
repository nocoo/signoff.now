import { Badge, Button } from "@nocoo/basalt";
import type { CollectorGroup } from "@signoff/domain/query";
import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	RefreshCw,
} from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { collectorSchedule, collectorTime } from "@/models/collectorSchedule";
import { JOB_STATES } from "@/models/collectorStatus";
import type { PullFilter } from "@/models/workbench";
import { useCollectorGroupsViewModel } from "@/viewmodels/useCollectorGroupsViewModel";
import { useCollectorHistoryViewModel } from "@/viewmodels/useCollectorHistoryViewModel";
import { JobButton, JobDetails } from "./CollectorJobDetails";

export function CollectorGroups({ source }: { source: PullFilter["source"] }) {
	const vm = useCollectorGroupsViewModel(source);
	return (
		<section
			aria-label="Collection jobs"
			className="flex min-h-0 min-w-0 flex-col gap-3 border-t border-basalt-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"
		>
			<div className="flex shrink-0 items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">PR refresh history</h3>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Reload collection jobs"
					disabled={vm.groups.refreshing}
					onClick={() => void vm.groups.reload()}
				>
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>
			<p className="text-xs text-basalt-muted-foreground">
				Grouped by PR and project · Completed history expires after 12 hours ·
				Active jobs are retained
			</p>
			<div
				className="min-h-64 space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto"
				aria-busy={vm.groups.refreshing}
			>
				{Boolean(vm.groups.error) && (
					<AlertBanner variant="error">{vm.groups.error}</AlertBanner>
				)}
				{Boolean(vm.groups.loading) && (
					<p role="status">Loading collection groups…</p>
				)}
				{vm.groups.data?.data.length === 0 && (
					<p className="text-sm text-basalt-muted-foreground">
						No projects or watched PRs.
					</p>
				)}
				{vm.groups.data?.data.map((group) => (
					<div
						key={group.id}
						className="rounded-basalt-md border border-basalt-border"
					>
						<GroupSummary
							group={group}
							now={vm.now}
							expanded={vm.selected === group.id}
							onClick={() => vm.select(group.id)}
						/>
						{vm.selected === group.id && (
							<GroupHistory
								key={group.id}
								group={group}
								source={source}
								now={vm.now}
							/>
						)}
					</div>
				))}
			</div>
			<div className="flex shrink-0 items-center justify-between border-t border-basalt-border pt-3 text-xs text-basalt-muted-foreground">
				<span>
					Page {vm.page} · {vm.groups.data?.data.length ?? 0} groups
				</span>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={vm.page === 1 || vm.groups.loading}
						onClick={vm.newer}
					>
						Previous groups
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!vm.groups.data?.nextCursor || vm.groups.loading}
						onClick={vm.older}
					>
						More groups
					</Button>
				</div>
			</div>
		</section>
	);
}
function GroupSummary({
	group,
	now,
	expanded,
	onClick,
}: {
	group: CollectorGroup;
	now: number;
	expanded: boolean;
	onClick: () => void;
}) {
	const job = group.latest;
	return (
		<Button
			variant="ghost"
			aria-expanded={expanded}
			onClick={onClick}
			className="h-auto w-full justify-start gap-3 p-3 text-left"
		>
			{expanded ? (
				<ChevronDown className="h-4 w-4 shrink-0" />
			) : (
				<ChevronRight className="h-4 w-4 shrink-0" />
			)}
			<div className="min-w-0 flex-1 space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="truncate text-sm font-medium">
						{group.target
							? `${group.target.repository.name} #${group.target.number}`
							: (group.repository?.name ?? group.projectName)}
					</span>
					<Badge
						variant="outline"
						className={
							job?.state === "failed" || job?.state === "auth_required"
								? "text-basalt-destructive"
								: job?.state === "partial"
									? "text-basalt-warning"
									: job?.state === "succeeded"
										? "text-basalt-heatmap-green-4"
										: ""
						}
					>
						{job ? JOB_STATES[job.state] : "Not collected"}
					</Badge>
				</div>
				<div className="flex flex-wrap justify-between gap-2 text-xs font-normal text-basalt-muted-foreground">
					<span>
						{group.kind === "discover"
							? `${group.projectName} · ${group.depth === "deep" ? "Deep discovery · 90 days" : "Smart discovery"}`
							: `${group.projectName} · Full PR refresh`}
					</span>
					<span className="tabular-nums">{collectorSchedule(group, now)}</span>
				</div>
				<div className="grid gap-x-4 gap-y-1 text-[11px] font-normal sm:grid-cols-2">
					<span>Last finished: {collectorTime(group.lastCompletedAt)}</span>
					<span>
						Next:{" "}
						{group.nextRunAt
							? collectorTime(group.nextRunAt)
							: !group.active
								? "Stopped"
								: job?.state === "running"
									? `${group.cooldownSeconds / 60} min after completion`
									: "Manual"}
					</span>
				</div>
				{job?.state === "running" && (
					<p className="truncate text-xs font-normal">
						{job.message} · {job.progress.completed}
						{job.progress.total === null
							? " collected"
							: ` / ${job.progress.total}`}
					</p>
				)}
			</div>
		</Button>
	);
}
function GroupHistory({
	group,
	source,
	now,
}: {
	group: CollectorGroup;
	source: PullFilter["source"];
	now: number;
}) {
	const vm = useCollectorHistoryViewModel(source, group.id);
	return (
		<section
			className="space-y-2 border-t border-basalt-border p-3"
			aria-label="PR job history"
		>
			{group.target !== null && (
				<a
					href={group.target.url}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-xs text-basalt-primary"
				>
					Open PR #{group.target.number}
					<ExternalLink className="h-3 w-3" />
				</a>
			)}
			{Boolean(vm.history.error) && (
				<AlertBanner variant="error">
					{vm.history.error}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void vm.history.reload()}
					>
						Retry history
					</Button>
				</AlertBanner>
			)}
			{Boolean(vm.history.loading) && (
				<p role="status" className="text-xs">
					Loading attempts…
				</p>
			)}
			{vm.history.data?.data.length === 0 && (
				<p className="text-xs">No collection attempts yet.</p>
			)}
			{vm.history.data?.data.map((job) => (
				<div key={job.id} className="space-y-1">
					<JobButton
						job={job}
						name={collectorTime(job.requestedAt)}
						selected={vm.selectedId === job.id}
						onClick={() => vm.select(vm.selectedId === job.id ? null : job.id)}
						now={now}
					/>
					{vm.selectedId === job.id && (
						<JobDetails
							job={vm.detail.data ?? job}
							now={now}
							loading={vm.detail.loading}
							error={vm.detail.error}
							retry={vm.detail.reload}
						/>
					)}
				</div>
			))}
			<div className="flex items-center justify-between text-xs">
				<span>History page {vm.page}</span>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={vm.page === 1 || vm.history.loading}
						onClick={vm.newer}
					>
						Newer
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!vm.history.data?.nextCursor || vm.history.loading}
						onClick={vm.older}
					>
						Older
					</Button>
				</div>
			</div>
		</section>
	);
}
