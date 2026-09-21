import { Button } from "@nocoo/basalt";
import type { JobQueryItem } from "@signoff/domain/query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	JOB_STATES,
	jobDuration,
	jobOperation,
	statusColor,
} from "@/models/collectorStatus";
import { relativeTime } from "@/models/workbench";

const exactTime = (time: string | null) =>
	time ? new Date(time).toLocaleString() : "—";
const jobColor = (job: JobQueryItem) =>
	statusColor(
		job.state === "failed" || job.state === "auth_required"
			? "error"
			: job.state === "partial"
				? "warning"
				: job.state === "succeeded"
					? "success"
					: "neutral",
	);
export function JobButton({
	job,
	name,
	selected,
	onClick,
	now,
}: {
	job: JobQueryItem;
	name: string;
	selected: boolean;
	onClick: () => void;
	now: number;
}) {
	return (
		<Button
			variant="ghost"
			onClick={onClick}
			aria-expanded={selected}
			className="h-auto w-full justify-start gap-2 rounded-basalt-md border border-basalt-border/60 px-3 py-2 text-left"
		>
			{selected ? (
				<ChevronDown className="h-3 w-3 shrink-0" />
			) : (
				<ChevronRight className="h-3 w-3 shrink-0" />
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium" title={name}>
					{name}
				</p>
				<p className="mt-1 text-[11px] font-normal text-basalt-muted-foreground">
					{jobOperation(job)} · {job.progress.completed}
					{job.progress.total === null
						? " collected"
						: ` / ${job.progress.total}`}{" "}
					· {jobDuration(job, now)}
				</p>
			</div>
			<div className="shrink-0 text-right">
				<p className={cn("text-xs", jobColor(job))}>{JOB_STATES[job.state]}</p>
				<p
					className="mt-1 text-[11px] font-normal text-basalt-muted-foreground"
					title={exactTime(job.requestedAt)}
				>
					{relativeTime(Date.parse(job.requestedAt) / 1000, now)}
				</p>
			</div>
		</Button>
	);
}
export function JobDetails({
	job,
	loading,
	error,
	retry,
	now,
}: {
	job: JobQueryItem;
	loading: boolean;
	error: string | null;
	retry: () => Promise<unknown>;
	now: number;
}) {
	return (
		<div className="space-y-2 rounded-basalt-md bg-basalt-muted/40 p-3 text-xs">
			<p className="whitespace-pre-wrap break-words">
				{job.message || "No additional message."}
			</p>
			<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{[
					["Requested", exactTime(job.requestedAt)],
					["Started", exactTime(job.startedAt)],
					["Completed", exactTime(job.completedAt)],
					["Duration", jobDuration(job, now)],
				].map(([label, value]) => (
					<div key={label}>
						<dt className="text-basalt-muted-foreground">{label}</dt>
						<dd className="mt-1">{value}</dd>
					</div>
				))}
			</dl>
			{Boolean(job.error) && (
				<p className="text-basalt-destructive">Error: {job.error}</p>
			)}
			{Boolean(job.reason) && <p>Reason: {job.reason}</p>}
			{Boolean(loading) && <p role="status">Loading task details…</p>}
			{Boolean(error) && (
				<div role="alert">
					{error}
					<Button size="sm" variant="ghost" onClick={() => void retry()}>
						Retry details
					</Button>
				</div>
			)}
			{job.repositories.map((repo) => (
				<p key={repo.repository.id} className="break-words">
					{repo.repository.name} · {JOB_STATES[repo.state]}
					{repo.pullCount === null ? "" : ` · ${repo.pullCount} PRs`}
					{repo.error ? ` · ${repo.error}` : ""}
				</p>
			))}
			{Boolean(job.events?.length) && (
				<div className="space-y-1 border-t border-basalt-border pt-2">
					<h4 className="font-semibold">Collection phases</h4>
					{job.events?.map((event) => (
						<div
							key={event.id}
							className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"
						>
							<time
								className="tabular-nums text-basalt-muted-foreground"
								title={new Date(event.at * 1000).toLocaleString()}
							>
								{new Date(event.at * 1000).toLocaleTimeString()}
							</time>
							<span className="break-words">
								{event.phase} · {event.state} · {event.message}
							</span>
						</div>
					))}
				</div>
			)}
			{job.result ? (
				<div className="space-y-2 border-t border-basalt-border pt-2">
					<h4 className="font-semibold">Returned PR snapshot</h4>
					<p>
						State: {job.result.state} · Coverage: {job.result.coverage} ·{" "}
						{job.result.builds.length} builds · {job.result.policies.length}{" "}
						checks
					</p>
					{job.result.collectionIssues?.map((issue) => (
						<p key={issue} className="break-words text-basalt-warning">
							{issue}
						</p>
					))}
					{job.result.builds.map((build) => (
						<div
							key={build.id}
							className="rounded-basalt-md border border-basalt-border p-2"
						>
							<p className="font-medium">
								{build.name} #{build.number} · {build.state}
							</p>
							{build.stages.map((stage) => (
								<p
									key={stage.id}
									className="mt-1 break-words text-basalt-muted-foreground"
								>
									{stage.name} · {stage.state}
									{stage.durationSeconds === null
										? ""
										: ` · ${stage.durationSeconds}s`}
									{stage.detail ? ` · ${stage.detail}` : ""}
								</p>
							))}
						</div>
					))}
					{job.result.policies.map((policy) => (
						<p key={policy.id} className="break-words">
							{policy.name} · {policy.state}
							{policy.detail ? ` · ${policy.detail}` : ""}
						</p>
					))}
				</div>
			) : job.kind === "refresh" && !loading && !error && job.completedAt ? (
				<p className="text-basalt-muted-foreground">
					No returned snapshot was recorded for this attempt.
				</p>
			) : null}
			<p className="break-all font-mono text-[11px] text-basalt-muted-foreground">
				Task {job.id}
			</p>
		</div>
	);
}
