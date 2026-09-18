import {
	type CollectionJob,
	collectionJobSchema,
	collectorStatusSchema,
	type Project,
	projectPatchSchema,
	projectWriteSchema,
	pullRequestSchema,
	readinessWriteSchema,
	revisionSchema,
	type ScanRun,
	scanRequestSchema,
} from "@signoff/domain/workbench";
import type { Context } from "hono";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import { enqueueDiscovery } from "../monitoring/observations.js";
import {
	mapJob,
	mapProject,
	matchesAlias,
	type ProjectRow,
	readJob,
} from "../monitoring/store.js";
import { apiError } from "./query.js";

export { mapProject, type ProjectRow } from "../monitoring/store.js";

import type { AppEnv } from "../types.js";
import { mapRefreshQueue, REFRESH_QUEUES_SQL } from "./refresh.js";

type JobRow = {
	id: string;
	project_id: string;
	revision: number;
	state: CollectionJob["state"];
	requested_at: number;
	started_at: number | null;
	updated_at: number;
	completed_at: number | null;
	completed_pulls: number;
	total_pulls: number | null;
	message: string;
	pull_ids_json?: string | null;
	kind?: CollectionJob["kind"];
	round_id?: string | null;
};
type ScanRow = {
	id: string;
	project_id: string;
	source: "demo" | "cli";
	state: ScanRun["state"];
	started_at: number;
	completed_at: number;
	pull_request_count: number;
	advanced_stages: number;
	message: string;
};
const BODY_LIMIT = 8192;
const PR_LIMIT = 1000;
const now = () => Math.floor(Date.now() / 1000);

function mapCollectionJob(row: JobRow): CollectionJob {
	return collectionJobSchema.parse({
		id: row.id,
		projectId: row.project_id,
		revision: row.revision,
		state: row.state,
		requestedAt: row.requested_at,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at,
		completedPulls: row.completed_pulls,
		totalPulls: row.total_pulls,
		message: row.message,
		pullIds: row.pull_ids_json ? JSON.parse(row.pull_ids_json) : undefined,
		kind: row.kind,
		roundId: row.round_id,
	});
}
function scopeKey(items: string[] | undefined) {
	return JSON.stringify(
		[...(items ?? [])]
			.map((item) => item.toLowerCase())
			.sort((left, right) => left.localeCompare(right)),
	);
}

// Match the exact catalog used to resolve names; scan timestamps and unrelated PR publications may still advance.
const PROJECT_CATALOG = `(SELECT json_group_array(json_array(repository_id,name,aliases_json))
 FROM (SELECT repository_id,name,aliases_json FROM workbench_repositories WHERE project_id=? ORDER BY repository_id))`;

async function getProject(c: Context<AppEnv>): Promise<Project | null> {
	const row = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
		.bind(c.req.param("id") ?? "")
		.first<ProjectRow>();
	return row ? mapProject(row) : null;
}

function demoMode(c: Context<AppEnv>): boolean {
	return (
		c.env.SIGNOFF_DEMO_MODE === "1" && isLocalhost(c.req.header("host") ?? "")
	);
}

function isDuplicate(error: unknown): boolean {
	return (
		error instanceof Error &&
		/UNIQUE constraint failed: projects\./.test(error.message)
	);
}

