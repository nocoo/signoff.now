import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	CLASSIFICATION,
	decisionFingerprint,
	decisionState,
	JEV_MODEL,
} from "@signoff/domain/ai-readiness";
import { addObservation, removeObservation } from "../monitoring/observations";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { evaluateJev } from "./jev";
import { type EvaluationRow, evaluationOutput, runAiOnce } from "./scheduler";
import { openKey, sealKey } from "./secrets";

let sqlite: SqliteD1;
const view = { id: "test-view", sequence: 1, source: "cli" as const };
const master = btoa("x".repeat(32));
const env = () => ({ DB: sqlite.db, SIGNOFF_AI_ENCRYPTION_KEY: master });
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	sqlite.raw
		.query("INSERT INTO ai_views VALUES(?,1,'cli',1,?)")
		.run("test-view", now + 10000);
});
afterEach(() => sqlite.close());
export function response(kind = "running") {
	const choice = (selected: string, options: string[]) => ({
		type: "choice",
		choice: selected,
		probabilities: Object.fromEntries(
			options.map((o) => [o, o === selected ? 1 : 0]),
		),
		confidence: 1,
	});
	return Response.json({
		model: JEV_MODEL,
		answers: {
			p0_readiness: choice(kind, Object.keys(CLASSIFICATION)),
		},
	});
}
const row = () =>
	sqlite.raw
		.query("SELECT * FROM ai_evaluations ORDER BY generation DESC")
		.get() as EvaluationRow;
