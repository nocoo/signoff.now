import {
	COMMON_RULES,
	decisionFingerprint,
	decisionState,
	defaultProjectRules,
	isMainTarget,
	jevResultSchema,
	POLICY_CODES,
} from "@signoff/domain/ai-readiness";
import type { Observation } from "@signoff/domain/monitoring";
import { observationItemSchema } from "@signoff/domain/query";
import { checksValidity } from "@signoff/domain/state-machine";
import {
	type Project,
	type PullRequest,
	projectUrl,
	pullUrl,
} from "@signoff/domain/workbench";
import type { EvaluationRow } from "../ai/scheduler.js";

type Database = Pick<D1Database, "prepare" | "batch">;
const iso = (at: number | null | undefined) =>
	at === null || at === undefined ? null : new Date(at * 1000).toISOString();
type Attempt = {
	observation_id: string | null;
	observation_generation: number | null;
	project_id: string;
	kind: string;
	scope_json: string;
	state: string;
	completed_at: number | null;
	updated_at: number;
	error_kind: string | null;
	message: string;
};
export async function inspectionContext(
	db: Database,
	source: string,
	observations: Observation[],
) {
	const projects = [...new Set(observations.map((o) => o.ref.projectId))];
	const [settings, cadence, rules, codes, schedules, attempts] = await db.batch(
		[
			db.prepare(
				"SELECT revision,encrypted_key IS NOT NULL AS configured,cooldown_seconds FROM ai_settings WHERE id=1",
			),
			db.prepare(
				"SELECT cooldown_seconds FROM collection_refresh WHERE kind='details'",
			),
			db.prepare("SELECT scope,text FROM ai_rules"),
			db
				.prepare(
					"SELECT a.project_id,a.gate_id,p.id,p.code FROM ai_policy_aliases a JOIN ai_policy_codes p ON p.id=a.policy_id WHERE a.project_id IN (SELECT value FROM json_each(?))",
				)
				.bind(JSON.stringify(projects)),
			db
				.prepare(
					"SELECT project_id,last_started_at,last_completed_at FROM ai_project_schedule WHERE project_id IN (SELECT value FROM json_each(?))",
				)
				.bind(JSON.stringify(projects)),
			db
				.prepare(`SELECT * FROM (
   SELECT observation_id,observation_generation,project_id,kind,scope_json,state,updated_at,completed_at,error_kind,message,
   ROW_NUMBER() OVER(PARTITION BY project_id,kind,scope_json,observation_id,observation_generation ORDER BY updated_at DESC,id DESC) rank
   FROM collection_jobs WHERE source=? AND project_id IN (SELECT value FROM json_each(?))
   AND (completed_at IS NOT NULL OR state='auth_required') AND (kind='list' OR observation_id IN (SELECT value FROM json_each(?)))
  ) WHERE rank=1`)
				.bind(
					source,
					JSON.stringify(projects),
					JSON.stringify(observations.map((o) => o.id)),
				),
		],
	);
	return {
		settings: settings?.results[0] as {
			revision: number;
			configured: number;
			cooldown_seconds: number;
		},
		detailCooldown: (cadence?.results[0] as { cooldown_seconds: number })
			.cooldown_seconds,
		rules: new Map(
			(rules?.results as { scope: string; text: string }[]).map((r) => [
				r.scope,
				r.text,
			]),
		),
		codes: new Map(
			(
				codes?.results as {
					project_id: string;
					gate_id: string;
					id: number;
					code: string | null;
				}[]
			).map((r) => [`${r.project_id}:${r.gate_id}`, r.code ?? `P${r.id}`]),
		),
		schedules: schedules?.results as {
			project_id: string;
			last_started_at: number | null;
			last_completed_at: number | null;
			updated_at: number;
		}[],
		attempts: attempts?.results as Attempt[],
	};
}
type Context = Awaited<ReturnType<typeof inspectionContext>>;
const actions = {
	conflict: [
		"resolve_conflict",
		"Resolve the merge conflict after verifying the current PR.",
	],
	attention: [
		"inspect_pr",
		"Inspect the PR checks and build evidence before choosing an action.",
	],
	warning: ["observe", "Observe the issue for automatic recovery."],
	running: ["wait_ci", "Wait for ongoing work or more evidence."],
	waiting: ["wait_review", "Wait for external reviewer input."],
	ready: [
		"verify_merge",
		"Verify current provider requirements and any final PoP step before merging.",
	],
	skipped: ["none", "Non-main target; Jev evaluation is skipped."],
} as const;
const compare = (
	actualSha: string | null | undefined,
	expectedSha: string | null | undefined,
) => ({
	actualSha: actualSha ?? null,
	expectedSha: expectedSha ?? null,
	status:
		!actualSha || !expectedSha
			? "unknown"
			: actualSha === expectedSha
				? "match"
				: "mismatch",
});
const ref = (kind: string, id: string) => `${kind}/${encodeURIComponent(id)}`;
function lastAttempt(context: Context, o: Observation, kind?: string) {
	const job = [...context.attempts]
		.sort((a, b) => b.updated_at - a.updated_at)
		.find(
			(j) =>
				j.project_id === o.ref.projectId &&
				(!kind || j.kind === kind) &&
				((j.kind === "list" &&
					(JSON.parse(j.scope_json).length === 0 ||
						JSON.parse(j.scope_json).includes(o.ref.repository.id) ||
						JSON.parse(j.scope_json).includes(o.ref.repository.name))) ||
					(j.observation_id === o.id &&
						j.observation_generation === o.generation)),
		);
	return job
		? {
				kind: job.kind,
				updatedAt: iso(job.updated_at),
				state: job.state,
				completedAt: iso(job.completed_at),
				error: ["failed", "partial", "auth_required"].includes(job.state)
					? `${job.error_kind ?? job.state}: ${job.message}`
					: null,
			}
		: null;
}
export async function inspectObservation(
	o: Observation,
	pull: PullRequest | undefined,
	project: Project | undefined,
	providerProjectId: string | null,
	row: EvaluationRow | undefined,
	context: Context,
	now: number,
) {
	const prUrl = pullUrl(o.ref, o.ref);
	const summaryAt = pull?.summaryObservedAt ?? pull?.observedAt ?? null;
	const checksAt =
		pull?.checksObservedAt === undefined
			? (pull?.observedAt ?? null)
			: pull.checksObservedAt;
	const missing = pull?.collectionIssues ?? [];
	const validity = pull ? checksValidity(pull) : "missing";
	const decision = await inspectReadiness(
		o,
		pull,
		project,
		row,
		context,
		now,
		summaryAt,
		prUrl,
	);
	const policies = pull?.policies ?? [];
	const code = (id: string, name: string) =>
		context.codes.get(`${o.ref.projectId}:${id}`) ?? POLICY_CODES[name] ?? null;
	return observationItemSchema.parse({
		watch: {
			id: o.id,
			generation: o.generation,
			active: o.active,
			addedAt: iso(o.addedAt),
			stoppedAt: iso(o.stoppedAt),
			stopReason: o.stopReason,
		},
		pr: {
			id: pull?.id ?? o.pullId,
			number: o.ref.number,
			title: pull?.title ?? null,
			url: prUrl,
			provider: o.ref.provider,
			organization: o.ref.organization,
			project: {
				signoffId: o.ref.projectId,
				providerId: providerProjectId,
				name: o.ref.projectKey,
			},
			repository: o.ref.repository,
			author: pull ? { id: pull.author.id, name: pull.author.name } : null,
			lifecycle: pull?.state ?? null,
			draft: pull?.draft ?? null,
			providerStatus: pull?.evidence?.status ?? null,
			providerMergeStatus: pull?.evidence?.mergeStatus ?? null,
			sourceBranch: pull?.sourceBranch ?? null,
			targetBranch: pull?.targetBranch ?? null,
			headSha: pull?.headSha ?? null,
			targetSha: pull?.targetSha ?? null,
			targetShaSource:
				o.ref.provider === "ado" && pull?.targetSha
					? "ado_lastMergeTargetCommit"
					: "unknown",
			mergeSha: pull?.evidence?.mergeSha ?? null,
			mergeability: pull?.mergeable ?? "unknown",
			createdAt: iso(pull?.createdAt),
			collection: {
				observedAt: iso(summaryAt),
				coverage: pull ? "complete" : "not_collected",
				missing: pull ? [] : ["PR summary has not been collected"],
				lastAttempt: lastAttempt(context, o),
			},
		},
		...decision,
		checks: {
			observedAt: iso(checksAt),
			coverage:
				checksAt === null
					? "not_collected"
					: (pull?.coverage ?? "not_collected"),
			missing:
				checksAt === null
					? ["Checks have not been collected", ...missing]
					: missing,
			validity,
			lastAttempt: lastAttempt(context, o, "details"),
			items: policies.map((p) => inspectPolicy(p, code(p.id, p.name), prUrl)),
		},
		builds: pull
			? pull.builds.map((b) => inspectBuild(b, pull, project, prUrl, checksAt))
			: [],
		reviews: {
			observedAt: iso(summaryAt),
			individualApproved: (pull?.reviewers ?? []).filter(
				(r) => r.isGroup === false && r.vote === "approved",
			).length,
			groupApproved: (pull?.reviewers ?? []).filter(
				(r) => r.isGroup === true && r.vote === "approved",
			).length,
			unclassifiedApproved: (pull?.reviewers ?? []).filter(
				(r) => r.isGroup === undefined && r.vote === "approved",
			).length,
			requirementsSource: "checks",
			reviewers: (pull?.reviewers ?? []).map((r) => ({
				id: r.id,
				name: r.name,
				isGroup: r.isGroup ?? null,
				required: r.required,
				vote: r.vote,
				providerVote: r.providerVote ?? null,
				hasDeclined: r.hasDeclined ?? null,
				countsTowardApproval: r.countsTowardApproval ?? null,
				approvalRevision: null,
			})),
		},
	});
}

