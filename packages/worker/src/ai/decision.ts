import {
	AI_LABELS,
	type AiReadiness,
	COMMON_RULES,
	canonicalJson,
	decisionState,
	defaultProjectRules,
	JEV_MODEL,
	JEV_RUBRIC,
	jevResultSchema,
	NEXT_ACTIONS,
	presentReadiness,
	readinessShortcut,
} from "@signoff/domain/ai-readiness";
import { checksValidity } from "@signoff/domain/state-machine";
import type { Project, PullRequest } from "@signoff/domain/workbench";

type Database = Pick<D1Database, "prepare" | "batch">;
export function decisionContextQueries(db: Database) {
	return [
		db.prepare("SELECT scope,text FROM ai_rules"),
		db.prepare(
			"SELECT a.project_id,a.gate_id,p.id,p.code FROM ai_policy_aliases a JOIN ai_policy_codes p ON p.id=a.policy_id",
		),
		db.prepare(
			"SELECT revision,encrypted_key IS NOT NULL AS configured,cooldown_seconds FROM ai_settings WHERE id=1",
		),
	];
}
export function decisionContext(results: D1Result[]) {
	return {
		rules: new Map(
			(results[0]?.results as { scope: string; text: string }[]).map((r) => [
				r.scope,
				r.text,
			]),
		),
		codes: new Map(
			(
				results[1]?.results as {
					project_id: string;
					gate_id: string;
					id: number;
					code: string | null;
				}[]
			).map((r) => [`${r.project_id}:${r.gate_id}`, r.code ?? `P${r.id}`]),
		),
		settings: results[2]?.results[0] as {
			revision: number;
			configured: number;
			cooldown_seconds: number;
		},
	};
}
export type DecisionContext = ReturnType<typeof decisionContext>;
export function inputState(
	pull: PullRequest,
	project: Project,
	context: DecisionContext,
) {
	const codes = new Map(
		[...context.codes]
			.filter(([key]) => key.startsWith(`${project.id}:`))
			.map(([key, code]) => [key.slice(project.id.length + 1), code]),
	);
	return decisionState(
		pull,
		project,
		{
			common: context.rules.get("common") ?? COMMON_RULES,
			project:
				context.rules.get(project.id) ??
				(project.source === "cli" ? defaultProjectRules(project.id) : ""),
		},
		codes,
	);
}
export function currentEvaluation(
	row: EvaluationRow | undefined,
	pull: PullRequest,
	project: Project,
	context: DecisionContext,
): EvaluationRow | undefined {
	if (!row || row.status === "canceled") return row;
	const matches =
		checksValidity(pull) === "valid" &&
		row.state_json === canonicalJson(inputState(pull, project, context));
	const result = row.result_json ? JSON.parse(row.result_json) : null;
	const current =
		matches && result?.model === JEV_MODEL && result?.rubric === JEV_RUBRIC;
	return {
		...row,
		status: current
			? "complete"
			: matches && row.config_revision === context.settings.revision
				? row.status === "complete"
					? "pending"
					: row.status
				: "pending",
		result_json: current ? row.result_json : null,
		previous_json: current ? null : (row.result_json ?? row.previous_json),
		not_before: nextEligibleAt(row, context.settings.cooldown_seconds),
	};
}

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
	state_json: string | null;
	last_started_at: number | null;
	last_completed_at: number | null;
};
export function evaluationOutput(
	row: EvaluationRow | undefined,
	active: boolean,
	pull?: Pick<PullRequest, "mergeable" | "targetBranch">,
): AiReadiness {
	const shortcut = readinessShortcut(pull, active);
	if (shortcut)
		return {
			...presentReadiness("complete"),
			kind: shortcut,
			label: AI_LABELS[shortcut],
			nextAction: NEXT_ACTIONS[shortcut],
		};
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

export function nextEligibleAt(
	row: Pick<
		EvaluationRow,
		"not_before" | "last_started_at" | "last_completed_at"
	>,
	cooldown: number,
) {
	const last = Math.max(row.last_completed_at ?? 0, row.last_started_at ?? 0);
	return Math.max(row.not_before, last ? last + cooldown : 0);
}
export function readinessPhase(
	active: boolean,
	pull: PullRequest | undefined,
	row: EvaluationRow | undefined,
	configured: boolean,
) {
	if (!active) return "stopped";
	if (readinessShortcut(pull, active)) return "decided";
	if (!pull || checksValidity(pull) !== "valid") return "collecting";
	if (row?.status === "complete") return "decided";
	if (row?.status === "running") return "evaluating";
	if (!configured || row?.status === "error") return "error";
	return "queued";
}