async function setup() {
	await sqlite.db
		.prepare("UPDATE ai_settings SET encrypted_key=?")
		.bind(await sealKey("test-key", master))
		.run();
	return (await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now))
		.observation;
}
function change(field: string, value: unknown) {
	sqlite.raw
		.query(
			`UPDATE pull_requests SET snapshot=json_set(snapshot,?,json(?)) WHERE id='pull-1'`,
		)
		.run(`$.${field}`, JSON.stringify(value));
}
test("encrypts at rest and rejects missing, corrupt or unavailable credentials", async () => {
	const encrypted = await sealKey("test-key", master);
	expect(encrypted).not.toContain("test-key");
	expect(await openKey(encrypted, master)).toBe("test-key");
	await expect(openKey(null, master)).rejects.toThrow("Configure");
	await expect(openKey("bad", master)).rejects.toThrow("cannot be decrypted");
	await expect(sealKey("key", "invalid")).rejects.toThrow("not configured");
	await expect(openKey(encrypted, undefined)).rejects.toThrow("not configured");
});
test("only watches evaluate, identical facts dedupe, real facts and instructions invalidate", async () => {
	let calls = 0;
	const fetcher = (async () => {
		calls++;
		return response();
	}) as unknown as typeof fetch;
	expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
		processed: false,
	});
	await setup();
	await runAiOnce(env(), view, now, fetcher);
	expect(evaluationOutput(row(), true).kind).toBe("running");
	expect(evaluationOutput(row(), false).status).toBe("not_watched");
	await runAiOnce(env(), view, now + 1, fetcher);
	change("observedAt", now + 1);
	expect(evaluationOutput(row(), true).current?.kind).toBe("running");
	await runAiOnce(env(), view, now + 1, fetcher);
	expect(calls).toBe(1);
	change("headSha", "new-head");
	expect(evaluationOutput(row(), true).previous?.kind).toBe("running");
	await runAiOnce(env(), view, now + 300, fetcher);
	expect(calls).toBe(2);
	sqlite.raw.query("UPDATE projects SET policy_context_json=?").run(
		JSON.stringify({
			default: [
				{
					gateId: "merge-conflicts",
					description: "Wait for the scheduled repair.",
				},
			],
			repositories: {},
		}),
	);
	await runAiOnce(env(), view, now + 600, fetcher);
	expect(calls).toBe(3);
	expect(row().status).toBe("complete");
	await runAiOnce(env(), view, now + 1300, fetcher);
	expect(calls).toBe(4);
});
test("observation clocks preserve an in-flight request and its completed result across cooldowns", async () => {
	await setup();
	let calls = 0;
	const fetcher = (async () => {
		calls++;
		const claimed = row();
		if (calls === 1) {
			change("observedAt", now + 1);
			change("summaryObservedAt", now + 1);
			change("checksObservedAt", now + 1);
			change("updatedAt", now + 1);
		}
		expect(row()).toEqual(claimed);
		return response();
	}) as unknown as typeof fetch;
	await runAiOnce(env(), view, now, fetcher);
	const completed = row();
	expect(completed.status).toBe("complete");
	for (const elapsed of [10, 301, 601]) {
		change("observedAt", now + elapsed);
		change("summaryObservedAt", now + elapsed);
		change("checksObservedAt", now + elapsed);
		expect(row()).toEqual(completed);
		expect(await runAiOnce(env(), view, now + elapsed, fetcher)).toEqual({
			processed: false,
		});
		expect(row()).toEqual(completed);
	}
	expect(calls).toBe(1);
	change("checksObservedAt", null);
	expect(row().status).toBe("pending");
	await runAiOnce(env(), view, now + 602, fetcher);
	expect(calls).toBe(2);
	change("checksObservedAt", now + 603);
	expect(row().status).toBe("pending");
});
test("pending changes cannot bypass the project cooldown measured from request completion", async () => {
	await setup();
	let clock = now * 1000;
	const time = spyOn(Date, "now").mockImplementation(() => clock);
	let calls = 0;
	const fetcher = (async () => {
		calls++;
		clock += 12000;
		return response();
	}) as unknown as typeof fetch;
	try {
		await runAiOnce(env(), view, now, fetcher);
		change("headSha", "changed-after-completion");
		expect(row().status).toBe("pending");
		for (const elapsed of [13, 60, 299, 300, 311]) {
			clock = (now + elapsed) * 1000;
			expect(await runAiOnce(env(), view, now + elapsed, fetcher)).toEqual({
				processed: false,
			});
			expect(row().status).toBe("pending");
			expect(calls).toBe(1);
		}
		clock = (now + 312) * 1000;
		await runAiOnce(env(), view, now + 312, fetcher);
		expect(calls).toBe(2);
		expect(row().status).toBe("complete");
	} finally {
		time.mockRestore();
	}
});
test.each([
	"facts",
	"instructions",
	"key",
	"common rules",
	"project rules",
	"unwatch",
	"rewatch",
])("late response cannot overwrite newer %s", async (mode) => {
	const watch = await setup();
	let release: (value: Response) => void = () => {};
	let entered: () => void = () => {};
	const started = new Promise<void>((r) => {
		entered = r;
	});
	const request = runAiOnce(env(), view, now, (async () => {
		entered();
		return new Promise<Response>((r) => {
			release = r;
		});
	}) as unknown as typeof fetch);
	await started;
	expect(await runAiOnce(env(), view, now)).toEqual({ processed: false });
	if (mode === "facts") change("headSha", "superseded");
	if (mode === "instructions")
		sqlite.raw.query("UPDATE projects SET policy_context_json=?").run(
			JSON.stringify({
				default: [{ gateId: "merge-conflicts", description: "Changed" }],
				repositories: {},
			}),
		);
	if (mode.endsWith("rules"))
		sqlite.raw
			.query("INSERT INTO ai_rules(scope,revision,text) VALUES(?,1,?)")
			.run(
				mode === "common rules" ? "common" : "live-project",
				"A changed instruction",
			);
	if (mode === "key")
		sqlite.raw.query("UPDATE ai_settings SET revision=revision+1").run();
	if (mode === "unwatch" || mode === "rewatch") {
		await removeObservation(
			sqlite.db,
			"cli",
			watch.id,
			watch.generation,
			now + 1,
		);
		if (mode === "rewatch")
			await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now + 2);
	}
	release(response());
	await request;
	expect(row().result_json).toBeNull();
	if (mode === "unwatch")
		expect(await runAiOnce(env(), view, now + 3)).toEqual({ processed: false });
	else {
		await runAiOnce(env(), view, now + 300, (async () =>
			response("attention")) as unknown as typeof fetch);
		expect(evaluationOutput(row(), true).kind).toBe("attention");
	}
});
test("bounded retry respects backoff and identical polling cannot restart exhausted errors", async () => {
	await setup();
	let calls = 0;
	const fail = (async () => {
		calls++;
		return new Response(null, { status: 529 });
	}) as unknown as typeof fetch;
	await runAiOnce(env(), view, now, fail);
	expect(row().status).toBe("pending");
	await runAiOnce(env(), view, now + 1, fail);
	expect(calls).toBe(1);
	await runAiOnce(env(), view, now + 300, fail);
	await runAiOnce(env(), view, now + 600, fail);
	expect(row().status).toBe("error");
	change("observedAt", now + 16);
	await runAiOnce(env(), view, now + 601, fail);
	expect(calls).toBe(3);
	expect(evaluationOutput(row(), true)).toMatchObject({
		kind: "error",
		current: null,
	});
	change("headSha", "changed");
	await runAiOnce(env(), view, now + 900, (async () =>
		response("running")) as unknown as typeof fetch);
	expect(evaluationOutput(row(), true).kind).toBe("running");
});
test("missing key is an operational error, never a rule judgment or repeated request", async () => {
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now);
	await runAiOnce(env(), view, now);
	expect(row().error).toContain("missing_key");
	change("observedAt", now + 1);
	expect(await runAiOnce(env(), view, now + 1)).toEqual({ processed: false });
	expect(row().status).toBe("error");
});
test.each([
	401, 403, 429, 500,
])("provider HTTP %s remains sanitized", async (status) => {
	await expect(
		evaluateJev(
			"secret",
			{},
			"f",
			now,
			(async () =>
				new Response("secret echoed by upstream", {
					status,
					headers: { "retry-after": "7" },
				})) as unknown as typeof fetch,
		),
	).rejects.toThrow(
		status === 401 || status === 403
			? "rejected"
			: status === 429
				? "rate limit"
				: `HTTP ${status}`,
	);
});
test("invalid typed responses, transport failures and oversized state fail explicitly", async () => {
	await expect(
		evaluateJev("key", {}, "f", now, (async () =>
			Response.json({})) as unknown as typeof fetch),
	).rejects.toThrow("invalid typed");
	await expect(
		evaluateJev("key", {}, "f", now, (async () => {
			throw Error("private upstream error");
		}) as unknown as typeof fetch),
	).rejects.toThrow("could not be reached");
	await expect(evaluateJev("key", "x".repeat(96000), "f", now)).rejects.toThrow(
		"request budget",
	);
});
test("state has all policy evidence and priorities, excludes generated answers and poll clocks", async () => {
	const project = seedProject(sqlite, {
		id: "other",
		projectKey: "Other",
		policyContext: {
			default: [
				{
					gateId: "policy-1",
					description: "Advisory failures are expected; do not rerun.",
				},
			],
			repositories: {},
		},
	});
	const pull = seedPull(sqlite, { id: "another", projectId: "other" });
	const state = decisionState(pull, project, now);
	expect(state.policiesInPriorityOrder[0]?.description).toContain("Advisory");
	expect(state.policies).toHaveLength(pull.policies.length);
	expect(state).not.toHaveProperty("readiness");
	expect(JSON.stringify(state)).not.toContain("Resolve X, then rerun");
	expect(await decisionFingerprint(state)).toBe(
		await decisionFingerprint(
			decisionState(
				{ ...pull, observedAt: now + 1, updatedAt: now + 1 },
				project,
				now + 1,
			),
		),
	);
});
test.each([
	[
		"automatic CI",
		"running",
		"running",
		false,
		true,
		"complete",
		"clear",
		"running",
		null,
	],
	[
		"human stage",
		"running",
		"waiting",
		false,
		true,
		"complete",
		"clear",
		"attention",
		"approve",
	],
	[
		"explicit expiry",
		"passed",
		"passed",
		true,
		true,
		"complete",
		"clear",
		"attention",
		"rerun",
	],
	[
		"queued build with human gate",
		"queued",
		"queued",
		false,
		true,
		"complete",
		"clear",
		"attention",
		"resolve_conflict",
	],
	[
		"missing evidence",
		"unknown",
		"unknown",
		false,
		true,
		"partial",
		"unknown",
		"running",
		null,
	],
	[
		"advisory failure with instructions",
		"failed",
		"failed",
		false,
		false,
		"complete",
		"clear",
		"attention",
		null,
	],
	[
		"contradictory instructions",
		"passed",
		"failed",
		false,
		true,
		"partial",
		"clear",
		"running",
		null,
	],
] as const)("typed Jev judgment is authoritative for %s", async (_name, buildState, stageState, expired, required, coverage, mergeable, kind, _action) => {
	seedPull(sqlite, {
		mergeable,
		coverage,
		policies: [
			{
				id: "gate",
				name: "Gate",
				kind: "build",
				definitionId: "42",
				required,
				state: expired ? "failed" : "passed",
				detail: "Generated action must be omitted",
				owner: "Owner",
				evidence: {
					status: "approved",
					isExpired: expired,
					buildIsNotCurrent: true,
					isBlocking: required,
					description: "Raw provider description",
				},
			},
		],
		builds: [
			{
				id: "build",
				name: "CI",
				definitionId: "42",
				number: 1,
				required,
				state: buildState,
				stages: [
					{
						id: "stage",
						name: "Stage",
						required,
						state: stageState,
						detail: "Generated stage action",
						owner: "Owner",
						durationSeconds: null,
						evidence: {
							status: stageState,
							attempt: 2,
							description: "Raw stage message",
						},
					},
				],
			},
		],
	});
	sqlite.raw.query("UPDATE projects SET policy_context_json=?").run(
		JSON.stringify({
			default: [
				{
					gateId: "build:42",
					description: required
						? "Wait for automatic progress unless provider evidence requires a person."
						: "This advisory validation is being repaired independently; no PR author action is required.",
				},
			],
			repositories: {},
		}),
	);
	await setup();
	await runAiOnce(env(), view, now, (async (
		_url: string,
		init?: RequestInit,
	) => {
		const body = JSON.parse(String(init?.body));
		const state = {
			...body.state.prs[0],
			...body.state.contexts[body.state.prs[0].contextRef],
		};
		expect(body.state.policyFacts[state.policies[0]].evidence).toMatchObject({
			isExpired: expired,
			buildIsNotCurrent: true,
		});
		expect(
			body.state.policyInstructions[state.policiesInPriorityOrder[0]]
				.description,
		).toBeTruthy();
		expect(JSON.stringify(state)).not.toContain("Generated action");
		return response(kind);
	}) as unknown as typeof fetch);
	expect(evaluationOutput(row(), true).current).toMatchObject({ kind });
});

