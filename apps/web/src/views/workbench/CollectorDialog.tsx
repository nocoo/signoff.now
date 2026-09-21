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
import { X } from "lucide-react";
import { useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import {
	collectorAge,
	type collectorStatus,
	statusColor,
} from "@/models/collectorStatus";
import { REFRESH_INTERVALS, relativeTime } from "@/models/workbench";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";
import { AiScheduleSettings } from "./AiScheduleSettings";
import { CollectorGroups } from "./CollectorGroups";

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
	const collector = vm.collector;
	return (
		<DialogContent
			size="xl"
			className="flex h-[88dvh] flex-col gap-4 overflow-hidden sm:w-[76rem]"
		>
			<div className="flex shrink-0 items-start justify-between gap-3">
				<DialogHeader>
					<DialogTitle>Collector details</DialogTitle>
					<DialogDescription>
						Connection and collection jobs ·{" "}
						{vm.filter.source === "cli" ? "Live data" : "Sample data"}
					</DialogDescription>
				</DialogHeader>
				<DialogClose asChild>
					<Button variant="ghost" size="icon" aria-label="Close">
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>
			</div>
			<div className="grid min-h-0 flex-1 auto-rows-max gap-5 overflow-y-auto md:auto-rows-fr md:grid-cols-[19rem_minmax(0,1fr)] md:overflow-hidden">
				<section
					aria-label="Collector metadata"
					className="min-w-0 space-y-4 md:overflow-y-auto md:pr-4"
				>
					<h3 className="text-sm font-semibold">Overview</h3>
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline" className={statusColor(status.tone)}>
								{status.label}
							</Badge>
							<span className="text-sm">{status.activity}</span>
						</div>
						<span
							className="block text-xs text-basalt-muted-foreground"
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
						<AlertBanner
							variant={status.tone === "warning" ? "warning" : "error"}
						>
							<p className="break-words text-xs">{status.problem}</p>
							<p className="mt-1 text-xs">
								{status.tone === "warning"
									? "Some PR details are incomplete. The connector is online; see the affected jobs."
									: "Cached PR data remains available. Review the task details for the cause."}
							</p>
						</AlertBanner>
					)}
					<dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-basalt-md border border-basalt-border p-3">
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
						].map(([label, value]) => (
							<div key={label}>
								<dt className="text-[11px] text-basalt-muted-foreground">
									{label}
								</dt>
								<dd className="mt-1 text-sm font-medium tabular-nums">
									{value}
								</dd>
							</div>
						))}
					</dl>
					<div className="space-y-3">
						<div className="min-w-0">
							<RefreshCooldown vm={vm} />
						</div>
						<p className="text-xs text-basalt-muted-foreground">
							Project lists refresh PR states in batches. Watched PRs collect
							state, policies, builds and stages in full. Each cooldown starts
							after the entire task finishes.
						</p>
					</div>
					<AiScheduleSettings source={vm.filter.source} now={now} />
				</section>
				<CollectorGroups key={vm.filter.source} source={vm.filter.source} />
			</div>
		</DialogContent>
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
			<h3 className="mb-3 text-sm font-semibold">Collection cooldowns</h3>
			{(
				[
					{
						kind: "list",
						label: "Project PR lists",
						value: vm.listCooldownSeconds,
					},
					{
						kind: "details",
						label: "Watched PRs",
						value: vm.detailCooldownSeconds,
					},
				] as const
			).map((setting) => (
				<div
					key={setting.kind}
					className="mb-3 flex items-center justify-between gap-3"
				>
					<Label htmlFor={`${intervalId}-${setting.kind}`} className="text-xs">
						{setting.label}
					</Label>
					<SelectControl
						id={`${intervalId}-${setting.kind}`}
						aria-label={
							setting.kind === "list"
								? "Project discovery cooldown"
								: "Watched PR refresh cooldown"
						}
						aria-describedby={feedbackId}
						aria-invalid={Boolean(error)}
						value={String(setting.value)}
						disabled={Boolean(vm.busy) || !vm.collector}
						onChange={(value) =>
							void vm.setRefreshCooldown(setting.kind, Number(value))
						}
						className="h-8 w-28 text-xs"
					>
						{REFRESH_INTERVALS.map((seconds) => (
							<option key={seconds} value={seconds}>
								{seconds === 0 ? "Manual" : `${seconds / 60} min`}
							</option>
						))}
					</SelectControl>
				</div>
			))}
			<p
				id={feedbackId}
				role={feedback ? (error ? "alert" : "status") : undefined}
				title={feedback || undefined}
				className={cn(
					"mt-0.5 min-h-3.5 overflow-y-auto break-words text-[11px] leading-[14px]",
					error ? "text-basalt-destructive" : "text-basalt-muted-foreground",
				)}
			>
				{feedback || "Per project / per PR · Starts after completion"}
			</p>
		</div>
	);
}
