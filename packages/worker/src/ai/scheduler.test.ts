import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { CLASSIFICATION, JEV_MODEL } from "@signoff/domain/ai-readiness";
import { addObservation, removeObservation } from "../monitoring/observations";
import { parseQuery, queryObservations, queryPulls } from "../monitoring/query";
import { PR_TEST_NOW as now, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { type EvaluationRow, evaluationOutput } from "./decision";
import { evaluateJev } from "./jev";
import { runAiOnce } from "./scheduler";
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
export function response(kind = "running") {
	return Response.json({
		model: JEV_MODEL,
		usage: { input_tokens: 100, output_tokens: 10 },
		answers: {
			readiness: {
				type: "choice",
				choice: kind,
				probabilities: Object.fromEntries(
					Object.keys(CLASSIFICATION).map((k) => [k, Number(k === kind)]),
				),
				confidence: 1,
			},
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
function change(field: string, value: unknown, id = "pull-1") {
	sqlite.raw
		.query(
			"UPDATE pull_requests SET snapshot=json_set(snapshot,?,json(?)) WHERE id=?",
		)
		.run(`$.${field}`, JSON.stringify(value), id);
}
const fake = (
	callback: (
		_url: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response> | Response,
) => callback as typeof fetch;
const tick = (at = now, fetcher: typeof fetch = fake(() => response())) =>
	runAiOnce(env(), "cli", at, fetcher);

test("only watched valid evidence evaluates and unchanged semantic states never pay again", async () => {
	let calls = 0;
	const fetcher = fake((_url, init) => {
		calls++;
		const body = JSON.parse(String(init?.body));
		expect(Object.keys(body.questions)).toEqual(["readiness"]);
		expect(body.state).not.toHaveProperty("prs");
		expect(JSON.stringify(body.state)).not.toContain("stages");
		return response();
	});
	expect(await tick(now, fetcher)).toEqual({ processed: false });
	await setup();
	await tick(now, fetcher);
	expect(evaluationOutput(row(), true).kind).toBe("running");
	for (const time of [1, 301, 10000]) {
		change("observedAt", now + time);
		change("title", `new title ${time}`);
		change("builds[0].stages[0].detail", "Different failure detail");
		await tick(now + time, fetcher);
	}
	expect(calls).toBe(1);
	expect(
		sqlite.raw.query("SELECT count(*) n FROM ai_decision_cache").get(),
	).toEqual({ n: 1 });
	change("draft", true);
	await tick(now + 10001, fetcher);
	expect(calls).toBe(2);
});

test("per-PR cooldown starts at completion; another PR is independent", async () => {
	await setup();
	let clock = now * 1000,
		calls = 0;
	const timer = spyOn(Date, "now").mockImplementation(() => clock);
	const fetcher = fake(() => {
		calls++;
		clock += 12000;
		return response();
	});
	try {
		await tick(now, fetcher);
		change("draft", true);
		clock = (now + 300) * 1000;
		expect(await tick(now + 300, fetcher)).toEqual({ processed: false });
		seedPull(sqlite, {
			id: "pull-2",
			number: 2,
			externalId: "2",
			coverage: "partial",
		});
		await addObservation(sqlite.db, "cli", { pullId: "pull-2" }, now + 300);
		await tick(now + 300, fetcher);
		expect(calls).toBe(2);
		clock = (now + 312) * 1000;
		await tick(now + 312, fetcher);
		expect(calls).toBe(3);
	} finally {
		timer.mockRestore();
	}
});

test("database preparation time cannot shorten completion cooldown", async () => {
	await setup();
	let clock = now * 1000,
		prepared = false,
		calls = 0;
	const timer = spyOn(Date, "now").mockImplementation(() => clock);
	const original = sqlite.db.prepare.bind(sqlite.db);
	const prepare = spyOn(sqlite.db, "prepare").mockImplementation((sql) => {
		if (!prepared && sql === "SELECT * FROM projects WHERE source=?") {
			prepared = true;
			clock += 7000;
		}
		return original(sql);
	});
	const fetcher = fake(() => {
		calls++;
		clock += 12000;
		return response();
	});
	try {
		await tick(now, fetcher);
		expect(row().last_completed_at).toBe(now + 19);
		change("draft", true);
		clock = (now + 318) * 1000;
		await tick(now + 318, fetcher);
		expect(calls).toBe(1);
		clock = (now + 319) * 1000;
		await tick(now + 319, fetcher);
		expect(calls).toBe(2);
	} finally {
		prepare.mockRestore();
		timer.mockRestore();
	}
});

test("same-project evidence shares persistent cache across PRs, rewatch and A-B-A transitions", async () => {
	const watch = await setup();
	let calls = 0;
	const fetcher = fake(() => {
		calls++;
		return response();
	});
	seedPull(sqlite, { id: "pull-2", number: 2, externalId: "2" });
	await addObservation(sqlite.db, "cli", { pullId: "pull-2" }, now);
	await tick(now, fetcher);
	expect(calls).toBe(1);
	expect(
		sqlite.raw
			.query("SELECT count(*) n FROM ai_evaluations WHERE status='complete'")
			.get(),
	).toEqual({ n: 2 });
	change("draft", true);
	await tick(now + 301, fetcher);
	expect(calls).toBe(2);
	change("draft", false);
	await tick(now + 302, fetcher);
	expect(calls).toBe(2);
	expect(JSON.parse(row().result_json ?? "{}").reusedAt).toBeTruthy();
	await removeObservation(
		sqlite.db,
		"cli",
		watch.id,
		watch.generation,
		now + 303,
	);
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now + 304);
	await sqlite.db
		.prepare("UPDATE ai_settings SET encrypted_key=NULL,revision=revision+1")
		.run();
	await tick(now + 304, fetcher);
	expect(calls).toBe(2);
	expect(row().generation).toBe(2);
	expect(row().status).toBe("complete");
	seedProject(sqlite, {
		id: "other-project",
		projectKey: "Other",
		repositories: [],
	});
	seedPull(sqlite, {
		id: "other-pull",
		projectId: "other-project",
		number: 3,
		externalId: "3",
	});
	await addObservation(sqlite.db, "cli", { pullId: "other-pull" }, now + 305);
	await sqlite.db
		.prepare("UPDATE ai_settings SET encrypted_key=?,revision=revision+1")
		.bind(await sealKey("test-key", master))
		.run();
	await tick(now + 305, fetcher);
	expect(calls).toBe(3);
});

test("independent evidence requests run concurrently with a fixed bound", async () => {
	await setup();
	for (let i = 2; i <= 4; i++) {
		seedPull(sqlite, {
			id: `p${i}`,
			externalId: String(i),
			number: i,
			requiredApprovals: i + 3,
		});
		await addObservation(sqlite.db, "cli", { pullId: `p${i}` }, now);
	}
	let active = 0,
		peak = 0,
		calls = 0;
	const fetcher = fake(async () => {
		active++;
		calls++;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 10));
		active--;
		return response();
	});
	await tick(now, fetcher);
	expect(calls).toBe(3);
	expect(peak).toBe(3);
	await tick(now + 1, fetcher);
	expect(calls).toBe(4);
});

test.each([
	"conflicts",
	"feature",
	"missing",
	"invalidated",
])("%s bypasses Jev before inference", async (kind) => {
	await setup();
	if (kind === "conflicts") change("mergeable", "conflicts");
	if (kind === "feature") change("targetBranch", "feature/test");
	if (kind === "missing") change("checksObservedAt", null);
	if (kind === "invalidated") change("checksInvalidated", true);
	let calls = 0;
	await tick(
		now,
		fake(() => {
			calls++;
			return response();
		}),
	);
	expect(calls).toBe(0);
	const result = await queryObservations(
		sqlite.db,
		"cli",
		parseQuery(new URLSearchParams()),
		now,
	);
	expect(
		(Array.isArray(result.data) ? result.data[0] : result.data)?.readiness
			.phase,
	).toBe(["missing", "invalidated"].includes(kind) ? "collecting" : "decided");
	if (kind === "conflicts")
		expect(
			(Array.isArray(result.data) ? result.data[0] : result.data)?.readiness
				.state,
		).toBe("conflict");
	if (kind === "feature")
		expect(
			(Array.isArray(result.data) ? result.data[0] : result.data)?.readiness
				.state,
		).toBe("skipped");
});

test.each([
	"facts",
	"rules",
	"watch",
	"key",
	"clock",
	"stage",
])("late response handles %s changes without exposing obsolete judgments", async (kind) => {
	const watch = await setup();
	await tick(
		now,
		fake(async () => {
			if (kind === "facts") change("draft", true);
			if (kind === "rules")
				sqlite.raw
					.query(
						"INSERT INTO ai_rules(scope,revision,text) VALUES('common',1,'Review carefully')",
					)
					.run();
			if (kind === "watch") {
				await removeObservation(
					sqlite.db,
					"cli",
					watch.id,
					watch.generation,
					now + 1,
				);
				await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now + 2);
			}
			if (kind === "key")
				sqlite.raw.query("UPDATE ai_settings SET revision=revision+1").run();
			if (kind === "clock") change("observedAt", now + 2);
			if (kind === "stage")
				change("builds[0].stages[0].detail", "A different task failed");
			return response("attention");
		}),
	);
	expect(row().status).toBe(
		["clock", "stage"].includes(kind) ? "complete" : "pending",
	);
	if (!["clock", "stage"].includes(kind)) expect(row().result_json).toBeNull();
});

test("read-only HTTP projections share currentness before scheduler reconciliation", async () => {
	await setup();
	await tick();
	change("draft", true);
	const observation = await queryObservations(
		sqlite.db,
		"cli",
		parseQuery(new URLSearchParams()),
		now + 1,
	);
	expect(
		(Array.isArray(observation.data) ? observation.data[0] : observation.data)
			?.readiness,
	).toMatchObject({
		state: "running",
		isCurrent: false,
		phase: "queued",
	});
	const list = await queryPulls(
		sqlite.db,
		"cli",
		parseQuery(new URLSearchParams("draft=include")),
		now + 1,
	);
	expect(list.data[0]?.readiness).toMatchObject({
		status: "pending",
		previous: { kind: "running" },
		current: null,
	});
});

test("policy instructions change only their project input and revert through cache", async () => {
	await setup();
	let calls = 0;
	const fetcher = fake(() => {
		calls++;
		return response("review_needed");
	});
	await tick(now, fetcher);
	sqlite.raw
		.query(
			"INSERT INTO ai_rules(scope,revision,text) VALUES('unrelated',1,'irrelevant')",
		)
		.run();
	await tick(now + 1, fetcher);
	expect(calls).toBe(1);
	sqlite.raw
		.query(
			"INSERT INTO ai_rules(scope,revision,text) VALUES('live-project',1,'Optional failures are expected')",
		)
		.run();
	await tick(now + 301, fetcher);
	expect(calls).toBe(2);
	sqlite.raw
		.query("UPDATE ai_rules SET text='' WHERE scope='live-project'")
		.run();
	await tick(now + 302, fetcher);
	expect(calls).toBe(2);
});

test("bounded retries respect cooldown and exhausted operational errors are not cacheable judgments", async () => {
	await setup();
	let calls = 0;
	const fetcher = fake(() => {
		calls++;
		return new Response("private upstream data", { status: 503 });
	});
	for (const time of [0, 301, 602]) await tick(now + time, fetcher);
	expect(row().status).toBe("error");
	expect(row().attempts).toBe(3);
	expect(row().result_json).toBeNull();
	await tick(now + 2000, fetcher);
	expect(calls).toBe(3);
	expect(
		sqlite.raw.query("SELECT count(*) n FROM ai_decision_cache").get(),
	).toEqual({ n: 0 });
	expect(row().error).not.toContain("private upstream data");
});

test("missing credentials fail operationally and a restored key retries without resetting facts", async () => {
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now);
	await tick();
	expect(evaluationOutput(row(), true).kind).toBe("error");
	await sqlite.db
		.prepare("UPDATE ai_settings SET encrypted_key=?,revision=revision+1")
		.bind(await sealKey("test-key", master))
		.run();
	await tick(now + 301);
	expect(row().status).toBe("complete");
});

test.each(
	Object.keys(CLASSIFICATION) as (keyof typeof CLASSIFICATION)[],
)("Jev's valid %s choice is authoritative", async (kind) => {
	await setup();
	await tick(
		now,
		fake(() => response(kind)),
	);
	expect(evaluationOutput(row(), true).current?.kind).toBe(kind);
});

test("encrypts at rest and rejects missing, corrupt or unavailable credentials", async () => {
	const encrypted = await sealKey("test-key", master);
	expect(encrypted).not.toContain("test-key");
	expect(await openKey(encrypted, master)).toBe("test-key");
	await expect(openKey(null, master)).rejects.toThrow("Configure");
	await expect(openKey("bad", master)).rejects.toThrow("cannot be decrypted");
	await expect(sealKey("key", "invalid")).rejects.toThrow("not configured");
	await expect(openKey(encrypted, undefined)).rejects.toThrow("not configured");
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

test("a publication between semantic recheck and result write is fenced and retains completion cooldown", async () => {
	await setup();
	let clock = now * 1000,
		calls = 0,
		intercept = true;
	const time = spyOn(Date, "now").mockImplementation(() => clock);
	const original = sqlite.db.prepare.bind(sqlite.db);
	const prepare = spyOn(sqlite.db, "prepare").mockImplementation((sql) => {
		if (
			intercept &&
			sql.startsWith("UPDATE ai_evaluations SET status=?,result_json=?")
		) {
			intercept = false;
			change("draft", true);
		}
		return original(sql);
	});
	const fetcher = fake(() => {
		calls++;
		clock += 12000;
		return response();
	});
	try {
		await tick(now, fetcher);
		expect(row().result_json).toBeNull();
		expect(row().last_completed_at).toBe(now + 12);
		clock = (now + 311) * 1000;
		await tick(now + 311, fetcher);
		expect(calls).toBe(1);
		clock = (now + 312) * 1000;
		await tick(now + 312, fetcher);
		expect(calls).toBe(2);
	} finally {
		prepare.mockRestore();
		time.mockRestore();
	}
});

test("a simultaneous tick cannot duplicate a leased request or evaluate another data source", async () => {
	await setup();
	let calls = 0;
	const fetcher = fake(async () => {
		calls++;
		expect(await tick(now)).toEqual({ processed: false });
		return response();
	});
	await tick(now, fetcher);
	expect(calls).toBe(1);
	expect(await runAiOnce(env(), "demo", now, fetcher)).toEqual({
		processed: false,
	});
	expect(calls).toBe(1);
});

test("removing credentials before claiming prevents an old configuration from sending", async () => {
	await setup();
	let changed = false,
		calls = 0;
	const original = sqlite.db.prepare.bind(sqlite.db);
	const prepare = spyOn(sqlite.db, "prepare").mockImplementation((sql) => {
		if (!changed && sql === "SELECT * FROM projects WHERE source=?") {
			changed = true;
			sqlite.raw
				.query("UPDATE ai_settings SET encrypted_key=NULL,revision=revision+1")
				.run();
		}
		return original(sql);
	});
	try {
		expect(
			await tick(
				now,
				fake(() => {
					calls++;
					return response();
				}),
			),
		).toEqual({ processed: false });
		expect(calls).toBe(0);
		expect(row().status).toBe("pending");
	} finally {
		prepare.mockRestore();
	}
});
