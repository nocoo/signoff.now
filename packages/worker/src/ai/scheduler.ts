import {
	canonicalJson,
	type DecisionState,
	decisionFingerprint,
	type jevResultSchema,
	policyCatalog,
	readinessShortcut,
} from "@signoff/domain/ai-readiness";
import type { DataSource } from "@signoff/domain/monitoring";
import { checksValidity } from "@signoff/domain/state-machine";
import { pullRequestSchema } from "@signoff/domain/workbench";
import { measuredJevFetch } from "../monitoring/network.js";
import { mapProject, type ProjectRow } from "../monitoring/store.js";
import type { Bindings } from "../types.js";
import {
	decisionContext,
	decisionContextQueries,
	type EvaluationRow,
	inputState,
	nextEligibleAt,
} from "./decision.js";
import { evaluateJev, JevError } from "./jev.js";
import { numberPolicies } from "./policy-codes.js";
import { openKey } from "./secrets.js";
export type SettingsRow = {
	encrypted_key: string | null;
	revision: number;
	tested_at: number | null;
	test_state: "untested" | "valid" | "error";
	test_error: string | null;
};
export const readAiSettings = async (db: D1Database) => {
	const row = await db
		.prepare(
			"SELECT encrypted_key,revision,tested_at,test_state,test_error FROM ai_settings WHERE id=1",
		)
		.first<SettingsRow>();
	if (!row) throw new Error("AI settings storage is unavailable");
	return row;
};

type WatchRow = EvaluationRow & { project_id: string; snapshot: string };
type Candidate = {
	row: WatchRow;
	state: DecisionState;
	stateJson: string;
	fingerprint: string;
	attempt: number;
};
const CONCURRENCY = 3;

async function readWork(db: D1Database, source: DataSource) {
	const [projects, watches, ...rest] = await db.batch([
		db.prepare("SELECT * FROM projects WHERE source=?").bind(source),
		db
			.prepare(
				`SELECT e.*,o.project_id,pr.snapshot FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id AND o.generation=e.generation AND o.active=1 JOIN pull_requests pr ON pr.id=o.pull_id WHERE o.source=? ORDER BY COALESCE(e.last_started_at,0),e.updated_at,e.observation_id`,
			)
			.bind(source),
		...decisionContextQueries(db),
	]);
	return {
		projects: new Map(
			(projects?.results as ProjectRow[]).map((r) => [r.id, mapProject(r)]),
		),
		rows: watches?.results as WatchRow[],
		context: decisionContext(rest),
	};
}
async function candidates(db: D1Database, source: DataSource, now: number) {
	const work = await readWork(db, source);
	for (const project of work.projects.values()) {
		const pulls = work.rows
			.filter((r) => r.project_id === project.id)
			.map((r) => pullRequestSchema.parse(JSON.parse(r.snapshot)));
		const codes = await numberPolicies(
			db,
			project.id,
			policyCatalog(project, pulls),
		);
		for (const [id, code] of codes)
			work.context.codes.set(`${project.id}:${id}`, code);
	}
	const inputs = await Promise.all(
		work.rows.map(async (row) => {
			const project = work.projects.get(row.project_id);
			const pull = pullRequestSchema.parse(JSON.parse(row.snapshot));
			if (
				!project ||
				readinessShortcut(pull, true) ||
				checksValidity(pull) !== "valid"
			)
				return null;
			const state = inputState(pull, project, work.context),
				stateJson = canonicalJson(state);
			return {
				row,
				state,
				stateJson,
				fingerprint: await decisionFingerprint(state),
				attempt: 1,
			};
		}),
	);
	const prepared = inputs.filter((c): c is Candidate => c !== null);
	const cache = await db
		.prepare(
			`SELECT project_id,fingerprint,result_json FROM ai_decision_cache WHERE json_array(project_id,fingerprint) IN (SELECT value FROM json_each(?))`,
		)
		.bind(
			JSON.stringify(prepared.map((c) => [c.row.project_id, c.fingerprint])),
		)
		.all<{ project_id: string; fingerprint: string; result_json: string }>();
	const cached = new Map(
		cache.results.map((c) => [
			cacheKey(c.project_id, c.fingerprint),
			c.result_json,
		]),
	);
	const ready: Candidate[] = [];
	for (const c of prepared) {
		const { row, fingerprint, stateJson } = c;
		const same = row.fingerprint === fingerprint;
		const saved = same
			? (row.result_json ?? cached.get(cacheKey(row.project_id, fingerprint)))
			: cached.get(cacheKey(row.project_id, fingerprint));
		if (saved) {
			if (row.status !== "complete" || !same)
				await db
					.prepare(
						`UPDATE ai_evaluations SET status='complete',fingerprint=?,state_json=?,config_revision=?,result_json=?,previous_json=NULL,error=NULL,attempts=0,not_before=0,lease_token=NULL,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND status<>'canceled'`,
					)
					.bind(
						fingerprint,
						stateJson,
						work.context.settings.revision,
						JSON.stringify({
							...JSON.parse(saved),
							reusedAt: new Date(now * 1000).toISOString(),
						}),
						now,
						row.observation_id,
						row.generation,
						row.input_revision,
					)
					.run();
			continue;
		}
		if (!same) {
			const change = await db
				.prepare(
					`UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,fingerprint=?,state_json=?,config_revision=?,previous_json=COALESCE(result_json,previous_json),result_json=NULL,error=NULL,attempts=0,not_before=0,lease_token=NULL WHERE observation_id=? AND generation=? AND input_revision=? AND status<>'canceled'`,
				)
				.bind(
					fingerprint,
					stateJson,
					work.context.settings.revision,
					row.observation_id,
					row.generation,
					row.input_revision,
				)
				.run();
			if (!change.meta.changes) continue;
			row.input_revision++;
			row.attempts = 0;
			row.not_before = 0;
		}
		const sameConfig = row.config_revision === work.context.settings.revision;
		if (
			(same && sameConfig && row.attempts >= 3) ||
			nextEligibleAt(row, work.context.settings.cooldown_seconds) > now
		)
			continue;
		c.attempt = same && sameConfig ? row.attempts + 1 : 1;
		ready.push(c);
	}
	return ready;
}
const cacheKey = (project: string, fingerprint: string) =>
	`${project}:${fingerprint}`;