test("foreground project batches include only changed watches and respect independent completion cooldowns", async () => {
	await setup();
	seedPull(sqlite, { id: "pull-2", number: 2, externalId: "2" });
	seedPull(sqlite, { id: "unwatched", number: 3, externalId: "3" });
	await addObservation(sqlite.db, "cli", { pullId: "pull-2" }, now);
	const payloads: {
		state: { contexts: unknown[]; prs: { pr: { id: string } }[] };
		questions: Record<
			string,
			{ criteria: Record<string, string>; instructions: string }
		>;
	}[] = [];
	const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		payloads.push(body);
		return Response.json({
			model: JEV_MODEL,
			usage: { input_tokens: 100, output_tokens: 10 },
			answers: Object.fromEntries(
				Object.entries(body.questions).map(([id, q]) => {
					const options = Object.keys((q as { criteria: object }).criteria),
						choice = "running";
					return [
						id,
						{
							type: "choice",
							choice,
							probabilities: Object.fromEntries(
								options.map((k) => [k, Number(k === choice)]),
							),
							confidence: 1,
						},
					];
				}),
			),
		});
	}) as unknown as typeof fetch;
	sqlite.raw.query("UPDATE ai_views SET visible=0").run();
	expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
		processed: false,
	});
	sqlite.raw.query("UPDATE ai_views SET visible=1").run();
	await runAiOnce(env(), view, now, fetcher);
	expect(payloads).toHaveLength(1);
	expect(
		payloads[0]?.state.prs
			.map((p) => p.pr.id)
			.sort((a, b) => a.localeCompare(b)),
	).toEqual(["pull-1", "pull-2"]);
	expect(payloads[0]?.state.contexts).toHaveLength(1);
	expect(Object.keys(payloads[0]?.questions ?? {})).toHaveLength(2);
	expect(payloads[0]?.questions.p1_readiness?.instructions).toContain("prs[1]");
	const unchanged = sqlite.raw
		.query(
			"SELECT e.* FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id WHERE o.pull_id='pull-2'",
		)
		.get();
	change("headSha", "changed-head");
	expect(await runAiOnce(env(), view, now + 299, fetcher)).toEqual({
		processed: false,
	});
	seedProject(sqlite, {
		id: "another-project",
		projectKey: "Another",
		repositories: [],
	});
	seedPull(sqlite, {
		id: "another-pr",
		projectId: "another-project",
		number: 4,
		externalId: "4",
	});
	await addObservation(sqlite.db, "cli", { pullId: "another-pr" }, now + 299);
	await runAiOnce(env(), view, now + 299, fetcher);
	expect(payloads[1]?.state.prs.map((p) => p.pr.id)).toEqual(["another-pr"]);
	sqlite.raw.query("UPDATE ai_views SET visible=0").run();
	expect(await runAiOnce(env(), view, now + 301, fetcher)).toEqual({
		processed: false,
	});
	sqlite.raw.query("UPDATE ai_views SET visible=1").run();
	await runAiOnce(env(), view, now + 301, fetcher);
	expect(payloads[2]?.state.prs.map((p) => p.pr.id)).toEqual(["pull-1"]);
	expect(
		sqlite.raw
			.query(
				"SELECT e.* FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id WHERE o.pull_id='pull-2'",
			)
			.get(),
	).toEqual(unchanged);
	expect(await runAiOnce(env(), view, now + 700, fetcher)).toEqual({
		processed: false,
	});
	expect(
		sqlite.raw
			.query(
				"SELECT input_tokens,last_batch_size FROM ai_project_schedule WHERE project_id='live-project'",
			)
			.get(),
	).toMatchObject({ input_tokens: 100, last_batch_size: 1 });
	sqlite.raw.query("UPDATE ai_views SET expires_at=?").run(now + 701);
	change("headSha", "another-change");
	expect(await runAiOnce(env(), view, now + 702, fetcher)).toEqual({
		processed: false,
	});
});

