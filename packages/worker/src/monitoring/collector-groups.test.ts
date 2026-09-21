import { afterEach, beforeEach, expect, test } from "bun:test";
import { adoPullId } from "@signoff/domain/collection";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { queryCollectorGroups } from "./collector-groups";
import {
	addObservation,
	refreshObserved,
	removeObservation,
} from "./observations";
import {
	publishRepository,
	registerJobRepositories,
	stagePulls,
} from "./publication";
import { queryJob, queryJobHistory } from "./query";
import { claimJob, renewJob, scheduleDiscovery } from "./scheduler";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
test("groups retain immutable attempt results and completion-based plans while manual requests respect cooldown", async () => {
	seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, {
		id: adoPullId("live-project", "repo-1", "1"),
	});
	const t = PR_TEST_NOW;
	const added = await addObservation(sqlite.db, "cli", { pullId: pull.id }, t);
	const claim = (await claimJob(sqlite.db, t))!;
	await renewJob(sqlite.db, claim.job.id, claim.leaseToken, t + 1, {
		completedPulls: 0,
		totalPulls: 1,
		message: "Reading builds",
		phase: "builds",
	});
	await registerJobRepositories(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[pull.repository],
		t + 1,
	);
	const snapshot = {
		...pull,
		summaryObservedAt: t,
		checksObservedAt: t + 2,
		observedAt: t + 2,
	};
	await stagePulls(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		[snapshot],
		t + 2,
	);
	await publishRepository(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		pull.repository.id,
		1,
		"complete",
		"All details returned",
		t + 3,
	);
	const detail = await queryJob(sqlite.db, "cli", claim.job.id);
	expect(detail.result).toEqual(snapshot);
	expect(
		detail.events.map((event: { phase: string }) => event.phase),
	).toContain("builds");
	const groups = await queryCollectorGroups(sqlite.db, "cli", undefined, t + 4);
	const group = groups.data.find(
		(item) => item.id === `pr:${added.observation.id}`,
	)!;
	expect(group.nextRunAt).toBe(new Date((t + 303) * 1000).toISOString());
	expect(group.latest?.id).toBe(claim.job.id);
	const manual = await refreshObserved(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		t + 5,
	);
	expect(manual.jobs[0]?.notBefore).toBe(group.nextRunAt!);
	expect(await claimJob(sqlite.db, t + 302, { lane: "checks" })).toBeNull();
	expect((await claimJob(sqlite.db, t + 303, { lane: "checks" }))?.job.id).toBe(
		manual.jobs[0]!.id,
	);
	const history = await queryJobHistory(sqlite.db, "cli", {
		lane: "all",
		outcome: "all",
		group: group.id,
	});
	expect(history.data.map((job) => job.id)).toEqual([
		manual.jobs[0]!.id,
		claim.job.id,
	]);
	await removeObservation(sqlite.db, "cli", added.observation.id, 1, t + 304);
	expect(
		(
			await queryCollectorGroups(sqlite.db, "cli", undefined, t + 304)
		).data.find((item) => item.id === group.id),
	).toMatchObject({ active: false, nextRunAt: null });
	expect((await queryJob(sqlite.db, "cli", claim.job.id)).result).toEqual(
		snapshot,
	);
});
test("groups include uncollected projects, source isolation and stable pagination", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	for (let i = 1; i <= 51; i++) {
		const pull = seedPull(sqlite, {
			id: `pull-${i}`,
			number: i,
			externalId: String(i),
		});
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
	}
	await scheduleDiscovery(sqlite.db, PR_TEST_NOW, "cli");
	const first = await queryCollectorGroups(
		sqlite.db,
		"cli",
		undefined,
		PR_TEST_NOW,
	);
	expect(first.data).toHaveLength(50);
	expect(first.nextCursor).not.toBeNull();
	const second = await queryCollectorGroups(
		sqlite.db,
		"cli",
		first.nextCursor!,
		PR_TEST_NOW,
	);
	expect(second.data).toHaveLength(2);
	expect(second.nextCursor).toBeNull();
	expect(
		new Set([...first.data, ...second.data].map((group) => group.id)).size,
	).toBe(52);
	expect(second.data.find((group) => group.kind === "discover")).toMatchObject({
		projectId: project.id,
		cooldownSeconds: 600,
	});
	expect(
		(await queryCollectorGroups(sqlite.db, "demo", undefined, PR_TEST_NOW))
			.data,
	).toEqual([]);
});