async function inspectReadiness(
	o: Observation,
	pull: PullRequest | undefined,
	project: Project | undefined,
	row: EvaluationRow | undefined,
	context: Context,
	now: number,
	summaryAt: number | null,
	prUrl: string,
) {
	const parse = (value: string | null | undefined) =>
		value ? jevResultSchema.parse(JSON.parse(value)) : null;
	const judgment = parse(row?.result_json ?? row?.previous_json);
	const direct =
		pull && !isMainTarget(pull)
			? "skipped"
			: pull?.mergeable === "conflicts" && o.active
				? "conflict"
				: null;
	let current = false;
	if (
		judgment &&
		pull &&
		project &&
		o.active &&
		row?.config_revision === context.settings.revision
	) {
		const state = decisionState(pull, project, now, context.detailCooldown, {
			common: context.rules.get("common") ?? COMMON_RULES,
			project:
				context.rules.get(project.id) ??
				(project.source === "cli" ? defaultProjectRules(project.id) : ""),
		});
		for (const gate of state.policiesInPriorityOrder)
			gate.code = context.codes.get(`${project.id}:${gate.id}`) ?? gate.code;
		current = judgment.fingerprint === (await decisionFingerprint(state));
	}
	const kind = direct ?? judgment?.kind ?? null;
	const schedule = context.schedules.find(
		(s) => s.project_id === o.ref.projectId,
	);
	const notBefore = Math.max(
		row?.not_before ?? 0,
		!schedule?.last_started_at
			? 0
			: Math.max(schedule.last_started_at, schedule.last_completed_at ?? 0) +
					context.settings.cooldown_seconds,
	);
	const isCurrent = Boolean(o.active && (direct || current));
	const update = inspectUpdate(
		o.active,
		Boolean(direct || current),
		Boolean(pull),
		row,
		context,
		notBefore || now,
	);

	return {
		readiness: {
			state: kind,
			source:
				direct === "conflict"
					? "provider"
					: direct === "skipped"
						? "target_branch"
						: judgment
							? "jev"
							: null,
			evaluatedAt: direct ? iso(summaryAt) : (judgment?.evaluatedAt ?? null),
			isCurrent,
			update,
		},
		nextAction:
			kind && o.active
				? {
						code: actions[kind][0],
						text: actions[kind][1],
						evidenceRefs: [],
						url: prUrl,
					}
				: null,
	};
}