export async function workbenchRoute(c: Context<AppEnv>) {
	c.header("Cache-Control", "no-store");
	// One read transaction keeps project identities and their snapshots consistent.
	const results = await c.env.DB.batch([
		c.env.DB.prepare("SELECT * FROM projects ORDER BY created_at, name"),
		c.env.DB.prepare(
			"SELECT snapshot FROM pull_requests ORDER BY updated_at DESC, id LIMIT ?",
		).bind(PR_LIMIT + 1),
		c.env.DB.prepare(
			"SELECT * FROM scan_runs ORDER BY completed_at DESC, id LIMIT 20",
		),
		c.env.DB.prepare(
			"SELECT last_seen_at, state, message FROM collector_heartbeat WHERE id = 1",
		),
		c.env.DB.prepare(
			`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, pull_ids_json, kind, round_id
			 FROM collection_jobs
			 WHERE state IN ('queued', 'running', 'auth_required') OR id IN (SELECT id FROM collection_jobs WHERE state NOT IN ('queued', 'running', 'auth_required') ORDER BY updated_at DESC LIMIT 20)
			 ORDER BY CASE WHEN state IN ('queued', 'running', 'auth_required') THEN 0 ELSE 1 END, updated_at DESC
			 LIMIT 1000`,
		),
		c.env.DB.prepare(REFRESH_QUEUES_SQL),
	]);
	const projects = (results[0]?.results ?? []) as ProjectRow[];
	const pulls = (results[1]?.results ?? []) as { snapshot: string }[];
	const scans = (results[2]?.results ?? []) as ScanRow[];
	const heartbeat = (
		results[3]?.results as
			| { last_seen_at: number; state: string; message: string }[]
			| undefined
	)?.[0];
	const jobs = (results[4]?.results ?? []) as JobRow[];
	return c.json({
		refreshQueues: (results[5]?.results ?? []).map((row) =>
			mapRefreshQueue(row as Parameters<typeof mapRefreshQueue>[0]),
		),
		projects: projects.map(mapProject),
		pullRequests: pulls
			.slice(0, PR_LIMIT)
			.map((r) => pullRequestSchema.parse(JSON.parse(r.snapshot))),
		scans: scans.map((r) => ({
			id: r.id,
			projectId: r.project_id,
			source: r.source,
			state: r.state,
			startedAt: r.started_at,
			completedAt: r.completed_at,
			pullRequestCount: r.pull_request_count,
			advancedStages: r.advanced_stages,
			message: r.message,
		})),
		collectionJobs: jobs.map(mapCollectionJob),
		collector: heartbeat
			? collectorStatusSchema.parse({
					lastSeenAt: heartbeat.last_seen_at,
					state: heartbeat.state,
					message: heartbeat.message,
				})
			: null,
		demoMode: demoMode(c),
		fetchedAt: now(),
		truncated: pulls.length > PR_LIMIT,
	});
}

