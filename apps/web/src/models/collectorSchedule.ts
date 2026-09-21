import type { CollectorGroup } from "@signoff/domain/query";
import { jobDuration } from "./collectorStatus";
export const collectorTime = (value: string | null) =>
	value ? new Date(value).toLocaleString() : "—";
export const clockDuration = (seconds: number) => {
	const value = Math.max(0, Math.floor(seconds));
	return `${Math.floor(value / 60)}m ${value % 60}s`;
};
export function collectorSchedule(group: CollectorGroup, now: number) {
	if (!group.active) return "Stopped";
	const job = group.latest;
	if (job?.state === "running")
		return `Running · ${jobDuration(job, now)} elapsed`;
	if (job?.state === "auth_required")
		return group.nextRunAt
			? `Sign-in required · Retry in ${clockDuration(Date.parse(group.nextRunAt) / 1000 - now)}`
			: "Sign-in required";
	if (group.nextRunAt) {
		const seconds = Date.parse(group.nextRunAt) / 1000 - now;
		return seconds > 0
			? `Next in ${clockDuration(seconds)}`
			: job?.state === "queued"
				? `Queued · ${clockDuration(-seconds)} waiting`
				: `Due · ${clockDuration(-seconds)} overdue`;
	}
	return "Manual";
}
