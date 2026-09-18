import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

export function CollectionStatus({
	collapsed = false,
	onExpand,
}: {
	collapsed?: boolean;
	onExpand?: () => void;
}) {
	const vm = useWorkbench();
	const [dismissed, setDismissed] = useState("");
	const jobs = vm.collector?.jobs ?? [];
	const active = jobs.filter((job) =>
		["queued", "running", "auth_required"].includes(job.state),
	);
	const errors = jobs.filter(
		(job) =>
			["failed", "partial"].includes(job.state) &&
			Date.now() - Date.parse(job.updatedAt) < 300000 &&
			!jobs.some(
				(other) =>
					other.id !== job.id &&
					other.projectId === job.projectId &&
					other.kind === job.kind &&
					other.requestedAt > job.requestedAt,
			),
	);
	const signature = `${vm.filter.source}:${active.map((j) => `${j.id}:${j.state}`).join(",")}:${errors.map((j) => j.id).join(",")}:${vm.collectionError ?? ""}`;
	if (
		(!active.length && !errors.length && !vm.collectionError) ||
		dismissed === signature
	)
		return null;
	const problem =
		vm.collectionError ||
		active.find((j) => j.state === "auth_required")?.message ||
		errors[0]?.message;
	const title = problem ? "Collection needs attention" : "Collecting PR data";
	const icon = problem ? (
		<CircleAlert aria-hidden className="h-4 w-4 shrink-0 text-basalt-warning" />
	) : (
		<LoaderCircle
			aria-hidden
			className="h-4 w-4 shrink-0 text-basalt-primary motion-safe:animate-spin"
		/>
	);
	if (collapsed)
		return (
			<section
				aria-label="Collection progress"
				className="flex justify-center pb-2"
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							onClick={onExpand}
							aria-label={`${title}. Expand sidebar for details`}
						>
							{icon}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">{title}</TooltipContent>
				</Tooltip>
			</section>
		);
	return (
		<section
			aria-label="Collection progress"
			className="mb-2 min-w-0 rounded-basalt-lg border border-basalt-border bg-basalt-card/60 p-3"
		>
			<div className="flex items-center gap-2.5">
				{icon}
				<span className="flex-1 text-xs font-semibold">{title}</span>
				<Button
					variant="ghost"
					size="icon"
					className="-my-1 -mr-1 h-6 w-6"
					aria-label="Dismiss collection progress"
					onClick={() => setDismissed(signature)}
				>
					<X aria-hidden className="h-3.5 w-3.5" />
				</Button>
			</div>
			<div
				role="status"
				aria-live="polite"
				className="mt-2 max-h-36 space-y-2 overflow-y-auto text-[11px] text-basalt-muted-foreground"
			>
				{active.length ? (
					<p>
						{vm.collector?.queue.running ?? 0} running ·{" "}
						{vm.collector?.queue.queued ?? 0} queued ·{" "}
						{vm.collector?.watching ?? 0} watched PRs
					</p>
				) : null}
				{active
					.filter((job) => job.state === "running")
					.map((job) => (
						<div key={job.id} className="space-y-1">
							<p>
								{job.kind === "discover"
									? "Discovering PRs"
									: "Refreshing watched PR"}{" "}
								· {job.progress.completed}
								{job.progress.total === null
									? " collected"
									: ` / ${job.progress.total}`}
							</p>
							<div className="h-1 overflow-hidden rounded-full bg-basalt-muted">
								<div
									className={cn(
										"h-full rounded-full bg-basalt-primary",
										job.progress.total === null &&
											"w-1/3 motion-safe:animate-pulse",
									)}
									style={
										job.progress.total === null
											? undefined
											: {
													width: `${Math.min(100, (100 * job.progress.completed) / Math.max(1, job.progress.total))}%`,
												}
									}
								/>
							</div>
						</div>
					))}
				{problem ? (
					<p className="break-words text-basalt-warning">{problem}</p>
				) : null}
			</div>
		</section>
	);
}
