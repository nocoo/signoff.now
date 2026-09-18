import { querySourceSchema, storageSource } from "@signoff/domain/monitoring";
import {
	machinePageSchema,
	machinePreviewSchema,
	machineWriteSchema,
} from "@signoff/domain/query";
import {
	defaultStateMachine,
	effectiveStateMachine,
	evaluatePull,
} from "@signoff/domain/state-machine";
import {
	type Project,
	type PullReadiness,
	projectMergeRequirements,
	projectSchema,
	pullRequestSchema,
	type StateMachine,
} from "@signoff/domain/workbench";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import {
	MonitoringError,
	mapProject,
	type ProjectRow,
} from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

// Bounded replay includes the selected PR, then the most recent cache with open
// PRs first. The reported limit never implies complete project coverage.
const REPLAY_LIMIT = 2000;
const BODY_LIMIT = 256 * 1024;
type EventRow = {
	id: number;
	observed_at: number;
	from_snapshot: string | null;
	to_snapshot: string;
	project_context: string;
};
type SnapshotRow = { snapshot: string; watched: number };
type VersionRow = {
	revision: number;
	created_at: number;
	settings_json: string;
	readiness_rules_json: string;
};
const publicReadiness = (value: PullReadiness) => ({
	...value,
	ready: value.kind === "ready",
	primaryRequirementId: value.gateId ?? null,
	nextAction: value.action,
});

