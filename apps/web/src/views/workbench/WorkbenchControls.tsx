import { Badge, Button, Label } from "@nocoo/basalt";
import { FlaskConical, Radio, RefreshCw, ScanLine } from "lucide-react";
import { useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { REFRESH_INTERVALS, relativeTime } from "@/models/workbench";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

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
				Reload
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
				{vm.busy === "scan-all"
					? "Queuing…"
					: vm.filter.source === "cli"
						? "Refresh list"
						: "Scan projects"}
			</Button>
		</>
	);
}

export function WorkbenchConnection({
	vm,
	compact = false,
}: {
	vm: WorkbenchViewModel;
	compact?: boolean;
}) {
	const refreshId = useId();
	const samplesOnly = vm.filter.source === "demo";
	const connectionLabels = {
		ready: "Collector connected",
		offline: "Collector offline",
		auth_required: "Azure login required",
		error: "Collector error",
	};
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 text-xs text-basalt-muted-foreground",
				compact
					? "w-full sm:w-auto sm:flex-1"
					: "rounded-basalt-md bg-basalt-muted/40 px-3 py-2.5",
			)}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
				{samplesOnly ? (
					<>
						<Badge variant="info" className="gap-1.5">
							<FlaskConical className="h-3 w-3" aria-hidden />
							Sample data
						</Badge>
						{!compact ? (
							<span>Sample PRs · scan to simulate build progress.</span>
						) : null}
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
						{!compact ? (
							<span className="break-words">
								{vm.connection.state === "ready"
									? "All active PRs + recent merged and closed PRs."
									: vm.connection.message}
							</span>
						) : null}
					</>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<span>
					{vm.data
						? `Refreshed ${relativeTime(vm.data.fetchedAt)}`
						: "Loading snapshot…"}
				</span>
				{!samplesOnly
					? (["list", "details"] as const).map((kind) => (
							<div
								key={kind}
								className="flex items-center gap-2"
								title={
									kind === "list"
										? "Refresh PR lists after every project finishes, then wait this interval. Continues in the background."
										: "Refresh every PR on this page, then wait this interval. Pauses in the background; resumes on return."
								}
							>
								<Label
									htmlFor={`${refreshId}-${kind}`}
									className="text-xs font-normal text-basalt-muted-foreground"
								>
									{kind === "list" ? "List" : "Checks"}
								</Label>
								<SelectControl
									id={`${refreshId}-${kind}`}
									aria-label={
										kind === "list"
											? "PR list refresh cooldown"
											: "PR checks refresh cooldown"
									}
									value={String(
										kind === "list"
											? vm.listCooldownSeconds
											: vm.detailCooldownSeconds,
									)}
									disabled={vm.loading || Boolean(vm.busy)}
									onChange={(value) => {
										void vm.setRefreshCooldown(kind, Number(value));
									}}
									className="h-8 w-24 text-xs"
								>
									{REFRESH_INTERVALS.map((seconds) => (
										<option key={seconds} value={String(seconds)}>
											{seconds === 0 ? "Off" : `${seconds / 60} min`}
										</option>
									))}
								</SelectControl>
							</div>
						))
					: null}
			</div>
		</div>
	);
}

export function WorkbenchFeedback({ vm }: { vm: WorkbenchViewModel }) {
	return (
		<>
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
