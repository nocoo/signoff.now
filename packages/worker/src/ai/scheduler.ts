import {
	AI_LABELS,
	type AiReadiness,
	type DecisionState,
	decisionFingerprint,
	decisionState,
	isMainTarget,
	jevResultSchema,
	NEXT_ACTIONS,
	presentReadiness,
} from "@signoff/domain/ai-readiness";
import type { DataSource } from "@signoff/domain/monitoring";
import { type PullRequest, pullRequestSchema } from "@signoff/domain/workbench";
import { measuredJevFetch } from "../monitoring/network.js";
import { mapProject, type ProjectRow } from "../monitoring/store.js";
import type { Bindings } from "../types.js";
import { batchFits, evaluateJevBatch, JevError } from "./jev.js";
import { numberPolicies } from "./policy-codes.js";
import { readAiRules } from "./rules.js";
import { openKey } from "./secrets.js";
export type EvaluationRow = {
	observation_id: string;
	generation: number;
	input_revision: number;
	status: string;
	fingerprint: string | null;
	config_revision: number | null;
	result_json: string | null;
	previous_json: string | null;
	error: string | null;
	attempts: number;
	not_before: number;
	lease_token: string | null;
};
export function evaluationOutput(
	row: EvaluationRow | undefined,
	active: boolean,
	pull?: Pick<PullRequest, "mergeable" | "targetBranch">,
): AiReadiness {
	if (pull && !isMainTarget(pull))
		return {
			...presentReadiness("complete"),
			kind: "skipped",
			label: AI_LABELS.skipped,
			nextAction: NEXT_ACTIONS.skipped,
		};
	if (!active) return presentReadiness("not_watched");
	if (pull?.mergeable === "conflicts")
		return {
			...presentReadiness("complete"),
			kind: "conflict",
			label: "Conflict",
			nextAction: "Resolve the merge conflict.",
		};
	const parse = (value: string | null | undefined) =>
		value ? jevResultSchema.parse(JSON.parse(value)) : null;
	const status =
		row?.status === "complete"
			? "complete"
			: row?.status === "error"
				? "error"
				: row?.status === "running"
					? "running"
					: "pending";
	return presentReadiness(
		status,
		parse(row?.result_json),
		row?.error ?? null,
		parse(row?.previous_json ?? row?.result_json),
	);
}
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

type Candidate = {
	row: EvaluationRow;
	pull: ReturnType<typeof pullRequestSchema.parse>;
	state: DecisionState;
	fingerprint: string;
	attempt: number;
};
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
		const rules = await readAiRules(db);
		const [projects, watches, cadence] = await db.batch([
			db.prepare(
				"SELECT p.* FROM projects p LEFT JOIN ai_project_schedule s ON s.project_id=p.id ORDER BY COALESCE(s.last_started_at,0),p.id",
			),
			db.prepare(
				`SELECT e.*,o.project_id,pr.snapshot FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id AND o.generation=e.generation AND o.active=1 JOIN pull_requests pr ON pr.id=o.pull_id ORDER BY e.updated_at,e.observation_id`,
			),
			db.prepare(
				"SELECT cooldown_seconds FROM collection_refresh WHERE kind='details'",
			),
		]);
		const detailCooldown = (cadence?.results[0] as { cooldown_seconds: number })
			.cooldown_seconds;
		for (const projectRow of projects?.results as ProjectRow[]) {
			if (projectRow.source !== source) continue;
			const project = mapProject(projectRow);
			const candidates = await readCandidates(
				db,
				watches?.results as WatchRow[],
				projectRow,
				settings,
				now,
				detailCooldown,
				{
					common: rules.common.text,
					project: rules.projects.find((p) => p.id === project.id)?.text ?? "",
				},
			);
			if (!candidates.length) continue;
			const selected: Candidate[] = [];
			for (const candidate of candidates) {
				if (
					selected.length &&
					!batchFits([...selected, candidate].map((c) => c.state))
				)
					break;
				selected.push(candidate);
			}
			const reservation = await db
				.prepare(`INSERT INTO ai_project_schedule(project_id,last_started_at,last_batch_size) VALUES(?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET last_started_at=excluded.last_started_at,last_batch_size=excluded.last_batch_size
    WHERE MAX(COALESCE(ai_project_schedule.last_completed_at,0),COALESCE(ai_project_schedule.last_started_at,0))+(SELECT cooldown_seconds FROM ai_settings WHERE id=1)<=?`)
				.bind(project.id, now, selected.length, now)
				.run();
			if (!reservation.meta.changes) continue;
			const claimed: Candidate[] = [];
			for (const c of selected) {
				const claim = await db
					.prepare(
						`UPDATE ai_evaluations SET status='running',fingerprint=?,config_revision=?,result_json=NULL,previous_json=COALESCE(result_json,previous_json),error=NULL,attempts=?,lease_token=?,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND status<>'canceled'`,
					)
					.bind(
						c.fingerprint,
						settings.revision,
						c.attempt,
						token,
						now,
						c.row.observation_id,
						c.row.generation,
						c.row.input_revision,
					)
					.run();
				if (claim.meta.changes) claimed.push(c);
			}
			await evaluateClaims(
				env,
				settings,
				project.id,
				claimed,
				token,
				now,
				started,
				fetcher,
			);
			return { processed: true };
		}
		return { processed: false };
	} finally {
		await db
			.prepare(
				"UPDATE ai_settings SET runner_token=NULL,runner_expires=NULL WHERE id=1 AND runner_token=?",
			)
			.bind(token)
			.run();
	}
}
function fence(c: Candidate, token: string) {
	return [c.row.observation_id, c.row.generation, c.row.input_revision, token];
}
async function failClaim(
	db: D1Database,
	c: Candidate,
	token: string,
	error: unknown,
	now: number,
) {
	const failure =
		error instanceof JevError
			? error
			: new JevError("internal", "Jev evaluation could not be completed.");
	const retry = failure.transient && c.attempt < 3;
	await db
		.prepare(
			"UPDATE ai_evaluations SET status=?,attempts=?,error=?,not_before=?,lease_token=NULL,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND lease_token=?",
		)
		.bind(
			retry ? "pending" : "error",
			retry ? c.attempt : 3,
			`${failure.code}: ${failure.message}`,
			now + Math.max(failure.retryAfter, 5 * 2 ** (c.attempt - 1)),
			now,
			...fence(c, token),
		)
		.run();
}

