import { Button } from "@nocoo/basalt";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

export function CollectionToast() {
	const vm = useWorkbench();
	const [dismissed, setDismissed] = useState("");
	const jobs = vm.projects.flatMap(({ project, job }) =>
		job && ["queued", "running", "auth_required", "failed"].includes(job.state)
			? [{ project, job }]
			: [],
	);
	const signature = jobs.map(({ job }) => `${job.id}:${job.state}`).join(",");
	if (!jobs.length || dismissed === signature) return null;
	const problem = jobs.find(
		({ job }) => job.state === "auth_required" || job.state === "failed",
	);
	const listOnly = jobs.every(({ job }) => job.pullIds?.length === 0);
	const completed = jobs.reduce((sum, { job }) => sum + job.completedPulls, 0);
	const total = jobs.every(({ job }) => job.totalPulls !== null)
		? jobs.reduce((sum, { job }) => sum + (job.totalPulls ?? 0), 0)
		: null;
	const percent = total ? Math.min(100, (completed / total) * 100) : undefined;
	const Icon = problem ? CircleAlert : LoaderCircle;
	return (
		<aside
			aria-label="Collection progress"
			className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-basalt-lg border border-basalt-border bg-basalt-card p-3 shadow-lg"
		>
			<div className="flex items-start gap-2.5">
				<Icon
					aria-hidden
					className={cn(
						"mt-0.5 h-4 w-4 shrink-0",
						problem
							? "text-basalt-warning"
							: "text-basalt-primary motion-safe:animate-spin",
					)}
				/>
				<div
					role="status"
					aria-live="polite"
					className="min-w-0 flex-1 space-y-1.5"
				>
					<p className="text-xs font-semibold">
						{problem
							? problem.job.state === "auth_required"
								? "Azure login required"
								: "Collection failed"
							: listOnly
								? "Refreshing PR list…"
								: "Collecting PR checks…"}
					</p>
					{jobs.map(({ project, job }) => (
						<div
							key={job.id}
							className="flex items-center justify-between gap-2 text-[11px] text-basalt-muted-foreground"
						>
							<span
								className="truncate"
								title={`${project.organization} / ${project.projectKey}`}
							>
								{project.repositories?.length === 1
									? project.repositories[0]
									: project.projectKey}
							</span>
							<span className="shrink-0 tabular-nums">
								{job.state === "queued"
									? "Queued"
									: job.totalPulls === null
										? "Connecting…"
										: `${job.completedPulls} / ${job.totalPulls}`}
							</span>
						</div>
					))}
					{problem ? (
						<p className="break-words text-[11px] text-basalt-warning">
							{problem.job.message}
						</p>
					) : (
						<p className="text-[11px] text-basalt-muted-foreground">
							{listOnly
								? "Discovering PRs and updating counts"
								: "Policies, builds, and stages"}
						</p>
					)}
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="-mt-1 -mr-1 h-6 w-6 shrink-0"
					aria-label="Dismiss collection progress"
					onClick={() => setDismissed(signature)}
				>
					<X aria-hidden className="h-3.5 w-3.5" />
				</Button>
			</div>
			{!problem ? (
				<div
					role="progressbar"
					aria-label="PR collection"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={
						percent === undefined ? undefined : Math.round(percent)
					}
					aria-valuetext={
						total === null
							? undefined
							: `${completed} of ${total} pull requests`
					}
					className="mt-3 h-1 overflow-hidden rounded-full bg-basalt-muted"
				>
					<div
						className={cn(
							"h-full rounded-full bg-basalt-primary motion-safe:transition-[width]",
							percent === undefined && "w-1/3 motion-safe:animate-pulse",
						)}
						style={percent === undefined ? undefined : { width: `${percent}%` }}
					/>
				</div>
			) : null}
		</aside>
	);
}
