import { Badge, Button, Label, Switch } from "@nocoo/basalt";
import { FlaskConical, RefreshCw, ScanLine } from "lucide-react";
import { useId } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/models/workbench";
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
				Refresh
			</Button>
			<Button
				size="sm"
				disabled={
					!vm.data?.demoMode ||
					Boolean(vm.busy) ||
					!vm.data.projects.some((p) => p.enabled && p.source === "demo")
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
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-basalt-md bg-basalt-muted/40 px-3 py-2.5 text-xs text-basalt-muted-foreground">
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
				{vm.data?.demoMode ? (
					<>
						<Badge variant="info" className="gap-1.5">
							<FlaskConical className="h-3 w-3" aria-hidden />
							Demo workspace
						</Badge>
						<span>Sample PRs · scan to simulate build progress.</span>
					</>
				) : (
					<>
						<Badge variant="secondary">PR collection pending</Badge>
						<span>
							Project settings are saved. Live collection is coming next.
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