type WatchRow = EvaluationRow & { project_id: string; snapshot: string };
async function readCandidates(
	db: D1Database,
	rows: WatchRow[],
	projectRow: ProjectRow,
	settings: SettingsRow,
	now: number,
	detailCooldown: number,
	rules: { common: string; project: string },
) {
	const project = mapProject(projectRow),
		candidates: Candidate[] = [];
	const inputs = rows
		.filter((row) => row.project_id === project.id)
		.map((row) => ({
			row,
			pull: pullRequestSchema.parse(JSON.parse(row.snapshot)),
		}))
		.filter(({ pull }) => isMainTarget(pull) && pull.mergeable !== "conflicts")
		.map((item) => ({
			...item,
			state: decisionState(item.pull, project, now, detailCooldown, rules),
		}));
	const codes = await numberPolicies(
		db,
		project.id,
		inputs.flatMap((item) => item.state.policiesInPriorityOrder),
	);
	for (const { row, pull, state } of inputs) {
		for (const gate of state.policiesInPriorityOrder)
			gate.code = codes.get(gate.id) ?? gate.code;
		const fingerprint = await decisionFingerprint(state);
		const unchanged =
			row.fingerprint === fingerprint &&
			row.config_revision === settings.revision;
		if (unchanged && (row.result_json || row.attempts >= 3)) {
			const status = row.result_json ? "complete" : "error";
			if (row.status !== status)
				await db
					.prepare(
						"UPDATE ai_evaluations SET status=?,lease_token=NULL WHERE observation_id=? AND generation=? AND input_revision=?",
					)
					.bind(status, row.observation_id, row.generation, row.input_revision)
					.run();
			continue;
		}
		if (unchanged && row.not_before > now) continue;
		if (!unchanged && row.status === "complete") {
			const changed = await db
				.prepare(
					"UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,previous_json=COALESCE(result_json,previous_json) WHERE observation_id=? AND generation=? AND input_revision=?",
				)
				.bind(row.observation_id, row.generation, row.input_revision)
				.run();
			if (!changed.meta.changes) continue;
			row.input_revision++;
		}
		candidates.push({
			row,
			pull,
			state,
			fingerprint,
			attempt: unchanged ? row.attempts + 1 : 1,
		});
	}
	return candidates;
}

async function evaluateClaims(
	env: Bindings,
	settings: SettingsRow,
	projectId: string,
	claimed: Candidate[],
	token: string,
	now: number,
	started: number,
	fetcher: typeof fetch,
) {
	const db = env.DB;
	let usage: { input_tokens: number; output_tokens: number } | undefined;
	try {
		if (claimed.length) {
			if (!batchFits(claimed.map((c) => c.state)))
				throw new JevError(
					"input_too_large",
					"PR evidence exceeds the batch input budget; no evidence was truncated.",
				);
			const key = await openKey(
				settings.encrypted_key,
				env.SIGNOFF_AI_ENCRYPTION_KEY,
			);
			const evaluated = await evaluateJevBatch(
				key,
				claimed,
				now,
				measuredJevFetch(db, fetcher),
			);
			usage = evaluated.usage;
			for (const [index, c] of claimed.entries()) {
				const answer = evaluated.results[index];
				if (answer?.result) {
					await db
						.prepare(
							"UPDATE ai_evaluations SET status='complete',result_json=?,previous_json=NULL,error=NULL,lease_token=NULL,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND lease_token=?",
						)
						.bind(
							JSON.stringify({
								...answer.result,
								evaluatedAt: new Date(
									(now + Math.floor((Date.now() - started) / 1000)) * 1000,
								).toISOString(),
								observations: {
									summaryAt: c.pull.summaryObservedAt ?? c.pull.observedAt,
									checksAt:
										c.pull.checksObservedAt === undefined
											? c.pull.observedAt
											: c.pull.checksObservedAt,
								},
							}),
							now,
							...fence(c, token),
						)
						.run();
				} else await failClaim(db, c, token, answer?.error, now);
			}
		}
	} catch (error) {
		for (const c of claimed) await failClaim(db, c, token, error, now);
	} finally {
		await db
			.prepare(
				"UPDATE ai_project_schedule SET last_completed_at=?,input_tokens=?,output_tokens=? WHERE project_id=?",
			)
			.bind(
				now + Math.floor((Date.now() - started) / 1000),
				usage?.input_tokens ?? null,
				usage?.output_tokens ?? null,
				projectId,
			)
			.run();
	}
}
