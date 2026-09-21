import { Button } from "@nocoo/basalt";
import { RefreshCw, ScanLine } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { SERVICE_UNAVAILABLE } from "@/lib/api";
import { cn } from "@/lib/utils";
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
export function WorkbenchFeedback({ vm }: { vm: WorkbenchViewModel }) {
	return (
		<>
			{vm.serviceUnavailable ? (
				<AlertBanner variant="error">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<p className="font-medium">{SERVICE_UNAVAILABLE}</p>
							<p className="text-xs">
								Updates are delayed. Retrying automatically.
								{vm.pullsLoaded
									? " Showing the last loaded PR data."
									: " PR data has not loaded yet."}
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={vm.refreshing}
							onClick={() => void vm.reload()}
						>
							Retry connection
						</Button>
					</div>
				</AlertBanner>
			) : null}
			{vm.error && vm.error !== SERVICE_UNAVAILABLE ? (
				<AlertBanner variant="error">
					{vm.error}
					{vm.data
						? " Showing the last loaded data."
						: " Retry to read the cache."}
				</AlertBanner>
			) : null}
			{vm.mutationError &&
			!(vm.serviceUnavailable && vm.mutationError === SERVICE_UNAVAILABLE) &&
			vm.feedbackKind === "other" ? (
				<AlertBanner variant="error">{vm.mutationError}</AlertBanner>
			) : null}
			{vm.notice && vm.feedbackKind === "other" ? (
				<AlertBanner>{vm.notice}</AlertBanner>
			) : null}
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
