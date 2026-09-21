import {
	type AiReadiness,
	decisionFingerprint,
	decisionState,
	jevResultSchema,
	presentReadiness,
} from "@signoff/domain/ai-readiness";
import { pullRequestSchema } from "@signoff/domain/workbench";
import { mapProject, type ProjectRow } from "../monitoring/store.js";
import type { Bindings } from "../types.js";
import { evaluateJev, JevError } from "./jev.js";
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
): AiReadiness {
	if (!active) return presentReadiness("not_watched");
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
export async function runAiOnce(
	env: Bindings,
	now = Math.floor(Date.now() / 1000),
	fetcher: typeof fetch = fetch,
) {
	const db = env.DB,
		token = crypto.randomUUID();
	const lock = await db
		.prepare(
			"UPDATE ai_settings SET runner_token=?,runner_expires=? WHERE id=1 AND (runner_token IS NULL OR runner_expires<=?)",
		)
		.bind(token, now + 90, now)
		.run();
	if (!lock.meta.changes) return { processed: false };
	try {
		const settings = await readAiSettings(db);
		const [watchRows, projects, intervals] = await db.batch([
			db.prepare(
				`SELECT e.*,o.project_id,pr.snapshot FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id AND o.generation=e.generation AND o.active=1 LEFT JOIN pull_requests pr ON pr.id=o.pull_id ORDER BY e.updated_at,e.observation_id`,
			),
			db.prepare("SELECT * FROM projects"),
			db.prepare(
				"SELECT cooldown_seconds FROM collection_refresh WHERE kind='details'",
			),
		]);
		const cooldown = (intervals?.results[0] as { cooldown_seconds: number })
			.cooldown_seconds;
		for (const row of watchRows?.results as (EvaluationRow & {
			project_id: string;
			snapshot: string | null;
		})[]) {
			if (!row.snapshot) continue;
			const projectRow = (projects?.results as ProjectRow[]).find(
				(p) => p.id === row.project_id,
			);
			if (!projectRow) continue;
			const pull = pullRequestSchema.parse(JSON.parse(row.snapshot));
			const state = decisionState(pull, mapProject(projectRow), now, cooldown);
			const fingerprint = await decisionFingerprint(state);
			const unchanged =
				row.fingerprint === fingerprint &&
				row.config_revision === settings.revision;
			if (unchanged && row.result_json) {
				if (row.status !== "complete")
					await db
						.prepare(
							"UPDATE ai_evaluations SET status='complete',error=NULL,lease_token=NULL WHERE observation_id=? AND generation=? AND input_revision=?",
						)
						.bind(row.observation_id, row.generation, row.input_revision)
						.run();
				continue;
			}
			if (unchanged && row.attempts >= 3) {
				if (row.status !== "error")
					await db
						.prepare(
							"UPDATE ai_evaluations SET status='error' WHERE observation_id=? AND generation=? AND input_revision=?",
						)
						.bind(row.observation_id, row.generation, row.input_revision)
						.run();
				continue;
			}
			if (unchanged && row.not_before > now) continue;
			const attempt = unchanged ? row.attempts + 1 : 1;
			const claim = await db
				.prepare(
					`UPDATE ai_evaluations SET status='running',fingerprint=?,config_revision=?,result_json=NULL,previous_json=COALESCE(result_json,previous_json),error=NULL,attempts=?,lease_token=?,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND status<>'canceled'`,
				)
				.bind(
					fingerprint,
					settings.revision,
					attempt,
					token,
					now,
					row.observation_id,
					row.generation,
					row.input_revision,
				)
				.run();
			if (!claim.meta.changes) continue;
			const fence = [
				row.observation_id,
				row.generation,
				row.input_revision,
				token,
			];
			await evaluateClaim(
				env,
				settings,
				pull,
				state,
				fingerprint,
				fetcher,
				now,
				attempt,
				fence,
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

async function evaluateClaim(
	env: Bindings,
	settings: SettingsRow,
	pull: ReturnType<typeof pullRequestSchema.parse>,
	state: unknown,
	fingerprint: string,
	fetcher: typeof fetch,
	now: number,
	attempt: number,
	fence: (string | number)[],
) {
	const db = env.DB;
	try {
		const key = await openKey(
			settings.encrypted_key,
			env.SIGNOFF_AI_ENCRYPTION_KEY,
		);
		const result = await evaluateJev(
			key,
			state,
			fingerprint,
			Math.floor(Date.now() / 1000),
			fetcher,
		);
		await db
			.prepare(
				"UPDATE ai_evaluations SET status='complete',result_json=?,previous_json=NULL,error=NULL,lease_token=NULL,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND lease_token=?",
			)
			.bind(
				JSON.stringify({
					...result,
					observations: {
						summaryAt: pull.summaryObservedAt ?? pull.observedAt,
						checksAt:
							pull.checksObservedAt === undefined
								? pull.observedAt
								: pull.checksObservedAt,
					},
				}),
				now,
				...fence,
			)
			.run();
	} catch (error) {
		const failure =
			error instanceof JevError
				? error
				: new JevError("internal", "Jev evaluation could not be completed.");
		const retry = failure.transient && attempt < 3;
		await db
			.prepare(
				"UPDATE ai_evaluations SET status=?,attempts=?,error=?,not_before=?,lease_token=NULL,updated_at=? WHERE observation_id=? AND generation=? AND input_revision=? AND lease_token=?",
			)
			.bind(
				retry ? "pending" : "error",
				retry ? attempt : 3,
				`${failure.code}: ${failure.message}`,
				now + Math.max(failure.retryAfter, 5 * 2 ** (attempt - 1)),
				now,
				...fence,
			)
			.run();
	}
}
