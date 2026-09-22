import {
	policyCatalog,
	policyInstructions,
} from "@signoff/domain/ai-readiness";
import { querySourceSchema, storageSource } from "@signoff/domain/monitoring";
import {
	machineHistorySchema,
	machinePageSchema,
	machineWriteSchema,
} from "@signoff/domain/query";
import { evaluateRequirements } from "@signoff/domain/state-machine";
import { pullRequestSchema } from "@signoff/domain/workbench";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { numberPolicies } from "../ai/policy-codes.js";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import {
	MonitoringError,
	mapProject,
	type ProjectRow,
} from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

async function context(c: Context<AppEnv>, repositoryId: string | null) {
	const id = c.req.param("id") ?? "";
	const source = storageSource(
		querySourceSchema.parse(c.req.query("source") ?? "live"),
	);
	const results = await c.env.DB.batch([
		c.env.DB.prepare("SELECT * FROM projects WHERE id=? AND source=?").bind(
			id,
			source,
		),
		c.env.DB.prepare(
			"SELECT repository_id id,name FROM workbench_repositories WHERE project_id=? ORDER BY name,id",
		).bind(id),
		c.env.DB.prepare(
			`SELECT snapshot FROM pull_requests WHERE project_id=? AND (? IS NULL OR repository_id=?) AND (state='open' OR id IN (SELECT pull_id FROM pr_observations WHERE active=1))`,
		).bind(id, repositoryId, repositoryId),
	]);
	const row = results[0]?.results[0] as ProjectRow | undefined;
	if (!row)
		throw new MonitoringError(
			"PROJECT_NOT_FOUND",
			"Project not found in this source",
			404,
		);
	const project = mapProject(row);
	const repositories = (results[1]?.results ?? []) as {
		id: string;
		name: string;
	}[];
	if (repositoryId && !repositories.some((r) => r.id === repositoryId))
		throw new MonitoringError(
			"REPOSITORY_NOT_FOUND",
			"Choose a known repository ID",
			404,
		);
	const pulls = ((results[2]?.results ?? []) as { snapshot: string }[]).map(
		(r) => pullRequestSchema.parse(JSON.parse(r.snapshot as string)),
	);
	const catalog = policyCatalog(project, pulls).filter(
		(g) =>
			!repositoryId ||
			!g.scope?.length ||
			g.scope.some((s) => !s.repositoryId || s.repositoryId === repositoryId),
	);
	const saved = policyInstructions(project, repositoryId ?? undefined);
	const instructions = [
		...saved,
		...catalog
			.filter(
				(g) =>
					!saved.some(
						(s) => s.gateId === g.id || g.sourceIds?.includes(s.gateId),
					),
			)
			.map((g) => ({ gateId: g.id, description: "" })),
	];
	return machinePageSchema.parse({
		project,
		repositoryId,
		repositories,
		revision: project.stateMachineRevision ?? 1,
		inherited: Boolean(
			repositoryId && !project.policyContext?.repositories[repositoryId],
		),
		catalog,
		policyCodes: Object.fromEntries(
			await numberPolicies(c.env.DB, project.id, catalog),
		),
		instructions,
	});
}
export const stateMachineRoutes = new Hono<AppEnv>();
stateMachineRoutes.onError(apiError);
stateMachineRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});
stateMachineRoutes.get("/:id", async (c) =>
	c.json(
		await context(
			c,
			z
				.string()
				.max(240)
				.nullable()
				.parse(c.req.query("repositoryId") || null),
		),
	),
);
stateMachineRoutes.get("/:id/history", async (c) => {
	const source = storageSource(
		querySourceSchema.parse(c.req.query("source") ?? "live"),
	);
	const pullId = z.string().min(1).max(500).parse(c.req.query("pullId"));
	const row = await c.env.DB.prepare(
		"SELECT p.* FROM projects p JOIN pull_requests r ON r.project_id=p.id WHERE p.id=? AND p.source=? AND r.id=?",
	)
		.bind(c.req.param("id"), source, pullId)
		.first<ProjectRow>();
	if (!row)
		throw new MonitoringError(
			"PR_NOT_FOUND",
			"PR not found in this project and source",
			404,
		);
	const project = mapProject(row);
	const records = await c.env.DB.prepare(
		"SELECT id,observed_at,from_snapshot,to_snapshot FROM pr_state_events WHERE pull_id=? AND project_id=? AND observed_at>=? ORDER BY id DESC LIMIT 30",
	)
		.bind(pullId, project.id, Date.now() / 1000 - 43200)
		.all<{
			id: number;
			observed_at: number;
			from_snapshot: string | null;
			to_snapshot: string;
		}>();
	const facts = (snapshot: string) => {
		const pull = pullRequestSchema.parse(JSON.parse(snapshot));
		return {
			lifecycle: pull.state === "open" && pull.draft ? "draft" : pull.state,
			gates: Object.fromEntries(
				evaluateRequirements(pull, { ...project, mergeRequirements: [] }).map(
					(g) => [g.id, g.state],
				),
			),
		};
	};
	return c.json(
		machineHistorySchema.parse({
			events: records.results.map((r) => ({
				id: r.id,
				at: r.observed_at,
				from: r.from_snapshot ? facts(r.from_snapshot) : null,
				to: facts(r.to_snapshot),
			})),
		}),
	);
});
stateMachineRoutes.put("/:id", async (c) => {
	const raw = await readJsonBodyWithSize(c, 512000);
	if (!raw.ok) return c.json({ error: "Invalid policy instructions" }, 400);
	const input = machineWriteSchema.parse(raw.value);
	const page = await context(c, input.repositoryId);
	const current = page.project.policyContext ?? {
		default: [],
		repositories: {},
	};
	const config = { ...current, repositories: { ...current.repositories } };
	if (input.repositoryId) {
		if (input.instructions === null)
			delete config.repositories[input.repositoryId];
		else config.repositories[input.repositoryId] = input.instructions;
	} else config.default = input.instructions ?? [];
	const allowed = new Set([
		...page.catalog.flatMap((g) => [g.id, ...(g.sourceIds ?? [])]),
		...page.instructions.map((g) => g.gateId),
	]);
	if (input.instructions?.some((i) => !allowed.has(i.gateId)))
		return c.json(
			{ error: "Policy does not belong to this project and scope." },
			400,
		);
	const result = await c.env.DB.prepare(
		"UPDATE projects SET policy_context_json=?,state_machine_revision=state_machine_revision+1 WHERE id=? AND source=? AND state_machine_revision=?",
	)
		.bind(
			JSON.stringify(config),
			page.project.id,
			page.project.source,
			input.revision,
		)
		.run();
	if (!result.meta.changes)
		return c.json(
			{ error: "Policy instructions changed. Reload before saving." },
			409,
		);
	return c.json(await context(c, input.repositoryId));
});
