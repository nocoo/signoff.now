import {
	Button,
	Dialog,
	DialogTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { Activity, ChevronRight, CircleAlert, Radio } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { collectorStatus, statusColor } from "@/models/collectorStatus";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { CollectorDialog } from "./CollectorDialog";

export function CollectionStatus({
	collapsed = false,
}: {
	collapsed?: boolean;
}) {
	const vm = useWorkbench();
	const now = useMinuteNow();
	const [open, setOpen] = useState(false);
	const status = collectorStatus(vm.collector, vm.collectionError, now);
	const Icon = status.problem
		? CircleAlert
		: status.running.length
			? Activity
			: Radio;
	const summary = `Connector ${status.label.toLowerCase()}. ${status.activity}. Open details and history`;
	const trigger = (
		<Button
			variant="ghost"
			size={collapsed ? "icon" : "default"}
			aria-label={summary}
			className={cn(
				"rounded-basalt-md",
				!collapsed && "h-auto w-full justify-start gap-2 px-2 py-2 text-left",
			)}
		>
			<Icon
				aria-hidden
				className={cn("h-4 w-4 shrink-0", statusColor(status.tone))}
			/>
			{!collapsed && (
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center justify-between gap-2 text-[11px]">
						<span className="font-semibold">Connector</span>
						<span className={statusColor(status.tone)}>{status.label}</span>
					</div>
					<p
						className="truncate text-[11px] font-normal text-basalt-muted-foreground"
						role="status"
					>
						{status.problem
							? `${status.issues.length || 1} ${status.tone === "warning" ? "incomplete" : "issue(s)"} · View details`
							: status.activity}
					</p>
					<p className="flex items-center justify-between text-[11px] font-normal text-basalt-muted-foreground">
						<span>
							{vm.filter.source === "cli" ? "Live" : "Sample"} ·{" "}
							{vm.collector?.watching ?? "—"} watching
							{vm.collector?.queue.running
								? ` · ${vm.collector.queue.running} running`
								: ""}
						</span>
						<ChevronRight aria-hidden className="h-3 w-3" />
					</p>
				</div>
			)}
		</Button>
	);
	return (
		<section
			aria-label="Connector status"
			className={cn(
				"mb-2 border-t border-basalt-border/70 pt-2",
				collapsed && "flex justify-center",
			)}
		>
			<Dialog open={open} onOpenChange={setOpen}>
				{collapsed ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<DialogTrigger asChild>{trigger}</DialogTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">
							{status.label} · {status.activity}
						</TooltipContent>
					</Tooltip>
				) : (
					<DialogTrigger asChild>{trigger}</DialogTrigger>
				)}
				{Boolean(open) && (
					<CollectorDialog
						key={vm.filter.source}
						vm={vm}
						status={status}
						now={now}
					/>
				)}
			</Dialog>
		</section>
	);
}
