import type { CollectorGroup } from "@signoff/domain/query";
import { expect, test } from "vitest";
import {
	fixtureJob as baseJob,
	fixtureNow,
	iso,
} from "@/test/monitoring-fixture";
import {
	clockDuration,
	collectorSchedule,
	collectorTime,
} from "./collectorSchedule";

const fixtureJob = (overrides: Parameters<typeof baseJob>[0]) => ({
	...baseJob(overrides),
	projectName: "Test",
	target: null,
});
const group: CollectorGroup = {
	id: "pr:test",
	kind: "refresh",
	projectId: "test",
	projectName: "Test",
	target: null,
	active: true,
	cooldownSeconds: 300,
	lastCompletedAt: iso(fixtureNow),
	nextRunAt: iso(fixtureNow + 300),
	latest: null,
};
test("counts down completion-based plans and counts up running, queued and overdue time", () => {
	expect(collectorSchedule(group, fixtureNow)).toBe("Next in 5m 0s");
	expect(collectorSchedule(group, fixtureNow + 310)).toBe(
		"Due · 0m 10s overdue",
	);
	expect(
		collectorSchedule(
			{ ...group, latest: fixtureJob({ state: "queued" }) },
			fixtureNow + 310,
		),
	).toBe("Queued · 0m 10s waiting");
	expect(
		collectorSchedule(
			{ ...group, latest: fixtureJob({ state: "running", completedAt: null }) },
			fixtureNow,
		),
	).toBe("Running · 20s elapsed");
	expect(collectorSchedule({ ...group, active: false }, fixtureNow)).toBe(
		"Stopped",
	);
	expect(collectorSchedule({ ...group, nextRunAt: null }, fixtureNow)).toBe(
		"Manual",
	);
	expect(
		collectorSchedule(
			{ ...group, latest: fixtureJob({ state: "auth_required" }) },
			fixtureNow,
		),
	).toContain("Retry in 5m 0s");
	expect(
		collectorSchedule(
			{
				...group,
				nextRunAt: null,
				latest: fixtureJob({ state: "auth_required" }),
			},
			fixtureNow,
		),
	).toBe("Sign-in required");
	expect(clockDuration(-1)).toBe("0m 0s");
	expect(collectorTime(null)).toBe("—");
	expect(collectorTime(iso(fixtureNow))).toBe(
		new Date(fixtureNow * 1000).toLocaleString(),
	);
});
