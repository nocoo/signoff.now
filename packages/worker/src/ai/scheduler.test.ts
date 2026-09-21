import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	ACTIONS,
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
const master = btoa("x".repeat(32));
const env = () => ({ DB: sqlite.db, SIGNOFF_AI_ENCRYPTION_KEY: master });
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
});
afterEach(() => sqlite.close());
export function response(kind = "on_track", action = "investigate") {
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
			readiness: choice(kind, ["on_track", "attention", "unknown"]),
			action: choice(action, Object.keys(ACTIONS)),
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
	expect(await runAiOnce(env(), now, fetcher)).toEqual({ processed: false });
	await setup();
	await runAiOnce(env(), now, fetcher);
	expect(evaluationOutput(row(), true).kind).toBe("on_track");
	expect(evaluationOutput(row(), false).status).toBe("not_watched");
	await runAiOnce(env(), now + 1, fetcher);
	change("observedAt", now + 1);
	expect(evaluationOutput(row(), true).current).toBeNull();
	await runAiOnce(env(), now + 1, fetcher);
	expect(calls).toBe(1);
	change("headSha", "new-head");
	expect(evaluationOutput(row(), true).previous?.kind).toBe("on_track");
	await runAiOnce(env(), now + 2, fetcher);
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
	await runAiOnce(env(), now + 3, fetcher);
	expect(calls).toBe(3);
	expect(row().status).toBe("complete");
	await runAiOnce(env(), now + 1300, fetcher);
	expect(calls).toBe(4);
});
test.each([
	"facts",
	"instructions",
	"key",
	"unwatch",
	"rewatch",
])("late response cannot overwrite newer %s", async (mode) => {
	const watch = await setup();
	let release: (value: Response) => void = () => {};
	let entered: () => void = () => {};
	const started = new Promise<void>((r) => {
		entered = r;
	});
	const request = runAiOnce(env(), now, (async () => {
		entered();
		return new Promise<Response>((r) => {
			release = r;
		});
	}) as unknown as typeof fetch);
	await started;
	expect(await runAiOnce(env(), now)).toEqual({ processed: false });
	if (mode === "facts") change("headSha", "superseded");
	if (mode === "instructions")
		sqlite.raw.query("UPDATE projects SET policy_context_json=?").run(
			JSON.stringify({
				default: [{ gateId: "merge-conflicts", description: "Changed" }],
				repositories: {},
			}),
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
		expect(await runAiOnce(env(), now + 3)).toEqual({ processed: false });
	else {
		await runAiOnce(env(), now + 3, (async () =>
			response("attention", "review")) as unknown as typeof fetch);
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
	await runAiOnce(env(), now, fail);
	expect(row().status).toBe("pending");
	await runAiOnce(env(), now + 1, fail);
	expect(calls).toBe(1);
	await runAiOnce(env(), now + 5, fail);
	await runAiOnce(env(), now + 15, fail);
	expect(row().status).toBe("error");
	change("observedAt", now + 16);
	await runAiOnce(env(), now + 16, fail);
	expect(calls).toBe(3);
	expect(evaluationOutput(row(), true)).toMatchObject({
		kind: "error",
		current: null,
	});
	change("headSha", "changed");
	await runAiOnce(env(), now + 17, (async () =>
		response("unknown")) as unknown as typeof fetch);
	expect(evaluationOutput(row(), true).kind).toBe("unknown");
});
test("missing key is an operational error, never a rule judgment or repeated request", async () => {
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now);
	await runAiOnce(env(), now);
	expect(row().error).toContain("missing_key");
	change("observedAt", now + 1);
	expect(await runAiOnce(env(), now + 1)).toEqual({ processed: false });
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
		"on_track",
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
		"conflict and queue",
		"queued",
		"queued",
		false,
		true,
		"complete",
		"conflicts",
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
		"unknown",
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
		"on_track",
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
		"unknown",
		null,
	],
] as const)("typed Jev judgment is authoritative for %s", async (_name, buildState, stageState, expired, required, coverage, mergeable, kind, action) => {
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
	await runAiOnce(env(), now, (async (_url: string, init?: RequestInit) => {
		const state = JSON.parse(String(init?.body)).state;
		expect(state.policies[0].evidence).toMatchObject({
			isExpired: expired,
			buildIsNotCurrent: true,
		});
		expect(state.policiesInPriorityOrder[0].description).toBeTruthy();
		expect(JSON.stringify(state)).not.toContain("Generated action");
		return response(kind, action ?? "investigate");
	}) as unknown as typeof fetch);
	expect(evaluationOutput(row(), true).current).toMatchObject({ kind, action });
});
