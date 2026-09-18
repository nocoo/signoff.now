import { Badge, Button, Label } from "@nocoo/basalt";
import { Radio, RefreshCw, ScanLine } from "lucide-react";
import { useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { REFRESH_INTERVALS } from "@/models/workbench";
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
				Reload cache
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
				Discover PRs
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
	const id = useId();
	const labels = {
		ready: "Collector connected",
		offline: "Collector offline",
		auth_required: "Azure login required",
		error: "Collector error",
	};
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-3 text-xs text-basalt-muted-foreground",
				!compact && "rounded-basalt-md bg-basalt-muted/40 px-3 py-2.5",
			)}
		>
			<Badge
				variant={vm.connection.state === "ready" ? "success" : "warning"}
				className="gap-1.5"
				title={vm.connection.message}
			>
				<Radio className="h-3 w-3" aria-hidden />
				{labels[vm.connection.state]}
			</Badge>
			<span>{vm.collector?.watching ?? 0} watching</span>
			<div
				className="flex items-center gap-2"
				title="Refresh only the shared watch list. Wait this interval after a project's entire round finishes; continues without an open webpage."
			>
				<Label
					htmlFor={id}
					className="text-xs font-normal text-basalt-muted-foreground"
				>
					Checks
				</Label>
				<SelectControl
					id={id}
					aria-label="Watched PR refresh cooldown"
					value={String(vm.detailCooldownSeconds)}
					disabled={Boolean(vm.busy)}
					onChange={(value) =>
						void vm.setRefreshCooldown("details", Number(value))
					}
					className="h-8 w-24 text-xs"
				>
					{REFRESH_INTERVALS.map((seconds) => (
						<option key={seconds} value={seconds}>
							{seconds === 0 ? "Manual" : `${seconds / 60} min`}
						</option>
					))}
				</SelectControl>
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
						? " Showing the last loaded data."
						: " Retry to read the cache."}
				</AlertBanner>
			) : null}
			{vm.mutationError ? (
				<AlertBanner variant="error">{vm.mutationError}</AlertBanner>
			) : null}
			{vm.notice ? <AlertBanner>{vm.notice}</AlertBanner> : null}
			{vm.coverage?.state !== "complete" && vm.coverage ? (
				<p
					className="px-1 text-xs text-basalt-muted-foreground"
					title={vm.coverage.missing.join("\n")}
				>
					History coverage:{" "}
					{vm.coverage.state === "not_collected"
						? "not yet discovered"
						: "partial"}
					. Use Discover PRs to load all accessible PRs, including drafts and
					completed work.
				</p>
			) : null}
		</>
	);
}