function inspectPolicy(
	p: PullRequest["policies"][number],
	code: string | null,
	prUrl: string,
) {
	const e = p.evidence;
	return {
		ref: ref("checks", p.id),
		id: p.id,
		code,
		name: p.name,
		kind: p.kind ?? null,
		state: p.state,
		providerStatus: e?.status ?? null,
		required: e?.isBlocking ?? (p.kind === "status" ? p.required : null),
		enabled: e?.isEnabled ?? null,
		applicable: e?.status ? e.status.toLowerCase() !== "notapplicable" : null,
		isExpired: e?.isExpired ?? null,
		buildIsNotCurrent: e?.buildIsNotCurrent ?? null,
		evaluationId: e?.evaluationId ?? null,
		configurationId: e?.configurationId ?? null,
		configurationRevision: e?.configurationRevision ?? null,
		buildId: e?.buildId ?? null,
		definitionId: p.definitionId ?? null,
		message: e?.description ?? null,
		url: e?.url ?? prUrl,
		updatedAt: iso(e?.updatedAt),
		startedAt: iso(e?.startedAt),
		completedAt: iso(e?.completedAt),
		validDurationMinutes: e?.validDurationMinutes ?? null,
		scope: e?.scope ?? null,
		reviewRule:
			p.kind === "review"
				? {
						minimumApproverCount: e?.minimumApproverCount ?? null,
						creatorVoteCounts: e?.creatorVoteCounts ?? null,
						allowDownvotes: e?.allowDownvotes ?? null,
						requiredReviewerIds: e?.requiredReviewerIds ?? null,
						filenamePatterns: e?.filenamePatterns ?? null,
					}
				: null,
	};
}