async function readContext(c: Context<AppEnv>, repositoryId: string | null) {
	const id = c.req.param("id") ?? "";
	const source = storageSource(
		querySourceSchema.parse(c.req.query("source") ?? "live"),
	);
	const pullId = c.req.query("pullId") ?? "";
	const results = await c.env.DB.batch([
		c.env.DB.prepare("SELECT * FROM projects WHERE id=? AND source=?").bind(
			id,
			source,
		),
		c.env.DB.prepare(`SELECT pr.snapshot,EXISTS(SELECT 1 FROM pr_observations o WHERE o.pull_id=pr.id AND o.active=1 AND o.source=?) watched
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE p.id=? AND p.source=? AND (? IS NULL OR pr.repository_id=?)
      ORDER BY (pr.id=?) DESC,(pr.state='open') DESC,pr.updated_at DESC,pr.id LIMIT ?`).bind(
			source,
			id,
			source,
			repositoryId,
			repositoryId,
			pullId,
			REPLAY_LIMIT,
		),
		c.env.DB.prepare(`SELECT r.repository_id id,r.name FROM workbench_repositories r JOIN projects p ON p.id=r.project_id WHERE p.id=? AND p.source=?
      UNION SELECT pr.repository_id id,json_extract(pr.snapshot,'$.repository.name') name FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE p.id=? AND p.source=? ORDER BY name`).bind(
			id,
			source,
			id,
			source,
		),
		c.env.DB.prepare(
			"SELECT revision,created_at FROM state_machine_versions WHERE project_id=? ORDER BY revision DESC LIMIT 30",
		).bind(id),
		c.env.DB.prepare(
			"SELECT * FROM pr_state_events WHERE project_id=? AND pull_id=? ORDER BY id DESC LIMIT 30",
		).bind(id, pullId),
		c.env.DB.prepare(
			"SELECT count(*) total FROM pull_requests WHERE project_id=? AND (? IS NULL OR repository_id=?)",
		).bind(id, repositoryId, repositoryId),
		c.env.DB.prepare(
			"SELECT revision FROM workbench_revisions WHERE source=?",
		).bind(source),
		c.env.DB.prepare(
			"SELECT snapshot FROM pull_requests WHERE project_id=? AND id=? AND (? IS NULL OR repository_id=?)",
		).bind(id, pullId, repositoryId, repositoryId),
	]);
	const row = results[0]?.results[0] as ProjectRow | undefined;
	if (!row)
		throw new MonitoringError(
			"PROJECT_NOT_FOUND",
			"Project not found in this data source",
			404,
		);
	const repositories = [
		...new Map(
			((results[2]?.results ?? []) as { id: string; name: string }[]).map(
				(r) => [r.id, r],
			),
		).values(),
	];
	if (repositoryId && !repositories.some((r) => r.id === repositoryId))
		throw new MonitoringError(
			"REPOSITORY_NOT_FOUND",
			"Choose a collected repository by its stable ID",
			404,
		);
	const project = mapProject(row);
	const pulls = ((results[1]?.results ?? []) as SnapshotRow[]).map((r) => ({
		pull: pullRequestSchema.parse(JSON.parse(r.snapshot)),
		watched: r.watched === 1,
	}));
	const selected = results[7]?.results[0] as { snapshot: string } | undefined;
	const count = results[5]?.results[0] as { total: number } | undefined;
	const revision = results[6]?.results[0] as { revision: number } | undefined;
	const total = count?.total ?? 0;
	return {
		project,
		source,
		repositoryId,
		repositories,
		pulls,
		selectedPull: selected
			? pullRequestSchema.parse(JSON.parse(selected.snapshot))
			: null,
		history: ((results[3]?.results ?? []) as VersionRow[]).map((r) => ({
			revision: r.revision,
			createdAt: r.created_at,
		})),
		events: selected ? ((results[4]?.results ?? []) as EventRow[]) : [],
		total,
		evaluatedCount: pulls.length,
		truncated: total > pulls.length,
		dataRevision: String(revision?.revision ?? 0),
	};
}
type MachineContext = Awaited<ReturnType<typeof readContext>>;
function evaluate(context: MachineContext, project = context.project) {
	return context.pulls.map(({ pull, watched }) => {
		const result = evaluatePull(pull, project);
		return {
			id: pull.id,
			number: pull.number,
			title: pull.title,
			repositoryId: pull.repository.id,
			lifecycle: pull.state,
			watched,
			summaryObservedAt: pull.summaryObservedAt ?? pull.observedAt,
			checksObservedAt:
				pull.checksObservedAt === undefined
					? pull.observedAt
					: pull.checksObservedAt,
			readiness: publicReadiness(result.readiness),
			requirements: result.requirements,
			trace: result.trace,
		};
	});
}
function settingsFor(
	project: Project,
	repositoryId: string | null,
	config: StateMachine | null,
) {
	const settings = project.stateMachine ?? { default: null, repositories: {} };
	if (!repositoryId) return { ...settings, default: config };
	const repositories = { ...settings.repositories };
	if (config) repositories[repositoryId] = config;
	else delete repositories[repositoryId];
	return { ...settings, repositories };
}
async function readWrite(c: Context<AppEnv>) {
	const body = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!body.ok)
		throw new MonitoringError(
			"INVALID_BODY",
			"Provide valid state machine settings",
			body.error === "payload_too_large" ? 413 : 400,
		);
	const input = machineWriteSchema.parse(body.value);
	const context = await readContext(c, input.repositoryId);
	if (context.project.stateMachineRevision !== input.revision)
		throw new MonitoringError(
			"REVISION_CONFLICT",
			"State machine settings changed. Reload before saving your draft.",
			409,
		);
	return {
		input,
		context,
		settings: settingsFor(context.project, input.repositoryId, input.config),
	};
}

