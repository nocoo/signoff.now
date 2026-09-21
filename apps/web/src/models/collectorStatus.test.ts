import { expect, test } from "vitest";
import {
	fixtureJob,
	fixtureNow,
	iso,
	queryFixture,
} from "@/test/monitoring-fixture";
import {
	collectorAge,
	collectorStatus,
	jobDuration,
	jobOperation,
} from "./collectorStatus";

test("separates incomplete PR data, failed jobs and connector health, and clears only recovered work", () => {
	const snapshot = queryFixture().collector;
	snapshot.jobs = [
		fixtureJob({ state: "partial", message: "Build unavailable" }),
	];
	expect(collectorStatus(snapshot, null, fixtureNow)).toMatchObject({
		label: "Partial data",
		tone: "warning",
		problem: "Build unavailable",
	});
	snapshot.jobs.push(
		fixtureJob({
			id: "other",
			requestedAt: iso(fixtureNow + 1),
			observation: { id: "another", generation: 1 },
		}),
	);
	expect(
		collectorStatus(snapshot, null, fixtureNow + 1000).issues,
	).toHaveLength(1);
	snapshot.jobs.push(
		fixtureJob({ id: "recovered", requestedAt: iso(fixtureNow + 2) }),
	);
	expect(collectorStatus(snapshot, null, fixtureNow).label).toBe("Online");
	snapshot.jobs = [fixtureJob({ state: "failed", message: "HTTP 500" })];
	expect(collectorStatus(snapshot, null, fixtureNow)).toMatchObject({
		label: "Collection failed",
		tone: "error",
	});
	expect(
		collectorStatus(snapshot, "API unavailable", fixtureNow),
	).toMatchObject({
		label: "Unavailable",
		problem: "API unavailable",
		activity: "Collection paused",
	});
	expect(collectorStatus(null, null, fixtureNow)).toMatchObject({
		label: "Connecting",
		activity: "Reading status",
		tone: "neutral",
	});
});
test.each([
	"offline",
	"auth_required",
	"error",
] as const)("reports %s without claiming work is running", (state) => {
	const snapshot = queryFixture().collector;
	snapshot.connection = { state, lastSeenAt: null, message: "Reconnect" };
	snapshot.jobs = [fixtureJob({ state: "running" })];
	expect(collectorStatus(snapshot, null, fixtureNow)).toMatchObject({
		tone: "error",
		problem: "Reconnect",
		running: [],
		activity: "Collection paused",
	});
});
test("keeps other work visible when one project needs authentication", () => {
	const snapshot = queryFixture().collector;
	snapshot.connection.state = "auth_required";
	snapshot.queue.authRequired = 1;
	snapshot.jobs = [fixtureJob({ state: "running", lane: "checks" })];
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Refreshing watched PRs",
	);
	snapshot.connection.state = "ready";
	snapshot.jobs = [fixtureJob({ state: "running", kind: "discover" })];
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Discovering PRs",
	);
	snapshot.jobs = [fixtureJob({ state: "running" })];
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Refreshing watched PRs",
	);
});
test("describes queue, manual mode and per-PR scheduling precisely", () => {
	const snapshot = queryFixture().collector;
	snapshot.jobs = [];
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Ready to watch",
	);
	snapshot.queue.queued = 1;
	snapshot.jobs = [fixtureJob({ state: "queued" })];
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Waiting to start",
	);
	snapshot.queue.queued = 0;
	snapshot.watching = 1;
	snapshot.detailCooldownSeconds = 0;
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Manual checks",
	);
	snapshot.detailCooldownSeconds = 300;
	snapshot.scheduling = undefined;
	expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(
		"Waiting for next check",
	);
	for (const [offset, label] of [
		[180, "Next check in 3 min"],
		[30, "Next check in <1 min"],
		[-1, "Next check due"],
	] as const) {
		snapshot.scheduling = {
			strategy: "per_pr",
			checksConcurrency: 2,
			discoveryConcurrency: 1,
			nextCheckDueAt: iso(fixtureNow + offset),
			overdueChecks: 0,
			oldestChecksAgeSeconds: 420,
			oldestSummaryAgeSeconds: 20,
			missingChecks: 0,
		};
		expect(collectorStatus(snapshot, null, fixtureNow).activity).toBe(label);
	}
});
test("formats task type, duration and freshness from the response clock", () => {
	expect(jobOperation(fixtureJob())).toBe("Full PR refresh");
	expect(jobOperation(fixtureJob({ lane: "checks" }))).toBe("Full PR refresh");
	expect(jobOperation(fixtureJob({ kind: "discover" }))).toBe(
		"Project PR list",
	);
	expect(jobDuration(fixtureJob(), fixtureNow)).toBe("20s");
	expect(jobDuration(fixtureJob({ startedAt: null }), fixtureNow)).toBe(
		"Not started",
	);
	expect(jobDuration(fixtureJob({ completedAt: null }), fixtureNow + 60)).toBe(
		"1m 20s",
	);
	const snapshot = queryFixture().collector;
	expect(collectorAge(snapshot, null, fixtureNow)).toBe("Not collected");
	expect(collectorAge(snapshot, undefined, fixtureNow)).toBe("Not collected");
	expect(collectorAge(snapshot, 420, fixtureNow + 60)).toBe("8m ago");
});
