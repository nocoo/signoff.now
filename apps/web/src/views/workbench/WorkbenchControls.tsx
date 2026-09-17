import { Badge, Button, Label, SegmentControl, Switch } from "@nocoo/basalt";
import { FlaskConical, Radio, RefreshCw, ScanLine } from "lucide-react";
import { useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { cn } from "@/lib/utils";
import { type PullFilter, relativeTime } from "@/models/workbench";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

export function SourceControl({ vm }: { vm: WorkbenchViewModel }) {
	return (
		<SegmentControl
			legend="Data source"
			className="[&>legend]:sr-only [&_[data-slot=segment-control-viewport]]:overflow-visible [&_[data-slot=segment-control-viewport]]:pb-0"
			value={vm.filter.source}
			onValueChange={(source) =>
				vm.setFilter({ source: source as PullFilter["source"] })
			}
			options={[
				{ value: "cli", label: "Live" },
				{ value: "demo", label: "Sample" },
			]}
		/>
	);
}

export function ScanControls({ vm }: { vm: WorkbenchViewModel }) {
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={vm.refreshing || Boolean(vm.busy)}
				onClick={() => void vm.reload()}
				aria-label="Refresh snapshot"
			>
				<RefreshCw
					aria-hidden
					className={cn("h-4 w-4", vm.refreshing && "motion-safe:animate-spin")}
				/>
				Refresh
			</Button>
			<Button
				size="sm"
				disabled={
					Boolean(vm.busy) ||
					!vm.projects.some(({ project }) => vm.canScan(project))
				}
				onClick={() => void vm.scan()}
			>
				<ScanLine aria-hidden className="h-4 w-4" />
				{vm.busy === "scan-all" ? "Scanning…" : "Scan projects"}
			</Button>
		</>
	);
}

export function WorkbenchConnection({ vm }: { vm: WorkbenchViewModel }) {
	const refreshId = useId();
	const samplesOnly = vm.filter.source === "demo";
	const connectionLabels = {
		ready: "Collector connected",
		offline: "Collector offline",
		auth_required: "Azure login required",
		error: "Collector error",
	};
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-basalt-md bg-basalt-muted/40 px-3 py-2.5 text-xs text-basalt-muted-foreground">
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
				{samplesOnly ? (
					<>
						<Badge variant="info" className="gap-1.5">
							<FlaskConical className="h-3 w-3" aria-hidden />
							Sample data
						</Badge>
						<span>Sample PRs · scan to simulate build progress.</span>
					</>
				) : (
					<>
						<Badge
							variant={vm.connection.state === "ready" ? "success" : "warning"}
							className="gap-1.5"
						>
							<Radio className="h-3 w-3" aria-hidden />
							{connectionLabels[vm.connection.state]}
						</Badge>
						<span className="break-words">
							{vm.connection.state === "ready"
								? "All active PRs + recent merged and closed PRs."
								: vm.connection.message}
						</span>
					</>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<span>
					{vm.data
						? `Refreshed ${relativeTime(vm.data.fetchedAt)}`
						: "Loading snapshot…"}
				</span>
				<div className="flex items-center gap-2">
					<Switch
						id={refreshId}
						size="sm"
						checked={vm.autoRefresh}
						onCheckedChange={vm.setAutoRefresh}
					/>
					<Label
						htmlFor={refreshId}
						className="text-xs font-normal text-basalt-muted-foreground"
					>
						Auto refresh · 15s
					</Label>
				</div>
			</div>
		</div>
	);
}

export function WorkbenchFeedback({ vm }: { vm: WorkbenchViewModel }) {
	const activeJobs = vm.projects.filter(
		({ job }) =>
			job &&
			["queued", "running", "auth_required", "failed"].includes(job.state),
	);
	return (
		<>
			{activeJobs.map(({ project, job }) =>
				job ? (
					<AlertBanner
						key={job.id}
						variant={
							job.state === "auth_required" || job.state === "failed"
								? "warning"
								: "info"
						}
					>
						<span className="font-medium">{project.name}</span>
						{" · "}
						{job.state === "running"
							? `Collecting ${job.completedPulls}${job.totalPulls === null ? "" : ` / ${job.totalPulls}`} PRs`
							: job.state === "queued"
								? "Queued for collection"
								: job.state === "auth_required"
									? "Waiting for Azure login"
									: "Collection failed"}
						{job.message ? ` · ${job.message}` : ""}
					</AlertBanner>
				) : null,
			)}
			{vm.error ? (
				<AlertBanner variant="error">
					{vm.error}
					{vm.data
						? " Showing the last loaded snapshot."
						: " Refresh to try again."}
				</AlertBanner>
			) : null}
			{vm.mutationError ? (
				<AlertBanner variant="error">{vm.mutationError}</AlertBanner>
			) : null}
			{vm.notice ? <AlertBanner>{vm.notice}</AlertBanner> : null}
			{vm.data?.truncated ? (
				<AlertBanner variant="warning">
					Showing the latest 1,000 PRs. Counts reflect this snapshot and may
					omit older PRs.
				</AlertBanner>
			) : null}
		</>
	);
}
