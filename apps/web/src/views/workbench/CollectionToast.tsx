import { Button } from "@nocoo/basalt";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

export function CollectionToast() {
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
	return (
		<aside
			aria-label="Collection progress"
			className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-basalt-lg border border-basalt-border bg-basalt-card p-3 shadow-lg"
		>
			<div className="flex items-center gap-2.5">
				{problem ? (
					<CircleAlert
						aria-hidden
						className="h-4 w-4 shrink-0 text-basalt-warning"
					/>
				) : (
					<LoaderCircle
						aria-hidden
						className="h-4 w-4 shrink-0 text-basalt-primary motion-safe:animate-spin"
					/>
				)}
				<span className="flex-1 text-xs font-semibold">
					{problem ? "Collection needs attention" : "Collecting PR data"}
				</span>
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
				className="mt-2 space-y-2 text-[11px] text-basalt-muted-foreground"
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
		</aside>
	);
}
