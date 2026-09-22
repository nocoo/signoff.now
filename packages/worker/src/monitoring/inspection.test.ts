import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	COMMON_RULES,
	decisionFingerprint,
	decisionState,
	defaultProjectRules,
	JEV_MODEL,
	JEV_RUBRIC,
} from "@signoff/domain/ai-readiness";
import type { EvaluationRow } from "../ai/scheduler";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { inspectionContext, inspectObservation } from "./inspection";
import { addObservation, removeObservation } from "./observations";
import { parseQuery, queryObservations } from "./query";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
async function setup() {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, {
		targetBranch: "main",
		mergeable: "clear",
		headSha: "head",
		targetSha: "target",
		evidence: { status: "active", mergeStatus: "succeeded", mergeSha: "merge" },
	});
	const { observation: watch } = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		now,
	);
	const context = await inspectionContext(sqlite.db, "cli", [watch]);
	context.settings.configured = 1;
	return { project, pull, watch, context };
}
test("inspection keeps raw evidence, nullable validity, SHA provenance and independent review requirements", async () => {
	const { project, pull, watch, context } = await setup();
	pull.summaryObservedAt = now - 60;
	pull.checksObservedAt = now - 600;
	pull.coverage = "partial";
	pull.collectionIssues = ["Timeline unavailable"];
	pull.policies = [
		{
			id: "p1",
			name: "Build",
			state: "failed",
			required: true,
			owner: "Maintainers",
			detail: "Generated rerun instruction",
			kind: "build",
			definitionId: "42",
			evidence: {
				configurationId: "12",
				evaluationId: "eval",
				status: "approved",
				isExpired: true,
				buildIsNotCurrent: false,
				buildId: "build",
				startedAt: now - 800,
				completedAt: now - 700,
				validDurationMinutes: 60,
			},
		},
		{
			id: "r1",
			name: "Review",
			state: "queued",
			required: true,
			owner: "Maintainers",
			detail: "Generated instruction",
			kind: "review",
			evidence: {
				minimumApproverCount: 2,
				creatorVoteCounts: false,
				requiredReviewerIds: ["group"],
				filenamePatterns: ["/src/*"],
			},
		},
		{
			id: "r2",
			name: "CRC",
			state: "passed",
			required: true,
			owner: "Maintainers",
			detail: "Generated instruction",
			kind: "status",
		},
	];
	pull.builds = [
		{
			id: "build",
			name: "CI",
			number: 4,
			definitionId: "42",
			state: "passed",
			required: true,
			evidence: {
				sourceSha: "merge",
				sourceBranch: "refs/pull/1/merge",
				result: "succeeded",
			},
			stages: [
				{
					id: "record",
					owner: "Maintainers",
					detail: "Generated stage summary",
					durationSeconds: null,
					name: "Test",
					state: "passed",
					required: true,
					evidence: {
						identifier: "Test_1",
						recordType: "Stage",
						attempt: 2,
						updatedAt: now - 700,
					},
				},
			],
		},
	];
	pull.reviewers = [
		{
			id: "person",
			name: "Person",
			vote: "approved",
			required: false,
			isGroup: false,
			providerVote: 10,
		},
		{
			id: "group",
			name: "Group",
			vote: "approved",
			required: true,
			isGroup: true,
			providerVote: 10,
		},
		{ id: "unknown", name: "Unknown", vote: "approved", required: false },
	];
	const result = await inspectObservation(
		watch,
		pull,
		project,
		"provider-project",
		undefined,
		context,
		now,
	);
	expect(Object.keys(result)).toEqual([
		"watch",
		"pr",
		"readiness",
		"nextAction",
		"checks",
		"builds",
		"reviews",
	]);
	expect(result.pr.project).toEqual({
		signoffId: project.id,
		providerId: "provider-project",
		name: project.projectKey,
	});
	expect(result.pr).toMatchObject({
		author: pull.author,
		draft: false,
		providerStatus: "active",
		targetSha: "target",
		targetShaSource: "ado_lastMergeTargetCommit",
	});
	expect(result.pr.collection.observedAt).not.toBe(result.checks.observedAt);
	expect(result.checks).toMatchObject({
		coverage: "partial",
		missing: ["Timeline unavailable"],
	});
	expect(result.checks.items[0]).toMatchObject({
		evaluationId: "eval",
		configurationId: "12",
		isExpired: true,
		buildIsNotCurrent: false,
		required: null,
		message: null,
		validDurationMinutes: 60,
	});
	expect(result.checks.items[1]).toMatchObject({
		applicable: null,
		isExpired: null,
		reviewRule: {
			minimumApproverCount: 2,
			creatorVoteCounts: false,
			requiredReviewerIds: ["group"],
			filenamePatterns: ["/src/*"],
		},
	});
	expect(result.builds[0]).toMatchObject({
		definitionId: "42",
		headMatch: { actualSha: "merge", expectedSha: "head", status: "mismatch" },
		mergeMatch: { actualSha: "merge", expectedSha: "merge", status: "match" },
		checkRefs: ["checks/p1"],
		stages: [
			{
				identifier: "Test_1",
				attempt: 2,
				requiredSource: "derived",
				recordType: "Stage",
			},
		],
	});
	expect(result.reviews).toMatchObject({
		individualApproved: 1,
		groupApproved: 1,
		unclassifiedApproved: 1,
		requirementsSource: "checks",
	});
	expect(
		result.reviews.reviewers.every((r) => r.approvalRevision === null),
	).toBe(true);
	expect(result.nextAction).toBeNull();
	pull.builds[0]!.evidence = undefined;
	expect(
		(
			await inspectObservation(
				watch,
				pull,
				project,
				null,
				undefined,
				context,
				now,
			)
		).builds[0]?.headMatch.status,
	).toBe("unknown");
});
test.each([
	["attention", "inspect_pr"],
	["review_needed", "request_review"],
	["waiting", "wait_ci"],
])("%s advice keeps current and historical judgments distinct", async (kind, code) => {
	const { project, pull, watch, context } = await setup();
	const state = decisionState(pull, project, now, context.detailCooldown, {
		common: COMMON_RULES,
		project: defaultProjectRules(project.id),
	});
	const judgment = {
		kind,
		model: JEV_MODEL,
		rubric: JEV_RUBRIC,
		fingerprint: await decisionFingerprint(state),
		evaluatedAt: new Date((now - 600) * 1000).toISOString(),
		probabilities: { [kind]: 1 },
		confidence: 1,
	};
	const row: EvaluationRow = {
		observation_id: watch.id,
		generation: watch.generation,
		config_revision: context.settings.revision,
		input_revision: 1,
		status: "complete",
		fingerprint: judgment.fingerprint,
		result_json: JSON.stringify(judgment),
		previous_json: null,
		error: null,
		attempts: 1,
		not_before: now + 200,
		lease_token: null,
	};
	const read = () =>
		inspectObservation(watch, pull, project, null, row, context, now);
	expect((await read()).readiness).toMatchObject({
		state: kind,
		isCurrent: true,
		evaluatedAt: judgment.evaluatedAt,
		update: { state: "idle" },
	});
	expect((await read()).nextAction).toMatchObject({
		code,
		evidenceRefs: [],
	});
	pull.observedAt = now + 1;
	expect((await read()).readiness.isCurrent).toBe(true);
	context.rules.set("common", "Changed instruction");
	expect((await read()).readiness).toMatchObject({
		state: kind,
		isCurrent: false,
		update: {
			state: "scheduled",
			reason: null,
			notBefore: new Date((now + 200) * 1000).toISOString(),
		},
	});
	expect((await read()).readiness.update.state).toBe("scheduled");
	row.status = "running";
	expect((await read()).readiness.update.state).toBe("evaluating");
	row.status = "error";
	row.error = "Provider unavailable";
	expect((await read()).readiness).toMatchObject({
		state: kind,
		update: { state: "error", error: "Provider unavailable" },
	});
	context.rules.clear();
	row.status = "complete";
	pull.headSha = "new-head";
	expect((await read()).readiness.isCurrent).toBe(false);
	pull.mergeable = "conflicts";
	expect((await read()).readiness).toMatchObject({
		state: "conflict",
		source: "provider",
		isCurrent: true,
	});
	pull.targetBranch = "release";
	expect((await read()).readiness.state).toBe("skipped");
	watch.active = false;
	watch.stopReason = "manual";
	watch.stoppedAt = now;
	expect((await read()).readiness).toMatchObject({
		isCurrent: false,
		update: { state: "stopped", reason: "unwatched" },
	});
	expect((await read()).nextAction).toBeNull();
});
test("read-only query exposes failed attempts without replacing old evidence and isolates rewatch generations", async () => {
	const { pull, watch } = await setup();
	sqlite.raw
		.query(
			"UPDATE collection_jobs SET state='auth_required',updated_at=?,error_kind='auth_required',message='Login required' WHERE observation_id=?",
		)
		.run(now + 1, watch.id);
	const changes = () =>
		sqlite.raw.query("SELECT total_changes() n").get() as { n: number };
	const before = changes();
	const result = await queryObservations(
		sqlite.db,
		"cli",
		parseQuery(new URLSearchParams()),
		now + 2,
	);
	expect(changes()).toEqual(before);
	expect(result.schemaVersion).toBe(2);
	const item = Array.isArray(result.data) ? result.data[0]! : result.data;
	expect(item.pr.collection.lastAttempt).toMatchObject({
		kind: "details",
		state: "auth_required",
		completedAt: null,
		error: "auth_required: Login required",
	});
	expect(item.checks.lastAttempt?.error).toContain("Login required");
	expect(item.pr.id).toBe(pull.id);
	await removeObservation(
		sqlite.db,
		"cli",
		watch.id,
		watch.generation,
		now + 3,
	);
	const { observation: next } = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		now + 4,
	);
	const context = await inspectionContext(sqlite.db, "cli", [next]);
	const rewatch = await inspectObservation(
		next,
		pull,
		undefined,
		null,
		undefined,
		context,
		now + 5,
	);
	expect(rewatch.watch.generation).toBe(watch.generation + 1);
	expect(rewatch.checks.lastAttempt).toBeNull();
	expect(rewatch.readiness).toMatchObject({
		state: null,
		isCurrent: false,
		update: { state: "error" },
	});
	const pending = await inspectObservation(
		next,
		undefined,
		undefined,
		null,
		undefined,
		context,
		now + 5,
	);
	expect(pending.checks).toMatchObject({
		coverage: "not_collected",
		missing: ["Checks have not been collected"],
		validity: "missing",
	});
	expect(pending.nextAction).toBeNull();
});
test("saved policy codes and project instructions share the scheduler fingerprint and completion cooldown", async () => {
	const { project, pull, watch } = await setup();
	const gate = decisionState(pull, project, now).policiesInPriorityOrder.find(
		(g) => g.id !== "merge-conflicts",
	)!;
	sqlite.raw
		.query("INSERT INTO ai_rules VALUES('common',1,'Common instructions')")
		.run();
	sqlite.raw
		.query("INSERT INTO ai_rules VALUES(?,1,'Project instructions')")
		.run(project.id);
	sqlite.raw.query("INSERT INTO ai_policy_codes VALUES(1,'Policy','X1')").run();
	sqlite.raw
		.query("INSERT INTO ai_policy_aliases VALUES(?,?,1)")
		.run(project.id, gate.id);
	sqlite.raw
		.query(
			"INSERT INTO ai_project_schedule(project_id,last_started_at,last_completed_at) VALUES(?,?,?)",
		)
		.run(project.id, now - 100, now - 20);
	const context = await inspectionContext(sqlite.db, "cli", [watch]);
	context.settings.configured = 1;
	const state = decisionState(pull, project, now, context.detailCooldown, {
		common: "Common instructions",
		project: "Project instructions",
	});
	state.policiesInPriorityOrder.find((p) => p.id === gate.id)!.code = "X1";
	const judgment = {
		kind: "running",
		model: JEV_MODEL,
		rubric: JEV_RUBRIC,
		fingerprint: await decisionFingerprint(state),
		evaluatedAt: new Date(now * 1000).toISOString(),
		confidence: 1,
		probabilities: { running: 1 },
	};
	const row: EvaluationRow = {
		observation_id: watch.id,
		generation: watch.generation,
		input_revision: 1,
		config_revision: context.settings.revision,
		status: "complete",
		fingerprint: judgment.fingerprint,
		result_json: JSON.stringify(judgment),
		previous_json: null,
		error: null,
		attempts: 1,
		not_before: 0,
		lease_token: null,
	};
	expect(
		(await inspectObservation(watch, pull, project, null, row, context, now))
			.readiness.isCurrent,
	).toBe(true);
	context.settings.revision++;
	const pending = await inspectObservation(
		watch,
		pull,
		project,
		null,
		row,
		context,
		now,
	);
	expect(pending.readiness).toMatchObject({
		state: "running",
		isCurrent: false,
		update: {
			state: "scheduled",
			notBefore: new Date((now + 280) * 1000).toISOString(),
		},
	});
	expect(context.codes.get(`${project.id}:${gate.id}`)).toBe("X1");
});
