import {
	Badge,
	Button,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Label,
} from "@nocoo/basalt";
import type { JobHistoryFilters, JobQueryItem } from "@signoff/domain/query";
import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	RefreshCw,
	X,
} from "lucide-react";
import { Fragment, useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import {
	collectorAge,
	type collectorStatus,
	JOB_STATES,
	jobDuration,
	jobOperation,
} from "@/models/collectorStatus";
import { REFRESH_INTERVALS, relativeTime } from "@/models/workbench";
import { useCollectorHistoryViewModel } from "@/viewmodels/useCollectorHistoryViewModel";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

export const statusColor = (tone: string) =>
	tone === "error"
		? "text-basalt-destructive"
		: tone === "warning"
			? "text-basalt-warning"
			: tone === "success"
				? "text-basalt-heatmap-green-4"
				: "text-basalt-muted-foreground";
const jobColor = (job: JobQueryItem) =>
	statusColor(
		job.state === "failed" || job.state === "auth_required"
			? "error"
			: job.state === "partial"
				? "warning"
				: job.state === "succeeded"
					? "success"
					: "neutral",
	);
const exactTime = (time: string | null) =>
	time ? new Date(time).toLocaleString() : "—";

export function CollectorDialog({
	vm,
	status,
	now,
}: {
	vm: WorkbenchViewModel;
	status: ReturnType<typeof collectorStatus>;
	now: number;
}) {
	const history = useCollectorHistoryViewModel(vm.filter.source);
	const collector = vm.collector;
	const projectName = (job: JobQueryItem) =>
		`${vm.projects.find(({ project }) => project.id === job.projectId)?.project.name ?? job.projectId}${job.target ? ` · ${job.target.repository.name} #${job.target.number}` : ""}`;
	const selected = (job: JobQueryItem) => (
		<JobDetails
			job={history.detail.data ?? job}
			loading={history.detail.loading}
			error={history.detail.error}
			retry={history.detail.reload}
			now={now}
		/>
	);
	return (
		<DialogContent size="xl" className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<DialogHeader>
					<DialogTitle>Collector details</DialogTitle>
					<DialogDescription>
						Connection, current work and collection history ·{" "}
						{vm.filter.source === "cli" ? "Live data" : "Sample data"}
					</DialogDescription>
				</DialogHeader>
				<DialogClose asChild>
					<Button variant="ghost" size="icon" aria-label="Close">
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Badge variant="outline" className={statusColor(status.tone)}>
						{status.label}
					</Badge>
					<span className="text-sm">{status.activity}</span>
				</div>
				<span
					className="text-xs text-basalt-muted-foreground"
					title={exactTime(collector?.connection.lastSeenAt ?? null)}
				>
					Last contact:{" "}
					{collector?.connection.lastSeenAt
						? relativeTime(
								Date.parse(collector.connection.lastSeenAt) / 1000,
								now,
							)
						: "Never"}
				</span>
			</div>
			{Boolean(status.problem) && (
				<AlertBanner variant={status.tone === "warning" ? "warning" : "error"}>
					<p className="break-words text-xs">{status.problem}</p>
					<p className="mt-1 text-xs">
						{status.tone === "warning"
							? "Some PR details are incomplete. The connector is online; see the affected tasks below."
							: "Cached PR data remains available. Review the task details for the cause."}
					</p>
				</AlertBanner>
			)}
			<dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-basalt-md border border-basalt-border p-3 sm:grid-cols-4">
				{[
					["Watching", collector?.watching ?? "—"],
					[
						"Running / queued",
						collector
							? `${collector.queue.running} / ${collector.queue.queued}`
							: "—",
					],
					["Awaiting first result", collector?.pendingFirstResult ?? "—"],
					["Overdue checks", collector?.scheduling?.overdueChecks ?? "—"],
					[
						"Oldest checks",
						collector
							? collectorAge(
									collector,
									collector.scheduling?.oldestChecksAgeSeconds,
									now,
								)
							: "—",
					],
					[
						"Oldest PR state",
						collector
							? collectorAge(
									collector,
									collector.scheduling?.oldestSummaryAgeSeconds,
									now,
								)
							: "—",
					],
					["Missing checks", collector?.scheduling?.missingChecks ?? "—"],
					[
						"State interval",
						collector?.statusCooldownSeconds
							? `${collector.statusCooldownSeconds}s`
							: "—",
					],
				].map(([label, value]) => (
					<div key={label}>
						<dt className="text-[11px] text-basalt-muted-foreground">
							{label}
						</dt>
						<dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
			<div className="grid items-center gap-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6">
				<div className="min-w-0">
					<RefreshCooldown vm={vm} />
				</div>
				<p className="text-xs text-basalt-muted-foreground">
					Checks include policies, builds and stages. PR state tracks open,
					merged and closed. Ages measure the oldest collected data, not a
					failed check.
				</p>
			</div>
			{status.issues.length > 0 && (
				<section aria-label="Current collection issues" className="space-y-2">
					<h3 className="text-sm font-semibold">
						Unresolved collection issues
					</h3>
					{status.issues.map((job) => (
						<Fragment key={job.id}>
							<JobButton
								job={job}
								name={projectName(job)}
								selected={history.selectedId === job.id}
								onClick={() =>
									history.select(history.selectedId === job.id ? null : job.id)
								}
								now={now}
							/>
							{history.selectedId === job.id && selected(job)}
						</Fragment>
					))}
				</section>
			)}
			<section aria-label="Current collection work" className="space-y-2">
				<h3 className="text-sm font-semibold">Current work</h3>
				{status.work.length ? (
					status.work.map((job) => (
						<Fragment key={job.id}>
							<JobButton
								job={job}
								name={projectName(job)}
								selected={history.selectedId === job.id}
								onClick={() =>
									history.select(history.selectedId === job.id ? null : job.id)
								}
								now={now}
							/>
							{history.selectedId === job.id && selected(job)}
						</Fragment>
					))
				) : (
					<p className="text-xs text-basalt-muted-foreground">
						{status.activity}.{" "}
						{collector?.queue.queued
							? `${collector.queue.queued} tasks queued.`
							: "No task is running."}
					</p>
				)}
			</section>
			<section
				aria-label="Collection history"
				className="space-y-2 border-t border-basalt-border pt-3"
			>
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="mr-auto text-sm font-semibold">Recent history</h3>
					<SelectControl
						aria-label="History task type"
						value={history.filters.lane}
						onChange={(lane) =>
							history.setFilters({
								...history.filters,
								lane: lane as JobHistoryFilters["lane"],
							})
						}
						className="h-8 w-32 text-xs"
					>
						<option value="all">All tasks</option>
						<option value="checks">PR checks</option>
						<option value="status">PR state</option>
						<option value="discover">Discovery</option>
					</SelectControl>
					<SelectControl
						aria-label="History result"
						value={history.filters.outcome}
						onChange={(outcome) =>
							history.setFilters({
								...history.filters,
								outcome: outcome as JobHistoryFilters["outcome"],
							})
						}
						className="h-8 w-32 text-xs"
					>
						<option value="all">All results</option>
						<option value="issues">Issues only</option>
					</SelectControl>
					<Button
						size="icon"
						variant="ghost"
						aria-label="Reload collection history"
						disabled={history.history.refreshing}
						onClick={() => void history.history.reload()}
					>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
				<p className="text-[11px] text-basalt-muted-foreground">
					Newest requested first · State history retained for 24 hours · Select
					a task for details
				</p>
				{Boolean(history.history.error) && (
					<AlertBanner variant="error">{history.history.error}</AlertBanner>
				)}
				{Boolean(history.history.loading) && (
					<p role="status" className="py-4 text-sm">
						Loading collection history…
					</p>
				)}
				{history.history.data?.data.length === 0 && (
					<p className="py-4 text-sm text-basalt-muted-foreground">
						No completed tasks match these filters.
					</p>
				)}
				<div
					className="max-h-80 space-y-1 overflow-y-auto"
					aria-busy={history.history.refreshing}
				>
					{history.history.data?.data.map((job) => (
						<div key={job.id}>
							<JobButton
								job={job}
								name={`${job.projectName}${job.target ? ` · ${job.target.repository.name} #${job.target.number}` : ""}`}
								selected={history.selectedId === job.id}
								onClick={() =>
									history.select(history.selectedId === job.id ? null : job.id)
								}
								now={now}
							/>
							{history.selectedId === job.id && (
								<>
									{job.target !== null && (
										<a
											href={job.target.url}
											target="_blank"
											rel="noreferrer"
											className="mx-3 my-2 inline-flex items-center gap-1 text-xs text-basalt-primary"
										>
											Open PR #{job.target.number}
											<ExternalLink className="h-3 w-3" />
										</a>
									)}
									{selected(job)}
								</>
							)}
						</div>
					))}
				</div>
				<div className="flex items-center justify-between text-xs text-basalt-muted-foreground">
					<span>
						Page {history.page} · {history.history.data?.data.length ?? 0} tasks
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={history.page === 1 || history.history.loading}
							onClick={history.newer}
						>
							Newer
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={
								!history.history.data?.nextCursor || history.history.loading
							}
							onClick={history.older}
						>
							Older
						</Button>
					</div>
				</div>
			</section>
		</DialogContent>
	);
}

function JobButton({
	job,
	name,
	selected,
	onClick,
	now,
}: {
	job: JobQueryItem;
	name: string;
	selected: boolean;
	onClick: () => void;
	now: number;
}) {
	return (
		<Button
			variant="ghost"
			onClick={onClick}
			aria-expanded={selected}
			className="h-auto w-full justify-start gap-2 rounded-basalt-md border border-basalt-border/60 px-3 py-2 text-left"
		>
			{selected ? (
				<ChevronDown className="h-3 w-3 shrink-0" />
			) : (
				<ChevronRight className="h-3 w-3 shrink-0" />
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium" title={name}>
					{name}
				</p>
				<p className="mt-1 text-[11px] font-normal text-basalt-muted-foreground">
					{jobOperation(job)} · {job.progress.completed}
					{job.progress.total === null
						? " collected"
						: ` / ${job.progress.total}`}{" "}
					· {jobDuration(job, now)}
				</p>
			</div>
			<div className="shrink-0 text-right">
				<p className={cn("text-xs", jobColor(job))}>{JOB_STATES[job.state]}</p>
				<p
					className="mt-1 text-[11px] font-normal text-basalt-muted-foreground"
					title={exactTime(job.requestedAt)}
				>
					{relativeTime(Date.parse(job.requestedAt) / 1000, now)}
				</p>
			</div>
		</Button>
	);
}
function JobDetails({
	job,
	loading,
	error,
	retry,
	now,
}: {
	job: JobQueryItem;
	loading: boolean;
	error: string | null;
	retry: () => Promise<unknown>;
	now: number;
}) {
	return (
		<div className="space-y-2 rounded-basalt-md bg-basalt-muted/40 p-3 text-xs">
			<p className="whitespace-pre-wrap break-words">
				{job.message || "No additional message."}
			</p>
			<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{[
					["Requested", exactTime(job.requestedAt)],
					["Started", exactTime(job.startedAt)],
					["Completed", exactTime(job.completedAt)],
					["Duration", jobDuration(job, now)],
				].map(([label, value]) => (
					<div key={label}>
						<dt className="text-basalt-muted-foreground">{label}</dt>
						<dd className="mt-1">{value}</dd>
					</div>
				))}
			</dl>
			{Boolean(job.error) && (
				<p className="text-basalt-destructive">Error: {job.error}</p>
			)}
			{Boolean(job.reason) && <p>Reason: {job.reason}</p>}
			{Boolean(loading) && <p role="status">Loading task details…</p>}
			{Boolean(error) && (
				<div role="alert">
					{error}
					<Button size="sm" variant="ghost" onClick={() => void retry()}>
						Retry details
					</Button>
				</div>
			)}
			{job.repositories.map((repo) => (
				<p key={repo.repository.id} className="break-words">
					{repo.repository.name} · {JOB_STATES[repo.state]}
					{repo.pullCount === null ? "" : ` · ${repo.pullCount} PRs`}
					{repo.error ? ` · ${repo.error}` : ""}
				</p>
			))}
			<p className="break-all font-mono text-[11px] text-basalt-muted-foreground">
				Task {job.id}
			</p>
		</div>
	);
}
export function RefreshCooldown({ vm }: { vm: WorkbenchViewModel }) {
	const intervalId = useId();
	const feedbackId = `${intervalId}-feedback`;
	const saving = vm.busy === "refresh-settings";
	const error =
		vm.feedbackKind === "refresh-settings" ? vm.mutationError : null;
	const feedback = saving
		? "Saving cooldown…"
		: error || (vm.feedbackKind === "refresh-settings" ? vm.notice : null);
	return (
		<div className="mt-1" aria-busy={saving}>
			<div
				className="flex h-6 items-center justify-between gap-2"
				title="Each watched PR becomes due independently after its last check attempt. Two checks and two status probes can run per project. Continues without an open webpage."
			>
				<Label htmlFor={intervalId} className="text-[11px] font-medium">
					Checks
				</Label>
				<SelectControl
					id={intervalId}
					aria-label="Watched PR refresh cooldown"
					aria-describedby={feedbackId}
					aria-invalid={error ? true : undefined}
					value={String(vm.detailCooldownSeconds)}
					disabled={Boolean(vm.busy) || !vm.collector}
					onChange={(value) =>
						void vm.setRefreshCooldown("details", Number(value))
					}
					className="h-6 w-[100px] shrink-0 whitespace-nowrap px-2 text-[11px] [&>svg]:h-3 [&>svg]:w-3"
					contentClassName="w-[var(--radix-select-trigger-width)] [&_[role=option]]:py-1 [&_[role=option]]:text-[11px]"
				>
					{REFRESH_INTERVALS.map((seconds) => (
						<option key={seconds} value={seconds}>
							{seconds === 0 ? "Manual" : `${seconds / 60} min`}
						</option>
					))}
				</SelectControl>
			</div>
			<p
				id={feedbackId}
				role={feedback ? (error ? "alert" : "status") : undefined}
				title={feedback || undefined}
				className={cn(
					"mt-0.5 min-h-3.5 overflow-y-auto break-words text-[11px] leading-[14px]",
					error ? "text-basalt-destructive" : "text-basalt-muted-foreground",
				)}
			>
				{feedback || "Cooldown per PR"}
			</p>
		</div>
	);
}
