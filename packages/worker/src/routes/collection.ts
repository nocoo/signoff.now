import {
	adoPullId,
	collectionBatchSchema,
	collectionFailureSchema,
	collectionFinishSchema,
	collectionProgressSchema,
	collectorHeartbeatSchema,
} from "@signoff/domain/collection";
import {
	type CollectionJob,
	collectionJobSchema,
	collectorStatusSchema,
	type Project,
	type PullRequest,
	pullRequestSchema,
	type ScanRun,
} from "@signoff/domain/workbench";
import type { Context } from "hono";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import type { AppEnv } from "../types.js";
import { mapProject, type ProjectRow } from "./workbench.js";

const HEARTBEAT_LIMIT = 8192;
const JOB_LIMIT = 8192;
const BATCH_LIMIT = 512 * 1024;
const LEASE_SECONDS = 120;
const CLOCK_SKEW = 300;
const now = () => Math.floor(Date.now() / 1000);
const RUNNING = `EXISTS (
	SELECT 1 FROM collection_jobs j
	INNER JOIN projects p ON p.id = j.project_id AND p.revision = j.revision AND p.enabled = 1 AND p.source = 'cli'
	WHERE j.id = ? AND j.lease_token = ? AND j.state = 'running' AND j.lease_expires_at > ?
)`;

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
	lease_token?: string | null;
	lease_expires_at?: number | null;
	pull_ids_json?: string | null;
};

function mapJob(row: JobRow): CollectionJob {
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

function rejectRemote(c: Context<AppEnv>) {
	if (isLocalhost(c.req.header("host") ?? "")) return null;
	return c.json(
		{ error: "Collector routes are only available on this machine" },
		403,
	);
}

function readError(
	raw:
		| { ok: true; value: unknown }
		| { ok: false; error: "invalid_json" | "payload_too_large" },
	invalid: string,
	large: string,
) {
	if (raw.ok) return null;
	return {
		error: raw.error === "payload_too_large" ? large : invalid,
		status: raw.error === "payload_too_large" ? 413 : 400,
	} as const;
}

async function jobById(c: Context<AppEnv>, id: string): Promise<JobRow | null> {
	return c.env.DB.prepare(
		`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, lease_token, lease_expires_at, pull_ids_json
		 FROM collection_jobs WHERE id = ?`,
	)
		.bind(id)
		.first<JobRow>();
}

async function projectById(
	c: Context<AppEnv>,
	id: string,
): Promise<Project | null> {
	const row = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
		.bind(id)
		.first<ProjectRow>();
	return row ? mapProject(row) : null;
}

function leaseActive(job: JobRow, token: string, timestamp: number): boolean {
	return (
		job.state === "running" &&
		job.lease_token === token &&
		(job.lease_expires_at ?? 0) > timestamp
	);
}

function pullError(project: Project, pull: PullRequest, seen: Set<string>) {
	if (pull.projectId !== project.id)
		return "Pull request is from a different project";
	if (pull.id !== adoPullId(project.id, pull.repository.id, pull.externalId))
		return "Pull request identity does not match its repository";
	if (pull.externalId !== String(pull.number))
		return "Pull request number does not match its identity";
	if (seen.has(pull.id)) return "Duplicate pull requests in this chunk";
	seen.add(pull.id);
	const scope = project.repositories ?? [];
	if (scope.length) {
		const allowed = new Set(scope.map((item) => item.toLowerCase()));
		if (
			!allowed.has(pull.repository.name.toLowerCase()) &&
			!allowed.has(pull.repository.id.toLowerCase())
		)
			return "Pull request is outside this project's repository scope";
	}
	if (pull.createdAt > pull.updatedAt || pull.updatedAt > pull.observedAt)
		return "Pull request timestamps are out of order";
	if (pull.observedAt > now() + CLOCK_SKEW)
		return "Pull request timestamp is in the future";
	return null;
}

export async function collectorHeartbeatRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const raw = await readJsonBodyWithSize(c, HEARTBEAT_LIMIT);
	const invalid = readError(
		raw,
		"Invalid collector heartbeat",
		"Collector heartbeat is too large",
	);
	if (invalid) return c.json({ error: invalid.error }, invalid.status);
	const parsed = collectorHeartbeatSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid collector heartbeat",
			},
			400,
		);
	const timestamp = now();
	const statements = [
		c.env.DB.prepare(
			`INSERT INTO collector_heartbeat (id, last_seen_at, state, message)
			 VALUES (1, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, state = excluded.state, message = excluded.message`,
		).bind(timestamp, parsed.data.state, parsed.data.message),
	];
	if (parsed.data.state === "ready")
		statements.push(
			c.env.DB.prepare(
				`UPDATE collection_jobs
				 SET state = 'queued', updated_at = ?, message = 'Waiting for the local collector', lease_token = NULL, lease_expires_at = NULL
				 WHERE state = 'auth_required'
				 AND EXISTS (
					SELECT 1 FROM projects p
					WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision AND p.enabled = 1 AND p.source = 'cli'
				 )`,
			).bind(timestamp),
		);
	await c.env.DB.batch(statements);
	return c.json(
		collectorStatusSchema.parse({
			lastSeenAt: timestamp,
			state: parsed.data.state,
			message: parsed.data.message,
		}),
	);
}

