import type { JobQueryItem } from "@signoff/domain/query";
import type { loadCollector } from "./monitoringApi";
import { relativeTime } from "./workbench";

export type CollectorSnapshot = Awaited<ReturnType<typeof loadCollector>>;
export const JOB_STATES = {
	queued: "Queued",
	running: "Running",
	auth_required: "Sign-in required",
	succeeded: "Succeeded",
	partial: "Incomplete",
	failed: "Failed",
	canceled: "Canceled",
};
export function jobOperation(job: Pick<JobQueryItem, "kind" | "lane">) {
	return job.kind === "discover"
		? "PR discovery"
		: job.lane === "status"
			? "PR state"
			: "PR checks";
}
export function jobDuration(job: JobQueryItem, now: number) {
	if (!job.startedAt) return "Not started";
	const seconds = Math.max(
		0,
		Math.floor(
			(job.completedAt ? Date.parse(job.completedAt) / 1000 : now) -
				Date.parse(job.startedAt) / 1000,
		),
	);
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function collectorAge(
	collector: CollectorSnapshot,
	age: number | null | undefined,
	now: number,
) {
	return age === null || age === undefined
		? "Not collected"
		: relativeTime(Date.parse(collector.generatedAt) / 1000 - age, now);
}
export function collectorStatus(
	collector: CollectorSnapshot | null,
	error: string | null,
	now: number,
) {
	const state = error
		? "unavailable"
		: (collector?.connection.state ?? "connecting");
	const jobs = collector?.jobs ?? [];
	const issues = jobs.filter(
		(job) =>
			["failed", "partial", "auth_required"].includes(job.state) &&
			!jobs.some(
				(other) =>
					other.id !== job.id &&
					other.projectId === job.projectId &&
					other.kind === job.kind &&
					(other.lane ?? "checks") === (job.lane ?? "checks") &&
					other.observation?.id === job.observation?.id &&
					other.scope.join("\0") === job.scope.join("\0") &&
					other.requestedAt > job.requestedAt,
			),
	);
	const running = jobs.filter((job) => job.state === "running");
	const blocked = !["ready", "connecting"].includes(state);
	const failed = issues.some((job) => job.state !== "partial");
	const label = {
		unavailable: "Unavailable",
		connecting: "Connecting",
		offline: "Offline",
		auth_required: "Sign-in required",
		error: "Connection error",
		ready: failed
			? "Collection failed"
			: issues.length
				? "Partial data"
				: "Online",
	}[state];
	const tone =
		blocked || failed
			? "error"
			: issues.length
				? "warning"
				: state === "ready"
					? "success"
					: "neutral";
	const problem =
		error ||
		(blocked ? collector?.connection.message : issues[0]?.message) ||
		null;
	const canRun =
		state === "ready" ||
		(state === "auth_required" && (collector?.queue.authRequired ?? 0) > 0);
	const activity = collectorActivity(collector, canRun, running, now);
	return {
		state,
		label,
		tone,
		problem,
		activity,
		issues,
		work: canRun
			? jobs.filter((job) => job.state === "running" || job.state === "queued")
			: [],
		running: canRun ? running : [],
	};
}

function collectorActivity(
	collector: CollectorSnapshot | null,
	canRun: boolean,
	running: JobQueryItem[],
	now: number,
) {
	const due = collector?.scheduling?.nextCheckDueAt;
	const until = due ? Date.parse(due) / 1000 - now : null;
	let activity = "Reading status";
	if (collector) {
		if (!canRun) activity = "Collection paused";
		else if (running.length)
			activity =
				running[0]?.kind === "discover"
					? "Discovering PRs"
					: running[0]?.lane === "status"
						? "Checking PR state"
						: "Refreshing PR checks";
		else if (collector.queue.queued) activity = "Waiting to start";
		else if (!collector.watching) activity = "Ready to watch";
		else if (!collector.detailCooldownSeconds) activity = "Manual checks";
		else if (until === null) activity = "Waiting for next check";
		else if (until <= 0) activity = "Next check due";
		else
			activity =
				until < 60
					? "Next check in <1 min"
					: `Next check in ${Math.ceil(until / 60)} min`;
	}
	return activity;
}
