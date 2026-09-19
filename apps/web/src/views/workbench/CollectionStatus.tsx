import {
	Button,
	Label,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import type { JobQueryItem } from "@signoff/domain/query";
import { Activity, CircleAlert, Radio } from "lucide-react";
import { useId } from "react";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { REFRESH_INTERVALS, relativeTime } from "@/models/workbench";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

const connectionStyles = {
	ready: { label: "Online", color: "text-basalt-heatmap-green-4" },
	offline: { label: "Offline", color: "text-basalt-destructive" },
	auth_required: {
		label: "Sign-in required",
		color: "text-basalt-destructive",
	},
	error: { label: "Error", color: "text-basalt-destructive" },
	unavailable: { label: "Unavailable", color: "text-basalt-destructive" },
	connecting: { label: "Connecting", color: "text-basalt-muted-foreground" },
};

function operationLabel(
	vm: WorkbenchViewModel,
	available: boolean,
	problem: boolean,
	untilNext: number | null,
) {
	const collector = vm.collector;
	if (!collector) return "Reading status";
	if (!available) return "Collection paused";
	if (collector.queue.running > 0) {
		const runningJob = collector.jobs.find((job) => job.state === "running");
		return runningJob?.kind === "discover"
			? "Discovering PRs"
			: runningJob?.lane === "status"
				? "Checking PR state"
				: "Refreshing PR checks";
	}
	if (problem) return "Needs attention";
	if (collector.queue.queued > 0) return "Waiting to start";
	if (!collector.watching) return "Ready to watch";
	if (!vm.detailCooldownSeconds) return "Manual checks";
	if (untilNext === null) return "Waiting for next check";
	if (untilNext <= 0) return "Next check due";
	if (untilNext < 60) return "Next check in <1 min";
	return `Next check in ${Math.ceil(untilNext / 60)} min`;
}

export function CollectionStatus({
	collapsed = false,
	onExpand,
}: {
	collapsed?: boolean;
	onExpand?: () => void;
}) {
	const vm = useWorkbench();
	const now = useMinuteNow();
	const collector = vm.collector;
	const state = vm.collectionError
		? "unavailable"
		: collector
			? vm.connection.state
			: "connecting";
	const connection = connectionStyles[state];
	const jobs = collector?.jobs ?? [];
	const available =
		state === "ready" ||
		(state === "auth_required" && (collector?.queue.authRequired ?? 0) > 0);
	const running = available && (collector?.queue.running ?? 0) > 0;
	const currentJob = running
		? jobs.find((job) => job.state === "running")
		: undefined;
	const recentFailure = jobs.find(
		(job) =>
			["failed", "partial"].includes(job.state) &&
			now - Date.parse(job.updatedAt) / 1000 < 300 &&
			!jobs.some(
				(other) =>
					other.id !== job.id &&
					other.projectId === job.projectId &&
					other.kind === job.kind &&
					(other.lane ?? "checks") === (job.lane ?? "checks") &&
					other.observation?.id === job.observation?.id &&
					other.scope.join("\0") === job.scope.join("\0") &&
					other.requestedAt > job.requestedAt,
			),
	);
	const problem =
		vm.collectionError ||
		(state !== "ready" && state !== "connecting"
			? vm.connection.message
			: jobs.find((job) => job.state === "auth_required")?.message ||
				recentFailure?.message);
	const watching = collector?.watching ?? 0;
	const nextDue = collector?.scheduling?.nextCheckDueAt
		? Date.parse(collector.scheduling.nextCheckDueAt) / 1000
		: undefined;
	const untilNext = nextDue === undefined ? null : nextDue - now;
	const operation = operationLabel(vm, available, Boolean(problem), untilNext);
	let context: string | undefined;
	if (currentJob)
		context = vm.projects.find(
			({ project }) => project.id === currentJob.projectId,
		)?.project.name;
	else if (collector?.pendingFirstResult)
		context = `${collector.pendingFirstResult} awaiting first result`;
	else if (!watching && state === "ready")
		context = "Add PRs to start monitoring";
	const Icon = problem ? CircleAlert : running ? Activity : Radio;
	const icon = (
		<Icon
			aria-hidden
			strokeWidth={1.5}
			className={cn(
				"h-4 w-4 shrink-0",
				problem ? "text-basalt-destructive" : connection.color,
				running && !problem && "motion-safe:animate-pulse",
			)}
		/>
	);
	const summary = `Connector ${connection.label.toLowerCase()}. ${operation}. ${watching} watching`;
	if (collapsed)
		return (
			<section
				aria-label="Connector status"
				className="flex justify-center pb-3"
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="rounded-basalt-md"
							onClick={onExpand}
							aria-label={`${summary}. Expand sidebar for details`}
						>
							{icon}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right" className="max-w-64">
						{summary}
						{problem ? <p className="mt-1">{problem}</p> : null}
					</TooltipContent>
				</Tooltip>
			</section>
		);
	const progress = currentJob?.progress;
	return (
		<section
			aria-label="Connector status"
			className="mb-3 min-w-0 border-t border-basalt-border/70 pt-3"
		>
			<div className="flex h-4 items-center gap-2">
				{icon}
				<span className="flex-1 text-[11px] font-semibold">Connector</span>
				<span
					className={cn(
						"flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium",
						connection.color,
					)}
					title={vm.connection.message}
				>
					<span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
					{connection.label}
				</span>
			</div>
			<div className="mt-1 flex h-3 items-center justify-between gap-2 font-mono text-[9px] leading-3 text-basalt-muted-foreground">
				<span className="truncate uppercase tracking-wider">
					{vm.filter.source === "cli" ? "Live" : "Sample"}
					{collector?.statusCooldownSeconds
						? ` · State ${collector.statusCooldownSeconds}s`
						: ""}
				</span>
				{collector?.connection.lastSeenAt ? (
					<span
						className="whitespace-nowrap"
						title={`Last contact: ${new Date(collector.connection.lastSeenAt).toLocaleString()}`}
					>
						Contact{" "}
						{relativeTime(
							Date.parse(collector.connection.lastSeenAt) / 1000,
							now,
						)}
					</span>
				) : null}
			</div>
			<dl className="my-1 flex h-4 items-center justify-between gap-2">
				{[
					["Watching", collector?.watching],
					["Running", collector?.queue.running],
					["Queued", collector?.queue.queued],
				].map(([label, count]) => (
					<div key={label} className="flex min-w-0 items-baseline gap-1">
						<dt className="text-[10px] text-basalt-muted-foreground">
							{label}
						</dt>
						<dd className="order-first font-mono text-xs font-medium tabular-nums">
							{count ?? "—"}
						</dd>
					</div>
				))}
			</dl>
			<div className="mt-1 flex h-4 items-center gap-2">
				<p
					role="status"
					title={operation}
					className={cn(
						"min-w-0 flex-1 truncate text-[11px] font-medium leading-4",
						problem && "text-basalt-destructive",
					)}
				>
					{operation}
				</p>
				{progress ? (
					<TaskProgress progress={progress} label={operation} />
				) : null}
			</div>
			<div className="mt-0.5 h-7 overflow-y-auto break-words text-[10px] leading-[14px]">
				{problem ? (
					<p className="text-basalt-destructive" title={problem}>
						{problem}
					</p>
				) : null}
				{context ? (
					<p className="truncate text-basalt-muted-foreground" title={context}>
						{context}
					</p>
				) : null}
				<OldestChecks collector={collector} now={now} />
			</div>
			<RefreshCooldown vm={vm} />
		</section>
	);
}

function TaskProgress({
	progress: { completed, total },
	label,
}: {
	progress: JobQueryItem["progress"];
	label: string;
}) {
	return (
		<div className="flex w-20 shrink-0 items-center gap-1.5">
			<div
				role="progressbar"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={total ?? undefined}
				aria-valuenow={total === null ? undefined : Math.min(completed, total)}
				className="h-1 min-w-4 flex-1 overflow-hidden rounded-full bg-basalt-muted"
			>
				<div
					className={cn(
						"h-full rounded-full bg-basalt-heatmap-green-3 transition-[width] motion-reduce:transition-none",
						total === null && "w-1/3 motion-safe:animate-pulse",
					)}
					style={
						total === null
							? undefined
							: {
									width: `${Math.min(100, (100 * completed) / Math.max(1, total))}%`,
								}
					}
				/>
			</div>
			<p className="truncate font-mono text-[9px] leading-4 tabular-nums text-basalt-muted-foreground">
				{completed}
				{total === null ? " collected" : ` / ${total}`}
			</p>
		</div>
	);
}

function RefreshCooldown({ vm }: { vm: WorkbenchViewModel }) {
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
				<Label htmlFor={intervalId} className="text-[10px] font-medium">
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
					"mt-0.5 h-3.5 overflow-y-auto break-words text-[10px] leading-[14px]",
					error ? "text-basalt-destructive" : "text-basalt-muted-foreground",
				)}
			>
				{feedback || "Cooldown per PR"}
			</p>
		</div>
	);
}

function OldestChecks({
	collector,
	now,
}: {
	collector: WorkbenchViewModel["collector"];
	now: number;
}) {
	const scheduling = collector?.watching ? collector.scheduling : undefined;
	return (
		<p
			className="h-3.5 truncate text-[10px] leading-[14px] text-basalt-muted-foreground"
			title="Age of the oldest successfully collected checks among active watches"
		>
			Oldest checks:{" "}
			{!scheduling
				? "—"
				: scheduling.oldestChecksAgeSeconds === null
					? "not collected"
					: relativeTime(now - scheduling.oldestChecksAgeSeconds, now)}
			{scheduling?.missingChecks
				? ` · ${scheduling.missingChecks} missing`
				: ""}
		</p>
	);
}
