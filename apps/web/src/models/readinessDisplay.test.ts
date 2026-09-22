import {
	type AiReadiness,
	presentReadiness,
} from "@signoff/domain/ai-readiness";
import { expect, it } from "vitest";
import { type AiSchedule, readinessDisplay } from "./readinessDisplay";

const now = 1_800_000_000;
const previous: NonNullable<AiReadiness["previous"]> = {
	kind: "ready",
	model: "jev-1.13.0",
	rubric: "test",
	fingerprint: "old-evidence",
	evaluatedAt: new Date((now - 300) * 1000).toISOString(),
	reusedAt: null,
	confidence: 1,
	probabilities: { ready: 1 },
};
const schedule: AiSchedule = {
	revision: 1,
	cooldownSeconds: 300,
	pulls: [{ id: "pull", nextEligibleAt: now + 120 }],

	projects: [
		{
			id: "project",
			name: "Project",
			lastStartedAt: now - 200,
			lastCompletedAt: now - 180,
			requestCount: 2,
			inputTokens: null,
			outputTokens: null,
		},
	],
};
const pending = presentReadiness("pending", null, null, previous);
const display = (readiness = pending, plan: AiSchedule | null = schedule) =>
	readinessDisplay(readiness, "pull", plan, now);

it("keeps the last judgment explicitly historical while new evidence waits for that PR's ETA", () => {
	const result = display();
	expect(result.badge.kind).toBe("ready");
	expect(result.note).toBe("Last result · ~2m");
	expect(result.detail).toContain("has not been verified against the latest");
	expect(result.detail).toContain("not a completion estimate");
	expect(pending.status).toBe("pending");
	expect(pending.current).toBeNull();
	expect(readinessDisplay(pending, "another-pull", schedule, now).note).toBe(
		"Last result · queued",
	);
	expect(readinessDisplay(pending, "pull", schedule, now + 120).note).toBe(
		"Last result · queued",
	);
});

it("preserves prior judgments during inference and errors, without inventing a result on first evaluation", () => {
	expect(display(presentReadiness("running", null, null, previous)).note).toBe(
		"Last result · updating…",
	);
	const error = display(presentReadiness("error", null, "HTTP 402", previous));
	expect(error.badge.kind).toBe("ready");
	expect(error.note).toBe("Last result · failed");
	expect(error.detail).toContain("HTTP 402");
	expect(display(presentReadiness("error")).detail).toContain(
		"Check AI Settings",
	);
	const first = display(presentReadiness("pending"));
	expect(first.badge.label).toBe("Pending");
	expect(first.note).toBe("Jev · ~2m");
	expect(first.detail).toContain("No Jev result");
});

it("replaces history on completion, respects direct conflicts and hides stopped-watch history", () => {
	const completed = presentReadiness("complete", {
		...previous,
		kind: "attention",
	});
	expect(display(completed)).toEqual({
		badge: completed,
		note: null,
		detail: "",
	});
	const conflict = { ...completed, kind: "conflict" as const, previous };
	expect(display(conflict).badge.kind).toBe("conflict");
	const stopped = presentReadiness("not_watched", null, null, previous);
	expect(display(stopped)).toEqual({ badge: stopped, note: null, detail: "" });
});

it("shows daemon scheduling and unavailable timing honestly", () => {
	expect(display().detail).toContain("daemon availability");
	expect(display(pending, null).detail).toContain("time is unavailable");
	const first = {
		...schedule,
		pulls: [{ id: "pull", nextEligibleAt: null }],
	};
	expect(display(pending, first).note).toBe("Last result · queued");
});