export async function collectorClaimRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const timestamp = now();
	const leaseToken = crypto.randomUUID();
	const results = await c.env.DB.batch([
		c.env.DB.prepare(
			`UPDATE collection_jobs
			 SET state = 'running',
			     lease_token = ?,
			     lease_expires_at = ?,
			     started_at = COALESCE(started_at, ?),
			     updated_at = ?,
			     completed_pulls = 0,
			     total_pulls = NULL,
			     message = 'Collecting pull requests'
			 WHERE id = (
				SELECT j.id FROM collection_jobs j
				INNER JOIN projects p ON p.id = j.project_id
				WHERE p.enabled = 1 AND p.source = 'cli' AND p.revision = j.revision
				  AND (j.state = 'queued' OR (j.state = 'running' AND j.lease_expires_at <= ?))
				ORDER BY j.requested_at ASC
				LIMIT 1
			 )`,
		).bind(
			leaseToken,
			timestamp + LEASE_SECONDS,
			timestamp,
			timestamp,
			timestamp,
		),
		c.env.DB.prepare(
			`DELETE FROM collection_staging
			 WHERE job_id = (SELECT id FROM collection_jobs WHERE lease_token = ? AND state = 'running' AND lease_expires_at > ?)`,
		).bind(leaseToken, timestamp),
		c.env.DB.prepare(
			`SELECT id, project_id, revision, state, requested_at, started_at, updated_at, completed_at, completed_pulls, total_pulls, message, pull_ids_json
			 FROM collection_jobs WHERE lease_token = ? AND state = 'running'`,
		).bind(leaseToken),
		c.env.DB.prepare(
			`SELECT * FROM projects WHERE id = (SELECT project_id FROM collection_jobs WHERE lease_token = ? AND state = 'running')`,
		).bind(leaseToken),
	]);
	const job = (results[2]?.results ?? [])[0] as JobRow | undefined;
	const project = (results[3]?.results ?? [])[0] as ProjectRow | undefined;
	if (!job || !project) return c.json(null);
	const mappedJob = mapJob(job);
	const targets =
		mappedJob.pullIds === undefined
			? undefined
			: (
					await c.env.DB.prepare(
						"SELECT snapshot FROM pull_requests WHERE project_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY id",
					)
						.bind(project.id, JSON.stringify(mappedJob.pullIds))
						.all<{ snapshot: string }>()
				).results.map((row) =>
					pullRequestSchema.parse(JSON.parse(row.snapshot)),
				);
	if (targets && targets.length !== mappedJob.pullIds?.length) {
		await c.env.DB.prepare(
			`UPDATE collection_jobs SET state = 'failed', updated_at = ?, completed_at = ?,
			 message = 'Visible PRs changed before collection', lease_token = NULL, lease_expires_at = NULL
			 WHERE id = ? AND lease_token = ? AND state = 'running'`,
		)
			.bind(timestamp, timestamp, job.id, leaseToken)
			.run();
		return c.json({ error: "Visible PRs changed before collection" }, 409);
	}
	return c.json({
		job: mappedJob,
		project: mapProject(project),
		leaseToken,
		targets,
	});
}

