import { type AiReadiness, readinessBadge } from "@signoff/domain/ai-readiness";
import type { loadAiSchedule } from "./aiScheduleApi";

export type AiSchedule = Awaited<ReturnType<typeof loadAiSchedule>>;

export function readinessDisplay(
	readiness: AiReadiness,
	pullId: string,
	schedule: AiSchedule | null,
	now: number,
) {
	const updating = ["pending", "running", "error"].includes(readiness.status);
	const previous = updating ? readiness.previous : null;
	const badge = readinessBadge(readiness);
	if (!updating) return { badge, note: null, detail: "" };
	const history = previous
		? `Last Jev result: ${new Date(previous.evaluatedAt).toLocaleString()}. This result has not been verified against the latest evidence or instructions.`
		: "No Jev result is available yet.";
	const prefix = previous ? "Last result · " : "Jev · ";
	const explain = (note: string, detail: string) => ({
		badge,
		note: `${prefix}${note}`,
		detail: `${history} ${detail}`,
	});
	if (readiness.status === "error")
		return explain(
			"failed",
			readiness.error ?? "Evaluation failed. Check AI Settings and retry.",
		);
	if (readiness.status === "running")
		return explain("updating…", "Jev is evaluating the latest evidence.");
	if (!schedule)
		return explain("queued", "The next evaluation time is unavailable.");
	const next = schedule.pulls.find((p) => p.id === pullId)?.nextEligibleAt;
	const eta = next && next > now ? next : null;
	const timing = eta
		? `Earliest Jev request: ${new Date(eta * 1000).toLocaleString()}.`
		: "The PR cooldown has elapsed; waiting for the next available evaluation.";
	return explain(
		eta ? `~${Math.ceil((eta - now) / 60)}m` : "queued",
		`New evidence or instructions await evaluation. ${timing} Timing depends on daemon availability and queued work; this is not a completion estimate.`,
	);
}