export async function projectsCreateRoute(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!raw.ok)
		return c.json(
			{
				error:
					raw.error === "payload_too_large"
						? "Project details are too large"
						: "Invalid JSON body",
			},
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = projectWriteSchema.safeParse(raw.value);
	if (!parsed.success)
		return c.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid project" },
			400,
		);
	const project: Project = {
		...parsed.data,
		id: crypto.randomUUID(),
		source: "cli",
		revision: 1,
		createdAt: now(),
		updatedAt: now(),
		lastScannedAt: null,
		scanState: "never",
		scanMessage: null,
		repositories: parsed.data.repositories ?? [],
	};
	try {
		await c.env.DB.prepare(`INSERT INTO projects (id, provider, name, organization, project_key, repositories_json, description, owner, enabled, source, revision, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
			.bind(
				project.id,
				project.provider,
				project.name,
				project.organization,
				project.projectKey,
				JSON.stringify(project.repositories ?? []),
				project.description,
				project.owner,
				Number(project.enabled),
				project.source,
				project.createdAt,
				project.updatedAt,
			)
			.run();
	} catch (error) {
		if (isDuplicate(error))
			return c.json(
				{ error: "This Azure DevOps project is already added" },
				409,
			);
		throw error;
	}
	return c.json(project, 201);
}

export async function projectsPatchRoute(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!raw.ok)
		return c.json(
			{ error: "Invalid project body" },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = projectPatchSchema.safeParse(raw.value);
	if (!parsed.success || Object.keys(parsed.data).length === 1)
		return c.json(
			{
				error: parsed.success
					? "Provide a field to update"
					: (parsed.error.issues[0]?.message ?? "Invalid project"),
			},
			400,
		);
	const current = await getProject(c);
	if (!current) return c.json({ error: "Project not found" }, 404);
	if (parsed.data.revision !== current.revision)
		return c.json(
			{ error: "This project changed. Refresh and try again." },
			409,
		);
	const { revision, ...changes } = parsed.data;
	const next: Project = {
		...current,
		...changes,
		revision: revision + 1,
		updatedAt: now(),
	};
	const identityChanged =
		current.provider !== next.provider ||
		current.organization.toLowerCase() !== next.organization.toLowerCase() ||
		current.projectKey.toLowerCase() !== next.projectKey.toLowerCase();
	const sourceChanged =
		identityChanged ||
		scopeKey(current.repositories) !== scopeKey(next.repositories);
	const catalog =
		(
			await c.env.DB.prepare(`SELECT ${PROJECT_CATALOG} AS catalog`)
				.bind(current.id)
				.first<{ catalog: string }>()
		)?.catalog ?? "[]";
	const catalogRows = JSON.parse(catalog) as [string, string, string][];
	const knownIds = catalogRows.map(([id]) => id);
	const repositoryIds = catalogRows
		.filter(
			([repository_id, name, aliases_json]) =>
				!next.repositories?.length ||
				next.repositories.some((value) =>
					matchesAlias(
						{ repository_id, name, aliases_json },
						value,
						next.provider,
						knownIds,
					),
				),
		)
		.map(([id]) => id);
	const scopeResolution = JSON.stringify({
		previousRevision: revision,
		revision: next.revision,
		identityChanged,
		scopeChanged: sourceChanged,
		restricted: Boolean(next.repositories?.length),
		repositoryIds,
	});
	try {
		// Guard dependent deletes with the OLD revision and run them before the
		// CAS update, in the same transaction. Zero-row updates do not roll D1 back.
		const result = await c.env.DB.batch([
			c.env.DB.prepare(
				`DELETE FROM pull_requests WHERE project_id = ? AND (? = 1 OR (? = 1 AND repository_id NOT IN (SELECT value FROM json_each(?))))
         AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?) AND ${PROJECT_CATALOG}=?`,
			).bind(
				current.id,
				Number(identityChanged),
				Number(Boolean(next.repositories?.length)),
				JSON.stringify(repositoryIds),
				current.id,
				revision,
				current.id,
				catalog,
			),
			c.env.DB.prepare(
				`DELETE FROM scan_runs WHERE project_id = ? AND ? = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?) AND ${PROJECT_CATALOG}=?`,
			).bind(
				current.id,
				Number(identityChanged),
				current.id,
				revision,
				current.id,
				catalog,
			),
			c.env.DB.prepare(
				`UPDATE projects SET provider = ?, name = ?, organization = ?, project_key = ?, repositories_json = ?, description = ?, owner = ?, enabled = ?, revision = revision + 1, updated_at = MAX(updated_at, ?),
				 last_scanned_at = CASE WHEN ? = 1 THEN NULL ELSE last_scanned_at END,
				 scan_state = CASE WHEN ? = 1 THEN 'never' ELSE scan_state END,
				 scan_message = CASE WHEN ? = 1 THEN NULL ELSE scan_message END,
				 merge_requirements_json = CASE WHEN ? = 1 THEN '[]' ELSE merge_requirements_json END,
				 readiness_rules_json = CASE WHEN ? = 1 THEN '[]' ELSE readiness_rules_json END,
				 state_machine_json = CASE WHEN ? = 1 THEN '{"default":null,"repositories":{}}' ELSE state_machine_json END,
				 state_machine_revision = state_machine_revision + ?,
				 readiness_revision = readiness_revision + ?, scope_resolution_json = ?
				 WHERE id = ? AND revision = ? AND ${PROJECT_CATALOG}=?`,
			).bind(
				next.provider,
				next.name,
				next.organization,
				next.projectKey,
				JSON.stringify(next.repositories ?? []),
				next.description,
				next.owner,
				Number(next.enabled),
				next.updatedAt,
				Number(sourceChanged),
				Number(sourceChanged),
				Number(sourceChanged),
				Number(sourceChanged),
				Number(identityChanged),
				Number(identityChanged),
				Number(sourceChanged),
				Number(sourceChanged),
				scopeResolution,
				current.id,
				revision,
				current.id,
				catalog,
			),
			c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(current.id),
		]);
		if ((result[2]?.meta.changes ?? 0) < 1)
			return c.json(
				{ error: "This project changed. Refresh and try again." },
				409,
			);
		return c.json(mapProject(result[3]?.results[0] as ProjectRow));
	} catch (error) {
		if (isDuplicate(error))
			return c.json(
				{ error: "This Azure DevOps project is already added" },
				409,
			);
		throw error;
	}
}

export async function projectsDeleteRoute(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!raw.ok)
		return c.json(
			{ error: "Invalid project revision" },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = revisionSchema.safeParse(raw.value);
	if (!parsed.success)
		return c.json({ error: "Provide the current project revision" }, 400);
	const result = await c.env.DB.prepare(
		"DELETE FROM projects WHERE id = ? AND revision = ?",
	)
		.bind(c.req.param("id") ?? "", parsed.data.revision)
		.run();
	// SQLite/D1 may count cascaded PR and scan deletions as additional changes.
	if (result.meta.changes === 0)
		return c.json(
			{ error: "Project missing or changed. Refresh and try again." },
			409,
		);
	return c.json({ ok: true });
}

export async function projectsReadinessRoute(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c, 1024 * 1024);
	if (!raw.ok)
		return c.json(
			{ error: "Invalid readiness settings body" },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = readinessWriteSchema.safeParse(raw.value);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid readiness settings",
			},
			400,
		);
	// One statement changes only presentation fields. No collection revision,
	// snapshot, lease, or source metadata participates in this update.
	const row = await c.env.DB.prepare(
		`UPDATE projects SET readiness_rules_json = ?, readiness_revision = readiness_revision + 1, state_machine_revision=state_machine_revision+1
		 WHERE id = ? AND readiness_revision = ? AND json_extract(state_machine_json,'$.default') IS NULL
		 AND NOT EXISTS (SELECT 1 FROM json_each(state_machine_json,'$.repositories')) RETURNING *`,
	)
		.bind(
			JSON.stringify(parsed.data.rules),
			c.req.param("id") ?? "",
			parsed.data.revision,
		)
		.first<ProjectRow>();
	if (!row)
		return c.json(
			{
				error:
					"Readiness settings changed or moved to State machines. Open System → State machines to edit.",
			},
			409,
		);
	return c.json(mapProject(row));
}

/** Legacy explicit scan is discovery only. Watches are managed through commands/v1. */
export async function projectsScanRoute(c: Context<AppEnv>) {
	if (!isLocalhost(c.req.header("host") ?? ""))
		return c.json(
			{ error: "Discovery is only available on this machine" },
			403,
		);
	const raw = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!raw.ok)
		return c.json(
			{ error: raw.error },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = scanRequestSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json({ error: "Provide the current project revision" }, 400);
	if (parsed.data.pullIds?.length)
		return c.json(
			{ error: "Use the shared watch list to refresh PR checks" },
			410,
		);
	const project = await getProject(c);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (project.revision !== parsed.data.revision)
		return c.json(
			{ error: "This project changed. Refresh and try again." },
			409,
		);
	if (project.source === "demo" && !demoMode(c))
		return c.json(
			{ error: "Sample discovery is only available in local demo mode" },
			403,
		);
	try {
		const receipt = await enqueueDiscovery(
			c.env.DB,
			project,
			project.repositories ?? [],
			now(),
		);
		return c.json(mapJob(await readJob(c.env.DB, receipt.id)), 202);
	} catch (error) {
		return apiError(error, c);
	}
}
