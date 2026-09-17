import { advanceDemoPull, makeDemoPulls } from "@signoff/domain/demo";
import {
	type CollectionJob,
	collectionJobSchema,
	collectorStatusSchema,
	type Project,
	type PullRequest,
	projectPatchSchema,
	projectSchema,
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
import type { AppEnv } from "../types.js";

export type ProjectRow = {
	id: string;
	provider: string;
	name: string;
	organization: string;
	project_key: string;
	repositories_json?: string;
	readiness_rules_json?: string;
	readiness_revision?: number;
	description: string;
	owner: string;
	enabled: number;
	source: string;
	revision: number;
	created_at: number;
	updated_at: number;
	last_scanned_at: number | null;
	scan_state: string;
	scan_message: string | null;
};
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

export function mapProject(row: ProjectRow): Project {
	const parsed: unknown = JSON.parse(row.repositories_json || "[]");
	const repositories = Array.isArray(parsed)
		? parsed.filter((item): item is string => typeof item === "string")
		: [];
	return projectSchema.parse({
		id: row.id,
		provider: row.provider,
		name: row.name,
		organization: row.organization,
		projectKey: row.project_key,
		repositories,
		readinessRules: JSON.parse(row.readiness_rules_json || "[]"),
		readinessRevision: row.readiness_revision ?? 1,
		description: row.description,
		owner: row.owner,
		enabled: row.enabled === 1,
		source: row.source,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastScannedAt: row.last_scanned_at,
		scanState: row.scan_state,
		scanMessage: row.scan_message,
	});
}
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
	});
}
function scopeKey(items: string[] | undefined) {
	return JSON.stringify(
		[...(items ?? [])]
			.map((item) => item.toLowerCase())
			.sort((left, right) => left.localeCompare(right)),
	);
}

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
			`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, pull_ids_json
			 FROM collection_jobs
			 ORDER BY CASE WHEN state IN ('queued', 'running', 'auth_required') THEN 0 ELSE 1 END, updated_at DESC
			 LIMIT 20`,
		),
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
	const sourceChanged =
		current.provider !== next.provider ||
		current.organization.toLowerCase() !== next.organization.toLowerCase() ||
		current.projectKey.toLowerCase() !== next.projectKey.toLowerCase() ||
		scopeKey(current.repositories) !== scopeKey(next.repositories);
	if (sourceChanged) {
		next.lastScannedAt = null;
		next.scanState = "never";
		next.scanMessage = null;
	}
	try {
		// Guard dependent deletes with the OLD revision and run them before the
		// CAS update, in the same transaction. Zero-row updates do not roll D1 back.
		const result = await c.env.DB.batch([
			c.env.DB.prepare(
				`DELETE FROM pull_requests WHERE project_id = ? AND ? = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)`,
			).bind(current.id, Number(sourceChanged), current.id, revision),
			c.env.DB.prepare(
				`DELETE FROM scan_runs WHERE project_id = ? AND ? = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)`,
			).bind(current.id, Number(sourceChanged), current.id, revision),
			c.env.DB.prepare(
				`DELETE FROM collection_staging WHERE job_id IN (
					SELECT id FROM collection_jobs WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required')
				) AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)`,
			).bind(current.id, current.id, revision),
			c.env.DB.prepare(
				`UPDATE collection_jobs
				 SET state = 'failed', message = 'Project changed', completed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
				 WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required')
				 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)`,
			).bind(next.updatedAt, next.updatedAt, current.id, current.id, revision),
			c.env.DB.prepare(
				`UPDATE projects SET provider = ?, name = ?, organization = ?, project_key = ?, repositories_json = ?, description = ?, owner = ?, enabled = ?, revision = revision + 1, updated_at = ?, last_scanned_at = ?, scan_state = ?, scan_message = ? WHERE id = ? AND revision = ?`,
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
				next.lastScannedAt,
				next.scanState,
				next.scanMessage,
				current.id,
				revision,
			),
		]);
		if (result[4]?.meta.changes !== 1)
			return c.json(
				{ error: "This project changed. Refresh and try again." },
				409,
			);
	} catch (error) {
		if (isDuplicate(error))
			return c.json(
				{ error: "This Azure DevOps project is already added" },
				409,
			);
		throw error;
	}
	return c.json(next);
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
	const raw = await readJsonBodyWithSize(c, 65536);
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
		`UPDATE projects SET readiness_rules_json = ?, readiness_revision = readiness_revision + 1
		 WHERE id = ? AND readiness_revision = ? RETURNING *`,
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
					"Readiness settings changed or the project was removed. Reopen settings and try again.",
			},
			409,
		);
	return c.json(mapProject(row));
}