export const stateMachineRoutes = new Hono<AppEnv>();
stateMachineRoutes.onError(apiError);
stateMachineRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});
stateMachineRoutes.get("/:id", async (c) => {
	const context = await readContext(c, c.req.query("repositoryId") || null);
	const { project, repositoryId, selectedPull } = context;
	const pulls = context.pulls.map((r) => r.pull);
	const machine = effectiveStateMachine(
		project,
		repositoryId ?? undefined,
		pulls,
	);
	const transitions = context.events.map((event) => {
		const historicalProject = projectSchema.parse({
			...project,
			...JSON.parse(event.project_context),
		});
		const replay = (snapshot: string) =>
			publicReadiness(
				evaluatePull(
					pullRequestSchema.parse(JSON.parse(snapshot)),
					historicalProject,
				).readiness,
			);
		return {
			id: event.id,
			at: event.observed_at,
			cause: "observation",
			ruleRevision: historicalProject.stateMachineRevision,
			from: event.from_snapshot ? replay(event.from_snapshot) : null,
			to: replay(event.to_snapshot),
		};
	});
	const catalog = projectMergeRequirements(project, pulls).filter(
		(gate) =>
			!repositoryId ||
			!gate.scope?.length ||
			gate.scope.some(
				(scope) =>
					!scope.repositoryId ||
					scope.repositoryId.toLowerCase() === repositoryId.toLowerCase(),
			),
	);
	return c.json(
		machinePageSchema.parse({
			...context,
			...machine,
			catalog,
			selectedPull,
			evaluations: evaluate(context),
			transitions,
		}),
	);
});
stateMachineRoutes.post("/:id/preview", async (c) => {
	const { input, context, settings } = await readWrite(c);
	const before = evaluate(context);
	const evaluations = evaluate(context, {
		...context.project,
		stateMachine: settings,
	});
	const changes = evaluations.flatMap((after, index) => {
		const previous = before[index];
		if (!previous) return [];
		const signature = (item: typeof after) =>
			JSON.stringify([
				item.readiness.stateId,
				item.readiness.kind,
				item.readiness.label,
				item.readiness.color,
				item.readiness.primaryRequirementId,
				item.readiness.rank,
			]);
		return signature(previous) === signature(after)
			? []
			: [
					{
						id: after.id,
						number: after.number,
						title: after.title,
						before: previous.readiness,
						after: after.readiness,
					},
				];
	});
	return c.json(
		machinePreviewSchema.parse({
			...context,
			revision: input.revision,
			changed: changes.length,
			changes,
			evaluations,
		}),
	);
});
stateMachineRoutes.patch("/:id", async (c) => {
	const { input, context, settings } = await readWrite(c);
	const settingsJson = JSON.stringify(settings);
	if (new TextEncoder().encode(settingsJson).length > BODY_LIMIT)
		throw new MonitoringError(
			"SETTINGS_TOO_LARGE",
			"Combined project and repository settings exceed 256 KiB",
			413,
		);
	const updated =
		await c.env.DB.prepare(`UPDATE projects SET state_machine_json=?,state_machine_revision=state_machine_revision+1
    WHERE id=? AND source=? AND state_machine_revision=? RETURNING *`)
			.bind(settingsJson, context.project.id, context.source, input.revision)
			.first<ProjectRow>();
	if (!updated)
		throw new MonitoringError(
			"REVISION_CONFLICT",
			"State machine settings changed. Reload before saving your draft.",
			409,
		);
	return c.json({ revision: updated.state_machine_revision });
});
stateMachineRoutes.get("/:id/versions/:revision", async (c) => {
	const repositoryId = c.req.query("repositoryId") || null;
	const context = await readContext(c, repositoryId);
	const revision = z.coerce
		.number()
		.int()
		.positive()
		.parse(c.req.param("revision"));
	const row = await c.env.DB.prepare(
		"SELECT * FROM state_machine_versions WHERE project_id=? AND revision=?",
	)
		.bind(context.project.id, revision)
		.first<VersionRow>();
	if (!row)
		throw new MonitoringError(
			"VERSION_NOT_FOUND",
			"State machine version not found",
			404,
		);
	const project = projectSchema.parse({
		...context.project,
		stateMachine: JSON.parse(row.settings_json),
		readinessRules: JSON.parse(row.readiness_rules_json),
	});
	return c.json({
		revision: context.project.stateMachineRevision,
		config: repositoryId
			? (project.stateMachine?.repositories[repositoryId] ?? null)
			: (project.stateMachine?.default ??
				defaultStateMachine(
					project,
					context.pulls.map((r) => r.pull),
				)),
	});
});