export async function collectorProgressRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const raw = await readJsonBodyWithSize(c, JOB_LIMIT);
	const invalid = readError(
		raw,
		"Invalid collection progress",
		"Collection progress is too large",
	);
	if (invalid) return c.json({ error: invalid.error }, invalid.status);
	const parsed = collectionProgressSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid collection progress",
			},
			400,
		);
	const id = c.req.param("id") ?? "";
	const job = await jobById(c, id);
	if (!job) return c.json({ error: "Collection job not found" }, 404);
	const timestamp = now();
	if (!leaseActive(job, parsed.data.leaseToken, timestamp))
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const result = await c.env.DB.prepare(
		`UPDATE collection_jobs
		 SET completed_pulls = ?, total_pulls = ?, message = ?, updated_at = ?, lease_expires_at = ?
		 WHERE id = ? AND lease_token = ? AND state = 'running' AND lease_expires_at > ?
		 AND EXISTS (
			SELECT 1 FROM projects p
			WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision AND p.enabled = 1 AND p.source = 'cli'
		 )`,
	)
		.bind(
			parsed.data.completedPulls,
			parsed.data.totalPulls,
			parsed.data.message,
			timestamp,
			timestamp + LEASE_SECONDS,
			id,
			parsed.data.leaseToken,
			timestamp,
		)
		.run();
	if (result.meta.changes !== 1)
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const next = await jobById(c, id);
	return c.json(
		mapJob(
			next ?? {
				...job,
				completed_pulls: parsed.data.completedPulls,
				total_pulls: parsed.data.totalPulls,
				message: parsed.data.message,
				updated_at: timestamp,
			},
		),
	);
}

export async function collectorBatchRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const raw = await readJsonBodyWithSize(c, BATCH_LIMIT);
	const invalid = readError(
		raw,
		"Invalid collection batch",
		"Collection batch is too large",
	);
	if (invalid) return c.json({ error: invalid.error }, invalid.status);
	const parsed = collectionBatchSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid collection batch" },
			400,
		);
	const id = c.req.param("id") ?? "";
	const job = await jobById(c, id);
	if (!job) return c.json({ error: "Collection job not found" }, 404);
	const project = await projectById(c, job.project_id);
	const timestamp = now();
	if (
		!project ||
		!leaseActive(job, parsed.data.leaseToken, timestamp) ||
		project.revision !== job.revision ||
		!project.enabled ||
		project.source !== "cli"
	)
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const seen = new Set<string>();
	const selectedIds = mapJob(job).pullIds;
	for (const pull of parsed.data.pulls) {
		if (selectedIds?.length && !selectedIds.includes(pull.id))
			return c.json(
				{ error: "Pull request is outside the visible selection" },
				400,
			);
		const error = pullError(project, pull, seen);
		if (error) return c.json({ error }, 400);
	}
	const statements = [
		c.env.DB.prepare(
			`UPDATE collection_jobs
			 SET updated_at = ?, lease_expires_at = ?
			 WHERE id = ? AND lease_token = ? AND state = 'running' AND lease_expires_at > ?
			 AND EXISTS (
				SELECT 1 FROM projects p
				WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision AND p.enabled = 1 AND p.source = 'cli'
			 )`,
		).bind(
			timestamp,
			timestamp + LEASE_SECONDS,
			id,
			parsed.data.leaseToken,
			timestamp,
		),
		...parsed.data.pulls.map((pull) =>
			c.env.DB.prepare(
				`INSERT INTO collection_staging (job_id, pull_id, project_id, repository_id, external_id, state, updated_at, snapshot)
				 SELECT ?, ?, ?, ?, ?, ?, ?, ?
				 WHERE ${RUNNING}
				 ON CONFLICT(job_id, pull_id) DO UPDATE SET
					project_id = excluded.project_id,
					repository_id = excluded.repository_id,
					external_id = excluded.external_id,
					state = excluded.state,
					updated_at = excluded.updated_at,
					snapshot = excluded.snapshot
				 WHERE ${RUNNING}`,
			).bind(
				id,
				pull.id,
				project.id,
				pull.repository.id,
				pull.externalId,
				pull.state,
				pull.updatedAt,
				JSON.stringify(pull),
				id,
				parsed.data.leaseToken,
				timestamp,
				id,
				parsed.data.leaseToken,
				timestamp,
			),
		),
	];
	const results = await c.env.DB.batch(statements);
	if (results.some((row) => row.meta.changes !== 1))
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	return c.json({ ok: true });
}