test("oversized projects are split across cooldowns without truncation and one oversized PR fails locally", async () => {
	await setup();
	change(
		"collectionIssues",
		Array.from({ length: 40 }, () => "a".repeat(1000)),
	);
	seedPull(sqlite, {
		id: "pull-2",
		number: 2,
		externalId: "2",
		collectionIssues: Array.from({ length: 40 }, () => "b".repeat(1000)),
	});
	await addObservation(sqlite.db, "cli", { pullId: "pull-2" }, now);
	let calls = 0;
	const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		expect(body.state.prs).toHaveLength(1);
		expect(body.state.prs[0].collection.missing).toHaveLength(40);
		calls++;
		return response();
	}) as unknown as typeof fetch;
	await runAiOnce(env(), view, now, fetcher);
	expect(await runAiOnce(env(), view, now + 299, fetcher)).toEqual({
		processed: false,
	});
	await runAiOnce(env(), view, now + 300, fetcher);
	expect(calls).toBe(2);
	change(
		"collectionIssues",
		Array.from({ length: 70 }, () => "x".repeat(1000)),
	);
	await runAiOnce(env(), view, now + 600, fetcher);
	expect(calls).toBe(2);
	expect(
		sqlite.raw
			.query(
				"SELECT error FROM ai_evaluations WHERE observation_id=(SELECT id FROM pr_observations WHERE pull_id='pull-1')",
			)
			.get(),
	).toMatchObject({ error: expect.stringContaining("input_too_large") });
});