async function enqueueCliScan(
	c: Context<AppEnv>,
	project: Project,
	pullIds?: string[],
) {
	const active = await c.env.DB.prepare(
		`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, pull_ids_json
		 FROM collection_jobs
		 WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required') AND revision = ?
		 LIMIT 1`,
	)
		.bind(project.id, project.revision)
		.first<JobRow>();
	if (active) return c.json(mapCollectionJob(active));
	const timestamp = now();
	const id = crypto.randomUUID();
	const results = await c.env.DB.batch([
		c.env.DB.prepare(
			`DELETE FROM collection_staging WHERE job_id IN (
				SELECT id FROM collection_jobs
				WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required') AND revision != ?
			) AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ? AND source = 'cli' AND enabled = 1)`,
		).bind(project.id, project.revision, project.id, project.revision),
		c.env.DB.prepare(
			`UPDATE collection_jobs
			 SET state = 'failed', message = 'Project changed', completed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
			 WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required') AND revision != ?
			 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ? AND source = 'cli' AND enabled = 1)`,
		).bind(
			timestamp,
			timestamp,
			project.id,
			project.revision,
			project.id,
			project.revision,
		),
		c.env.DB.prepare(
			`INSERT INTO collection_jobs (id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, lease_token, lease_expires_at, pull_ids_json)
			 SELECT ?, ?, ?, 'queued', ?, NULL, ?, NULL, 0, NULL, 'Waiting for the local collector', NULL, NULL, ?
			 WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ? AND source = 'cli' AND enabled = 1)
			 AND NOT EXISTS (
				SELECT 1 FROM collection_jobs WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required')
			 )`,
		).bind(
			id,
			project.id,
			project.revision,
			timestamp,
			timestamp,
			pullIds === undefined ? null : JSON.stringify(pullIds),
			project.id,
			project.revision,
			project.id,
		),
	]);
	if (results[2]?.meta.changes !== 1) {
		const again = await c.env.DB.prepare(
			`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, pull_ids_json
			 FROM collection_jobs
			 WHERE project_id = ? AND state IN ('queued', 'running', 'auth_required') AND revision = ?
			 LIMIT 1`,
		)
			.bind(project.id, project.revision)
			.first<JobRow>();
		if (again) return c.json(mapCollectionJob(again));
		return c.json(
			{ error: "This project changed. Refresh and try again." },
			409,
		);
	}
	return c.json(
		mapCollectionJob({
			id,
			project_id: project.id,
			revision: project.revision,
			state: "queued",
			requested_at: timestamp,
			started_at: null,
			updated_at: timestamp,
			completed_at: null,
			completed_pulls: 0,
			total_pulls: null,
			message: "Waiting for the local collector",
			pull_ids_json: pullIds === undefined ? null : JSON.stringify(pullIds),
		}),
	);
}