export async function collectorCompleteRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const raw = await readJsonBodyWithSize(c, 1024 * 1024);
	const invalid = readError(
		raw,
		"Invalid collection finish",
		"Collection finish is too large",
	);
	if (invalid) return c.json({ error: invalid.error }, invalid.status);
	const parsed = collectionFinishSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid collection finish" },
			400,
		);
	const id = c.req.param("id") ?? "";
	const job = await jobById(c, id);
	if (!job) return c.json({ error: "Collection job not found" }, 404);
	const project = await projectById(c, job.project_id);
	const timestamp = now();
	if (
		!project ||
		!leaseActive(job, parsed.data.leaseToken, timestamp) ||
		project.revision !== job.revision ||
		!project.enabled ||
		project.source !== "cli"
	)
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const scan: ScanRun = {
		id,
		projectId: project.id,
		source: "cli",
		state: parsed.data.state,
		startedAt: job.started_at ?? job.requested_at,
		completedAt: timestamp,
		pullRequestCount: parsed.data.pullRequestCount,
		advancedStages: 0,
		message: parsed.data.message,
	};
	const selectedIds = mapJob(job).pullIds;
	const listOnly = selectedIds?.length === 0;
	const targeted = Boolean(selectedIds?.length);
	if (targeted && parsed.data.pullRequestCount !== selectedIds?.length)
		return c.json({ error: "Upload every selected PR before finishing" }, 409);
	const finishGuard = `${RUNNING}
		AND (SELECT COUNT(*) FROM collection_staging WHERE job_id = ?) = ?
		AND (? = 1 OR ? = 'partial' OR NOT EXISTS (
			SELECT 1 FROM collection_staging WHERE job_id = ? AND json_extract(snapshot, '$.coverage') = 'partial'
		))`;
	const finishBinds = [
		id,
		parsed.data.leaseToken,
		timestamp,
		id,
		parsed.data.pullRequestCount,
		Number(listOnly),
		parsed.data.state,
		id,
	];
	const results = await c.env.DB.batch([
		c.env.DB.prepare(
			`DELETE FROM pull_requests WHERE project_id = ? AND ? = 1 AND id NOT IN (SELECT pull_id FROM collection_staging WHERE job_id = ?) AND ${finishGuard}`,
		).bind(project.id, Number(!targeted), id, ...finishBinds),
		c.env.DB.prepare(
			`INSERT INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot)
			 SELECT s.pull_id, s.project_id, s.repository_id, s.external_id, s.state,
			   MAX(s.updated_at, COALESCE(p.updated_at, 0)),
			   json_set(CASE WHEN ? = 1 AND json_extract(s.snapshot, '$.headSha') IS NOT NULL
			     AND json_extract(s.snapshot, '$.headSha') = json_extract(p.snapshot, '$.headSha')
			   THEN json_set(s.snapshot,
			     '$.policies', json_extract(p.snapshot, '$.policies'),
			     '$.builds', json_extract(p.snapshot, '$.builds'),
			     '$.reviewers', json_extract(p.snapshot, '$.reviewers'),
			     '$.requiredApprovals', json_extract(p.snapshot, '$.requiredApprovals'),
			     '$.coverage', json_extract(p.snapshot, '$.coverage'),
			     '$.collectionIssues', json(COALESCE(json_extract(p.snapshot, '$.collectionIssues'), '[]')),
			     '$.filesChanged', json_extract(p.snapshot, '$.filesChanged'),
			     '$.additions', json_extract(p.snapshot, '$.additions'),
			     '$.deletions', json_extract(p.snapshot, '$.deletions'),
			     '$.comments', json_extract(p.snapshot, '$.comments'),
			     '$.checksObservedAt', CASE WHEN json_type(p.snapshot, '$.checksObservedAt') = 'null' THEN NULL ELSE COALESCE(json_extract(p.snapshot, '$.checksObservedAt'), json_extract(p.snapshot, '$.observedAt')) END
			   ) ELSE s.snapshot END, '$.updatedAt', MAX(s.updated_at, COALESCE(p.updated_at, 0)))
			 FROM collection_staging s LEFT JOIN pull_requests p ON p.id = s.pull_id
			 WHERE s.job_id = ? AND ${finishGuard}
			 ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, snapshot = excluded.snapshot`,
		).bind(Number(listOnly), id, ...finishBinds),
		c.env.DB.prepare(
			`INSERT INTO scan_runs (id, project_id, source, state, started_at, completed_at, pull_request_count, advanced_stages, message)
			 SELECT ?, ?, 'cli', ?, ?, ?, ?, 0, ? WHERE ${finishGuard}`,
		).bind(
			id,
			project.id,
			parsed.data.state,
			scan.startedAt,
			timestamp,
			parsed.data.pullRequestCount,
			parsed.data.message,
			...finishBinds,
		),
		c.env.DB.prepare(
			`UPDATE projects
			 SET revision = revision + 1,
			 merge_requirements_json = COALESCE(?, merge_requirements_json),
			 last_scanned_at = CASE WHEN ? = 1 THEN last_scanned_at ELSE ? END,
			 scan_state = CASE WHEN ? = 1 THEN scan_state ELSE ? END,
			 scan_message = CASE WHEN ? = 1 THEN scan_message ELSE ? END, updated_at = ?
			 WHERE id = ? AND revision = ? AND source = 'cli' AND enabled = 1 AND ${finishGuard}`,
		).bind(
			parsed.data.mergeRequirements
				? JSON.stringify(parsed.data.mergeRequirements)
				: null,
			Number(targeted),
			timestamp,
			Number(targeted),
			parsed.data.state,
			Number(targeted),
			parsed.data.state === "complete" ? null : parsed.data.message,
			timestamp,
			project.id,
			job.revision,
			...finishBinds,
		),
		c.env.DB.prepare(
			// Publishing above has advanced the project's revision. The lease is
			// still owned until the last statement; bind both to clean only this run.
			`DELETE FROM collection_staging WHERE job_id = ? AND EXISTS (
				SELECT 1 FROM collection_jobs j
				INNER JOIN projects p ON p.id = j.project_id AND p.revision = j.revision + 1 AND p.enabled = 1 AND p.source = 'cli'
				INNER JOIN scan_runs s ON s.id = j.id AND s.project_id = p.id
				WHERE j.id = ? AND j.lease_token = ? AND j.state = 'running' AND j.lease_expires_at > ?
			)`,
		).bind(id, id, parsed.data.leaseToken, timestamp),
		c.env.DB.prepare(
			`UPDATE collection_jobs
			 SET state = ?, completed_at = ?, updated_at = ?, completed_pulls = ?, total_pulls = ?, message = ?, lease_token = NULL, lease_expires_at = NULL
			 WHERE id = ? AND lease_token = ? AND state = 'running' AND lease_expires_at > ? AND revision = ?
			 AND EXISTS (SELECT 1 FROM scan_runs WHERE id = collection_jobs.id)
			 AND EXISTS (
				SELECT 1 FROM projects p
				WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision + 1 AND p.enabled = 1 AND p.source = 'cli'
			 )`,
		).bind(
			parsed.data.state,
			timestamp,
			timestamp,
			parsed.data.pullRequestCount,
			parsed.data.pullRequestCount,
			parsed.data.message,
			id,
			parsed.data.leaseToken,
			timestamp,
			job.revision,
		),
	]);
	if (results[3]?.meta.changes !== 1 || results[5]?.meta.changes !== 1)
		return c.json(
			{
				error:
					"Collection is incomplete. Upload every pull request before finishing.",
			},
			409,
		);
	return c.json(scan);
}