test("one malformed answer does not discard a valid sibling result", async () => {
	await setup();
	seedPull(sqlite, { id: "pull-2", number: 2, externalId: "2" });
	await addObservation(sqlite.db, "cli", { pullId: "pull-2" }, now);
	await runAiOnce(
		env(),
		view,
		now,
		Object.assign(async () => response(), { preconnect: fetch.preconnect }),
	);
	const statuses = sqlite.raw
		.query("SELECT status FROM ai_evaluations ORDER BY status")
		.all();
	expect(statuses).toEqual([{ status: "complete" }, { status: "error" }]);
});

test("a revoked requesting tab cannot borrow another tab's foreground presence", async () => {
	await setup();
	sqlite.raw.query("UPDATE ai_views SET visible=0 WHERE id='test-view'").run();
	sqlite.raw
		.query("INSERT INTO ai_views VALUES('other',1,'cli',1,?)")
		.run(now + 100);
	const fetcher = Object.assign(
		async () => {
			throw new Error("Must not request Jev");
		},
		{ preconnect: fetch.preconnect },
	);
	expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
		processed: false,
	});
	sqlite.raw
		.query("UPDATE ai_views SET visible=1,sequence=3 WHERE id='test-view'")
		.run();
	expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
		processed: false,
	});
	expect(row().status).toBe("pending");
});

