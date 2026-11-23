import {
	Button,
	Dialog,
	DialogTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import {
	Activity,
	ChevronRight,
	CircleAlert,
	Radio,
} from "@nocoo/basalt/icons";
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
			size={collapsed ? "icon" : "md"}
			aria-label={summary}
			className={cn(
				collapsed
					? "rounded-basalt-md"
					: "group h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-basalt-md px-1.5 py-1.5 text-left",
			)}
		>
			{collapsed ? (
				<Icon
					aria-hidden
					className={cn("h-4 w-4 shrink-0", statusColor(status.tone))}
				/>
			) : (
				<>
					<div className="flex w-full items-center justify-between gap-2 text-[11px] leading-4">
						<span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-basalt-foreground">
							<Icon
								aria-hidden
								className={cn("h-3.5 w-3.5 shrink-0", statusColor(status.tone))}
							/>
							<span className="truncate">Connector</span>
						</span>
						<span className="inline-flex shrink-0 items-center gap-1">
							<span className={cn("font-medium", statusColor(status.tone))}>
								{status.label}
							</span>
							<ChevronRight
								aria-hidden
								className="h-3.5 w-3.5 text-basalt-muted-foreground transition-transform group-hover:translate-x-0.5"
							/>
						</span>
					</div>
					<div className="flex w-full items-center justify-between gap-2 text-[11px] leading-4 text-basalt-muted-foreground">
						<p className="min-w-0 truncate font-normal" role="status">
							{vm.collectionError
								? "Status unknown · View details"
								: status.problem
									? `${status.issues.length || 1} ${status.tone === "warning" ? "incomplete" : "issue(s)"} · View details`
									: status.activity}
						</p>
						<span className="shrink-0 font-normal tabular-nums">
							{vm.filter.source === "cli" ? "Live" : "Sample"} ·{" "}
							{vm.collector?.watching ?? "—"} watching
							{!vm.collectionError && vm.collector?.queue.running
								? ` · ${vm.collector.queue.running} running`
								: ""}
						</span>
					</div>
				</>
			)}
		</Button>
	);
	return (
		<section
			aria-label="Connector status"
			className={cn(collapsed && "flex justify-center")}
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