export async function collectorFailRoute(c: Context<AppEnv>) {
	const remote = rejectRemote(c);
	if (remote) return remote;
	const raw = await readJsonBodyWithSize(c, JOB_LIMIT);
	const invalid = readError(
		raw,
		"Invalid collection failure",
		"Collection failure is too large",
	);
	if (invalid) return c.json({ error: invalid.error }, invalid.status);
	const parsed = collectionFailureSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid collection failure",
			},
			400,
		);
	const id = c.req.param("id") ?? "";
	const job = await jobById(c, id);
	if (!job) return c.json({ error: "Collection job not found" }, 404);
	const project = await projectById(c, job.project_id);
	const timestamp = now();
	if (
		!project ||
		!leaseActive(job, parsed.data.leaseToken, timestamp) ||
		project.revision !== job.revision ||
		!project.enabled ||
		project.source !== "cli"
	)
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const state =
		parsed.data.kind === "auth_required" ? "auth_required" : "failed";
	const completedAt = state === "failed" ? timestamp : null;
	const leaseBinds = [id, parsed.data.leaseToken, timestamp] as const;
	const results = await c.env.DB.batch([
		c.env.DB.prepare(
			`DELETE FROM collection_staging WHERE job_id = ? AND ${RUNNING}`,
		).bind(id, ...leaseBinds),
		c.env.DB.prepare(
			`UPDATE projects
			 SET scan_state = 'failed', scan_message = ?, updated_at = ?
			 WHERE id = ? AND revision = ? AND source = 'cli' AND enabled = 1 AND ${RUNNING}`,
		).bind(
			parsed.data.message,
			timestamp,
			job.project_id,
			job.revision,
			...leaseBinds,
		),
		c.env.DB.prepare(
			`UPDATE collection_jobs
			 SET state = ?, message = ?, updated_at = ?, completed_at = ?, lease_token = NULL, lease_expires_at = NULL
			 WHERE id = ? AND lease_token = ? AND state = 'running' AND lease_expires_at > ? AND revision = ?
			 AND EXISTS (
				SELECT 1 FROM projects p
				WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision AND p.enabled = 1 AND p.source = 'cli'
			 )`,
		).bind(
			state,
			parsed.data.message,
			timestamp,
			completedAt,
			id,
			parsed.data.leaseToken,
			timestamp,
			job.revision,
		),
	]);
	if (results[2]?.meta.changes !== 1)
		return c.json(
			{
				error:
					"This collection job is no longer active. Refresh and try again.",
			},
			409,
		);
	const next = await jobById(c, id);
	return c.json(
		mapJob(
			next ?? {
				...job,
				state,
				message: parsed.data.message,
				updated_at: timestamp,
				completed_at: completedAt,
				lease_token: null,
				lease_expires_at: null,
			},
		),
	);
}