test("losing foreground during preparation releases work without calling Jev or consuming cooldown", async () => {
	await setup();
	sqlite.raw.exec(
		"CREATE TRIGGER blur_during_claim AFTER UPDATE ON ai_evaluations WHEN NEW.status='running' BEGIN UPDATE ai_views SET visible=0,sequence=sequence+1; END;",
	);
	let calls = 0;
	const fetcher = Object.assign(
		async () => {
			calls++;
			return response();
		},
		{ preconnect: fetch.preconnect },
	);
	await runAiOnce(env(), view, now, fetcher);
	expect(calls).toBe(0);
	expect(row()).toMatchObject({
		status: "pending",
		attempts: 0,
		lease_token: null,
	});
	expect(
		sqlite.raw
			.query(
				"SELECT last_started_at,last_completed_at FROM ai_project_schedule",
			)
			.get(),
	).toEqual({ last_started_at: null, last_completed_at: null });
	sqlite.raw.exec("DROP TRIGGER blur_during_claim");
	sqlite.raw.query("UPDATE ai_views SET visible=1,sequence=1").run();
	await runAiOnce(env(), view, now + 1, fetcher);
	expect(calls).toBe(1);
});

test("conflicts bypass Jev and unwatched conflicts remain not evaluated", async () => {
	await setup();
	change("mergeable", "conflicts");
	let calls = 0;
	await runAiOnce(env(), view, now, (async () => {
		calls++;
		return response();
	}) as unknown as typeof fetch);
	expect(calls).toBe(0);
	expect(
		evaluationOutput(row(), true, {
			mergeable: "conflicts",
			targetBranch: "main",
		}),
	).toMatchObject({ kind: "conflict", current: null, status: "complete" });
	expect(
		evaluationOutput(row(), false, {
			mergeable: "conflicts",
			targetBranch: "main",
		}).status,
	).toBe("not_watched");
	change("mergeable", "clear");
	await runAiOnce(env(), view, now, (async () => {
		calls++;
		return response();
	}) as unknown as typeof fetch);
	expect(calls).toBe(1);
});