function inspectBuild(
	b: PullRequest["builds"][number],
	pull: PullRequest,
	project: Project | undefined,
	prUrl: string,
	checksAt: number | null,
) {
	const buildUrl = (id: string) =>
		project?.provider === "ado"
			? `${projectUrl(project)}/_build/results?buildId=${encodeURIComponent(id)}`
			: prUrl;

	const policies = pull.policies;
	return {
		ref: ref("builds", b.id),
		id: b.id,
		name: b.name,
		definitionId: b.definitionId ?? null,
		number: b.number,
		required: b.required,
		sourceSha: b.evidence?.sourceSha ?? null,
		sourceBranch: b.evidence?.sourceBranch ?? null,
		url: buildUrl(b.id),
		headMatch: compare(b.evidence?.sourceSha, pull?.headSha),
		mergeMatch: compare(b.evidence?.sourceSha, pull?.evidence?.mergeSha),
		checkRefs: policies
			.filter(
				(p) =>
					p.evidence?.buildId === b.id ||
					(!p.evidence?.buildId &&
						p.definitionId &&
						p.definitionId === b.definitionId),
			)
			.map((p) => ref("checks", p.id)),
		observedAt: iso(checksAt),
		queuedAt: iso(b.evidence?.queuedAt),
		state: b.state,
		providerStatus: b.evidence?.status ?? null,
		providerResult: b.evidence?.result ?? null,
		message: b.evidence?.description ?? null,
		updatedAt: iso(b.evidence?.updatedAt),
		startedAt: iso(b.evidence?.startedAt),
		completedAt: iso(b.evidence?.completedAt),
		stages: b.stages.map((s) => ({
			ref: `${ref("builds", b.id)}/${ref("stages", s.id)}`,
			id: s.id,
			name: s.name,
			identifier: s.evidence?.identifier ?? null,
			recordType: s.evidence?.recordType ?? null,
			attempt: s.evidence?.attempt ?? null,
			required: s.required,
			requiredSource: "derived",
			state: s.state,
			providerStatus: s.evidence?.status ?? null,
			providerResult: s.evidence?.result ?? null,
			message: s.evidence?.description ?? null,
			updatedAt: iso(s.evidence?.updatedAt),
			startedAt: iso(s.evidence?.startedAt),
			completedAt: iso(s.evidence?.completedAt),
		})),
	};
}

function inspectUpdate(
	active: boolean,
	current: boolean,
	collected: boolean,
	row: EvaluationRow | undefined,
	context: Context,
	notBefore: number,
) {
	if (!active)
		return {
			state: "stopped",
			reason: "unwatched",
			notBefore: null,
			error: null,
		};
	if (current)
		return { state: "idle", reason: null, notBefore: null, error: null };
	if (!collected)
		return {
			state: "blocked",
			reason: "awaiting_collection",
			notBefore: null,
			error: null,
		};
	if (!context.settings.configured || row?.status === "error")
		return {
			state: "error",
			reason: null,
			notBefore: null,
			error: !context.settings.configured
				? "Jev API key is not configured"
				: (row?.error ?? "Evaluation failed"),
		};
	if (row?.status === "running")
		return {
			state: "evaluating",
			reason: null,
			notBefore: iso(notBefore),
			error: null,
		};
	return {
		state: "scheduled",
		reason: null,
		notBefore: iso(notBefore),
		error: null,
	};
}
