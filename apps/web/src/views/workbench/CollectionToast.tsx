import { Button } from "@nocoo/basalt";
import { CircleAlert, LoaderCircle, Pause, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { collectionQueueProgress } from "@/models/workbench";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

export function CollectionToast() {
	const vm = useWorkbench();
	const [dismissed, setDismissed] = useState("");
	const lanes = collectionQueueProgress(vm.data);
	const signature = `${lanes.map((lane) => `${lane.kind}:${lane.key}:${lane.problem?.message ?? ""}`).join("|")}:${vm.collectionError ?? ""}`;
	if (
		vm.filter.source !== "cli" ||
		(!lanes.length && !vm.collectionError) ||
		dismissed === signature
	)
		return null;
	const running = lanes.some(
		(lane) =>
			lane.phase === "running" && lane.problem?.state !== "auth_required",
	);
	const problem = vm.collectionError || lanes.some((lane) => lane.problem);
	const Icon = problem ? CircleAlert : running ? LoaderCircle : Pause;
	return (
		<aside
			aria-label="Collection progress"
			className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-basalt-lg border border-basalt-border bg-basalt-card p-3 shadow-lg"
		>
			<div className="flex items-center gap-2.5">
				<Icon
					aria-hidden
					className={cn(
						"h-4 w-4 shrink-0",
						problem ? "text-basalt-warning" : "text-basalt-primary",
						running && !problem && "motion-safe:animate-spin",
					)}
				/>
				<span className="flex-1 text-xs font-semibold">
					{problem
						? "Refresh needs attention"
						: running
							? "Refreshing pull requests…"
							: "PR checks paused"}
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="-my-1 -mr-1 h-6 w-6 shrink-0"
					aria-label="Dismiss collection progress"
					onClick={() => setDismissed(signature)}
				>
					<X aria-hidden className="h-3.5 w-3.5" />
				</Button>
			</div>
			<div role="status" aria-live="polite" className="mt-2.5 space-y-3">
				{lanes.map((lane) => {
					const label = lane.kind === "list" ? "PR list" : "PR checks";
					const paused = lane.phase === "off" || lane.phase === "paused";
					const percent = lane.total
						? Math.min(100, (lane.completed / lane.total) * 100)
						: undefined;
					return (
						<div key={lane.kind} className="space-y-1.5">
							<div className="flex items-center justify-between gap-2 text-[11px]">
								<span className="font-medium">{label}</span>
								<span className="tabular-nums text-basalt-muted-foreground">
									{lane.problem?.state === "auth_required"
										? "Azure login required"
										: paused
											? "Paused"
											: lane.total === null
												? "Connecting…"
												: `${lane.completed} / ${lane.total} ${lane.kind === "list" ? "projects" : "PRs"}`}
								</span>
							</div>
							<div
								role="progressbar"
								aria-label={label}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={
									percent === undefined ? undefined : Math.round(percent)
								}
								aria-valuetext={
									paused
										? "Paused"
										: lane.total === null
											? "Connecting"
											: `${lane.completed} of ${lane.total}`
								}
								className="h-1 overflow-hidden rounded-full bg-basalt-muted"
							>
								<div
									className={cn(
										"h-full rounded-full motion-safe:transition-[width]",
										paused ? "bg-basalt-muted-foreground" : "bg-basalt-primary",
										percent === undefined && "w-1/3",
										percent === undefined &&
											!paused &&
											!lane.problem &&
											"motion-safe:animate-pulse",
									)}
									style={
										percent === undefined ? undefined : { width: `${percent}%` }
									}
								/>
							</div>
							{lane.problem ? (
								<p
									className="line-clamp-2 break-words text-[11px] text-basalt-warning"
									title={lane.problem.message}
								>
									{lane.problem.message}
								</p>
							) : null}
						</div>
					);
				})}
				{vm.collectionError ? (
					<p className="break-words text-[11px] text-basalt-warning">
						{vm.collectionError}
					</p>
				) : null}
			</div>
		</aside>
	);
}