test("project rules invalidate and enter only that project's watched decision state", async () => {
	await setup();
	seedProject(sqlite, {
		id: "second-project",
		projectKey: "Second",
		repositories: [],
	});
	seedPull(sqlite, {
		id: "second-pull",
		projectId: "second-project",
		number: 2,
		externalId: "2",
	});
	const second = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: "second-pull" },
		now,
	);
	const firstRevision = row().input_revision;
	sqlite.raw
		.query(
			"INSERT INTO ai_rules(scope,revision,text) VALUES('second-project',1,'Only the second project uses this instruction.')",
		)
		.run();
	const revisions = sqlite.raw
		.query("SELECT observation_id,input_revision FROM ai_evaluations")
		.all() as { observation_id: string; input_revision: number }[];
	expect(
		revisions.find((r) => r.observation_id === second.observation.id)
			?.input_revision,
	).toBe(2);
	expect(
		revisions.find((r) => r.observation_id !== second.observation.id)
			?.input_revision,
	).toBe(firstRevision);
	const seen: string[] = [];
	const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		seen.push(JSON.stringify(body.state.ruleSets));
		return response();
	}) as unknown as typeof fetch;
	await runAiOnce(env(), view, now, fetcher);
	await runAiOnce(env(), view, now + 1, fetcher);
	expect(seen).toHaveLength(2);
	expect(seen[0]).not.toContain("Only the second project");
	expect(seen[1]).toContain("Only the second project");
});

test("non-main targets skip inference, hide past judgments and allow main-target siblings", async () => {
	await setup();
	let calls = 0;
	const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
		calls++;
		expect(String(init?.body)).not.toContain("release/do-not-send");
		return response();
	}) as unknown as typeof fetch;
	for (const targetBranch of [
		"release/do-not-send",
		"feature/main",
		"MAIN",
		"refs/heads/user/topic",
	]) {
		change("targetBranch", targetBranch);
		const pull = { targetBranch, mergeable: "conflicts" as const };
		expect(evaluationOutput(row(), true, pull)).toMatchObject({
			kind: "skipped",
			status: "complete",
			current: null,
			previous: null,
		});
		expect(evaluationOutput(row(), false, pull).kind).toBe("skipped");
		expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
			processed: false,
		});
	}
	expect(calls).toBe(0);
	seedPull(sqlite, {
		id: "sibling",
		externalId: "2",
		number: 2,
		targetBranch: "master",
	});
	await addObservation(sqlite.db, "cli", { pullId: "sibling" }, now);
	expect(await runAiOnce(env(), view, now, fetcher)).toEqual({
		processed: true,
	});
	expect(calls).toBe(1);
});

test("retargeting during inference fences the late result and returning to main evaluates again", async () => {
	await setup();
	let calls = 0;
	const fetcher = (async () => {
		calls++;
		if (calls === 1) change("targetBranch", "release/new-target");
		return response("ready");
	}) as unknown as typeof fetch;
	await runAiOnce(env(), view, now, fetcher);
	expect(row().result_json).toBeNull();
	expect(
		evaluationOutput(row(), true, {
			targetBranch: "release/new-target",
			mergeable: "clear",
		}).kind,
	).toBe("skipped");
	await runAiOnce(env(), view, now + 300, fetcher);
	expect(calls).toBe(1);
	change("targetBranch", "refs/heads/main");
	await runAiOnce(env(), view, now + 301, fetcher);
	expect(calls).toBe(2);
	expect(row().status).toBe("complete");
	change("targetBranch", "release/new-target");
	expect(
		evaluationOutput(row(), true, {
			targetBranch: "release/new-target",
			mergeable: "clear",
		}),
	).toMatchObject({ kind: "skipped", previous: null, current: null });
});