export async function projectsScanRoute(c: Context<AppEnv>) {
	if (!isLocalhost(c.req.header("host") ?? ""))
		return c.json({ error: "Scanning is only available on this machine" }, 403);
	const raw = await readJsonBodyWithSize(c, BODY_LIMIT);
	if (!raw.ok)
		return c.json(
			{ error: "Invalid project revision" },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = scanRequestSchema.safeParse(raw.value);
	if (!parsed.success)
		return c.json({ error: "Provide the current project revision" }, 400);
	const project = await getProject(c);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.enabled)
		return c.json(
			{ error: "Resume monitoring before scanning this project" },
			409,
		);
	if (project.revision !== parsed.data.revision)
		return c.json(
			{ error: "This project changed. Refresh and try again." },
			409,
		);
	if (project.source === "cli") {
		if (project.provider !== "ado")
			return c.json(
				{ error: "Live GitHub collection is not available yet" },
				400,
			);
		const { pullIds } = parsed.data;
		if (pullIds?.length) {
			const known = await c.env.DB.prepare(
				"SELECT id FROM pull_requests WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))",
			)
				.bind(project.id, JSON.stringify(pullIds))
				.all();
			if (known.results.length !== pullIds.length)
				return c.json(
					{ error: "Select PRs from this project's current snapshot" },
					400,
				);
		}
		return enqueueCliScan(c, project, pullIds);
	}
	if (!demoMode(c))
		return c.json(
			{ error: "Demo scanning is only available in local demo mode" },
			403,
		);
	const stored = await c.env.DB.prepare(
		"SELECT snapshot FROM pull_requests WHERE project_id = ? ORDER BY id LIMIT 41",
	)
		.bind(project.id)
		.all<{ snapshot: string }>();
	if (stored.results.length > 40)
		return c.json(
			{ error: "Demo scans support up to 40 sample PRs per project" },
			400,
		);
	const timestamp = now();
	const id = crypto.randomUUID();
	const existing = stored.results.map((r) =>
		pullRequestSchema.parse(JSON.parse(r.snapshot)),
	);
	const advanced = existing.map((pr) => advanceDemoPull(pr, timestamp, id));
	const pulls: PullRequest[] = existing.length
		? advanced.map((r) => r.pull)
		: makeDemoPulls(project, timestamp);
	const advancedStages = advanced.reduce((sum, r) => sum + r.advancedStages, 0);
	const scan: ScanRun = {
		id,
		projectId: project.id,
		source: "demo",
		state: "complete",
		startedAt: timestamp,
		completedAt: timestamp,
		pullRequestCount: pulls.length,
		advancedStages,
		message: `Scanned ${pulls.length} sample PRs; updated ${advancedStages} build stages.`,
	};
	const guard =
		"EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ? AND source = 'demo' AND enabled = 1)";
	const statements = pulls.map((pr) =>
		c.env.DB.prepare(`INSERT INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot)
		SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
		ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, snapshot = excluded.snapshot WHERE pull_requests.project_id = excluded.project_id`).bind(
			pr.id,
			project.id,
			pr.repository.id,
			pr.externalId,
			pr.state,
			pr.updatedAt,
			JSON.stringify(pr),
			project.id,
			project.revision,
		),
	);
	statements.push(
		c.env.DB.prepare(`INSERT INTO scan_runs (id, project_id, source, state, started_at, completed_at, pull_request_count, advanced_stages, message)
		SELECT ?, ?, 'demo', 'complete', ?, ?, ?, ?, ? WHERE ${guard}`).bind(
			id,
			project.id,
			timestamp,
			timestamp,
			pulls.length,
			advancedStages,
			scan.message,
			project.id,
			project.revision,
		),
	);
	// Updating the revision last makes every dependent write use the same guard.
	statements.push(
		c.env.DB.prepare(
			`UPDATE projects SET revision = revision + 1, last_scanned_at = ?, scan_state = 'complete', scan_message = NULL WHERE id = ? AND revision = ? AND source = 'demo' AND enabled = 1`,
		).bind(timestamp, project.id, project.revision),
	);
	const results = await c.env.DB.batch(statements);
	if (results[results.length - 1]?.meta.changes !== 1)
		return c.json(
			{ error: "This project changed during the scan. Refresh and try again." },
			409,
		);
	return c.json(scan);
}