export async function runAiOnce(
	env: Bindings,
	source: DataSource,
	now = Math.floor(Date.now() / 1000),
	fetcher: typeof fetch = fetch,
) {
	const db = env.DB,
		token = crypto.randomUUID(),
		started = Date.now();
	const lock = await db
		.prepare(
			"UPDATE ai_settings SET runner_token=?,runner_expires=? WHERE id=1 AND (runner_token IS NULL OR runner_expires<=?)",
		)
		.bind(token, now + 90, now)
		.run();
	if (!lock.meta.changes) return { processed: false };
	try {
		const settings = await readAiSettings(db);
		const groups = new Map<string, Candidate[]>();
		for (const c of await candidates(db, source, now)) {
			const key = cacheKey(c.row.project_id, c.fingerprint);
			const group = groups.get(key);
			if (group) group.push(c);
			else if (groups.size < CONCURRENCY) groups.set(key, [c]);
		}
		const claimed: Candidate[][] = [];
		for (const group of groups.values()) {
			const owned: Candidate[] = [];
			for (const c of group) {
				const claim = await db
					.prepare(
						`UPDATE ai_evaluations SET status='running',config_revision=?,attempts=?,lease_token=?,last_started_at=?,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND status<>'canceled' AND EXISTS(SELECT 1 FROM ai_settings WHERE revision=?)`,
					)
					.bind(
						settings.revision,
						c.attempt,
						token,
						now,
						now,
						c.row.observation_id,
						c.row.generation,
						c.row.input_revision,
						settings.revision,
					)
					.run();
				if (claim.meta.changes) owned.push(c);
			}
			if (owned.length) claimed.push(owned);
		}
		const outcomes = await Promise.allSettled(
			claimed.map((group) =>
				evaluateClaim(
					env,
					settings,
					source,
					group,
					token,
					now,
					started,
					fetcher,
				),
			),
		);
		const failure = outcomes.find((r) => r.status === "rejected");
		if (failure?.status === "rejected") throw failure.reason;
		return { processed: claimed.length > 0 };
	} finally {
		await db
			.prepare(
				"UPDATE ai_settings SET runner_token=NULL,runner_expires=NULL WHERE id=1 AND runner_token=?",
			)
			.bind(token)
			.run();
	}
}
async function evaluateClaim(
	env: Bindings,
	settings: SettingsRow,
	source: DataSource,
	group: Candidate[],
	token: string,
	now: number,
	started: number,
	fetcher: typeof fetch,
) {
	const c = group[0];
	if (!c) return;
	const db = env.DB;
	const completed = () => now + Math.floor((Date.now() - started) / 1000);
	let result: ReturnType<typeof jevResultSchema.parse> | null = null;
	let failure: JevError | null = null;
	let usage: { input_tokens: number; output_tokens: number } | undefined;
	let sent = false;
	try {
		const key = await openKey(
			settings.encrypted_key,
			env.SIGNOFF_AI_ENCRYPTION_KEY,
		);
		sent = true;
		await db
			.prepare(
				`INSERT INTO ai_project_schedule(project_id,last_started_at,request_count) VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET last_started_at=excluded.last_started_at,request_count=request_count+1`,
			)
			.bind(c.row.project_id, now)
			.run();
		const answer = await evaluateJev(
			key,
			c.state,
			c.fingerprint,
			now,
			measuredJevFetch(db, fetcher),
		);
		usage = answer.usage;
		result = {
			...answer.result,
			evaluatedAt: new Date(completed() * 1000).toISOString(),
		};
		await db
			.prepare(
				`INSERT INTO ai_decision_cache(project_id,fingerprint,state_json,result_json,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=?) ON CONFLICT DO NOTHING`,
			)
			.bind(
				c.row.project_id,
				c.fingerprint,
				c.stateJson,
				JSON.stringify(result),
				completed(),
				c.row.project_id,
			)
			.run();
	} catch (error) {
		failure =
			error instanceof JevError
				? error
				: new JevError("internal", "Jev evaluation could not be completed.");
	}
	const latest = await readWork(db, source);
	for (const member of group) {
		const row = latest.rows.find(
			(r) =>
				r.observation_id === member.row.observation_id &&
				r.generation === member.row.generation &&
				r.lease_token === token,
		);
		const project = latest.projects.get(member.row.project_id);
		if (!row || !project) continue;
		const pull = pullRequestSchema.parse(JSON.parse(row.snapshot));
		const current =
			!readinessShortcut(pull, true) &&
			checksValidity(pull) === "valid" &&
			member.stateJson ===
				canonicalJson(inputState(pull, project, latest.context));
		const retry = Boolean(failure?.transient && member.attempt < 3);
		await db
			.prepare(
				`UPDATE ai_evaluations SET status=?,result_json=?,previous_json=CASE WHEN ?=1 THEN NULL ELSE previous_json END,error=?,attempts=?,not_before=?,lease_token=NULL,last_completed_at=?,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND lease_token=? AND EXISTS(SELECT 1 FROM ai_settings WHERE runner_token=?)`,
			)
			.bind(
				!current
					? "pending"
					: result
						? "complete"
						: retry
							? "pending"
							: "error",
				current && result ? JSON.stringify(result) : null,
				Number(current && result !== null),
				current && failure ? `${failure.code}: ${failure.message}` : null,
				!current ? 0 : failure && !retry ? 3 : member.attempt,
				failure && current
					? completed() +
							Math.max(failure.retryAfter, 5 * 2 ** (member.attempt - 1))
					: 0,
				completed(),
				completed(),
				row.observation_id,
				row.generation,
				row.input_revision,
				token,
				token,
			)
			.run();
	}
	await db.batch(
		group.map((member) =>
			db
				.prepare(
					"UPDATE ai_evaluations SET last_completed_at=MAX(COALESCE(last_completed_at,0),?) WHERE observation_id=? AND generation=? AND last_started_at=?",
				)
				.bind(
					completed(),
					member.row.observation_id,
					member.row.generation,
					now,
				),
		),
	);

	if (sent)
		await db
			.prepare(
				"UPDATE ai_project_schedule SET last_completed_at=?,input_tokens=?,output_tokens=? WHERE project_id=? AND COALESCE(last_completed_at,0)<=?",
			)
			.bind(
				completed(),
				usage?.input_tokens ?? null,
				usage?.output_tokens ?? null,
				c.row.project_id,
				completed(),
			)
			.run();
}
