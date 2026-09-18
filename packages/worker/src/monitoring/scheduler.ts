import type { CollectorClaim } from "@signoff/domain/collection";
import type { DataSource, Observation } from "@signoff/domain/monitoring";
import {
	type CollectionLane,
	pullRequestSchema,
} from "@signoff/domain/workbench";
import {
	ACTIVE_JOBS,
	type JobRow,
	LEASE_SECONDS,
	MonitoringError,
	mapJob,
	mapObservation,
	mapProject,
	type ObservationRow,
	type ProjectRow,
	RUNNING_JOB,
	readJob,
} from "./store.js";

export const STATUS_COOLDOWN_SECONDS = 30;
export const LANE_CONCURRENCY = 2;

/** A separately leased lane keeps slow policy/build work out of lifecycle polling. */
export async function scheduleSummaries(
	db: D1Database,
	timestamp: number,
	source?: DataSource,
) {
	await db.batch([
		db
			.prepare(
				`DELETE FROM collection_jobs WHERE summary_only=1 AND completed_at<? AND state NOT IN (${ACTIVE_JOBS})`,
			)
			.bind(timestamp - 86400),
		db
			.prepare(`INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,pull_ids_json,scope_json,observation_id,observation_generation,summary_only,message)
      SELECT lower(hex(randomblob(16))),p.id,p.revision,p.source,json_object('id',p.id,'provider',p.provider,'organization',p.organization,'projectKey',p.project_key,'name',p.name),
      'queued',?,?,?,'details',json_array(COALESCE(o.pull_id,p.provider||':'||p.id||':'||json_extract(o.ref_json,'$.repository.id')||':'||json_extract(o.ref_json,'$.number'))),
      json_array(json_extract(o.ref_json,'$.repository.id')),o.id,o.generation,1,'Waiting to check PR state'
      FROM pr_observations o JOIN projects p ON p.id=o.project_id AND p.source=o.source
      WHERE o.active=1 AND (? IS NULL OR o.source=?)
      AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=1
        AND (j.state IN (${ACTIVE_JOBS}) OR j.completed_at>?))
      ORDER BY o.added_at,o.id`)
			.bind(
				timestamp,
				timestamp,
				timestamp,
				source ?? null,
				source ?? null,
				timestamp - STATUS_COOLDOWN_SECONDS,
			),
	]);
}

/** Only explicit observations create periodic work. Discovery never appears here. */
export async function scheduleObservations(
	db: D1Database,
	timestamp: number,
	source?: DataSource,
) {
	await db.batch([
		db
			.prepare(`UPDATE collection_jobs SET state='canceled',cancel_reason='scope_changed',updated_at=?,completed_at=?,lease_token=NULL,lease_expires_at=NULL
      WHERE state IN (${ACTIVE_JOBS}) AND (kind='full' OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id=collection_jobs.project_id AND p.revision=collection_jobs.revision AND p.source=collection_jobs.source)
      OR (kind='details' AND NOT EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=collection_jobs.observation_id AND o.generation=collection_jobs.observation_generation AND o.active=1)))`)
			.bind(timestamp, timestamp),
		db
			.prepare(`INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,pull_ids_json,scope_json,observation_id,observation_generation,message)
      SELECT lower(hex(randomblob(16))),p.id,p.revision,p.source,json_object('id',p.id,'provider',p.provider,'organization',p.organization,'projectKey',p.project_key,'name',p.name),
      'queued',?,?,?,'details',json_array(COALESCE(o.pull_id,p.provider||':'||p.id||':'||json_extract(o.ref_json,'$.repository.id')||':'||json_extract(o.ref_json,'$.number'))),
      json_array(json_extract(o.ref_json,'$.repository.id')),o.id,o.generation,'Waiting to refresh watched PR'
      FROM pr_observations o JOIN projects p ON p.id=o.project_id AND p.source=o.source
      JOIN collection_refresh settings ON settings.kind='details' AND settings.cooldown_seconds>0
      WHERE o.active=1 AND (? IS NULL OR o.source=?)
      AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=0
        AND (j.state IN (${ACTIVE_JOBS}) OR j.completed_at> ?-settings.cooldown_seconds))
      ORDER BY o.added_at,o.id`)
			.bind(
				timestamp,
				timestamp,
				timestamp,
				source ?? null,
				source ?? null,
				timestamp,
			),
	]);
}

export async function claimJob(
	db: D1Database,
	timestamp: number,
	options: {
		jobId?: string;
		kind?: "list" | "details";
		lane?: CollectionLane;
		source?: DataSource;
	} = {},
): Promise<CollectorClaim | null> {
	const token = crypto.randomUUID();
	const results = await db.batch([
		db
			.prepare(
				"UPDATE collection_jobs SET state='queued',lease_token=NULL,lease_expires_at=NULL WHERE state='running' AND lease_expires_at<=?",
			)
			.bind(timestamp),
		db
			.prepare(`UPDATE collection_jobs SET state='running',lease_token=?,lease_expires_at=?,started_at=COALESCE(started_at,?),updated_at=?,attempts=attempts+1,
      completed_pulls=0,total_pulls=NULL,message='Collecting PR data' WHERE id=(
      SELECT j.id FROM collection_jobs j JOIN projects p ON p.id=j.project_id AND p.revision=j.revision AND p.source=j.source
      WHERE j.state IN ('queued','auth_required') AND j.not_before<=? AND j.kind<>'full'
        AND (? IS NULL OR j.id=?) AND (? IS NULL OR j.kind=?) AND (? IS NULL OR j.source=?) AND j.summary_only=?
        AND (j.kind='list' OR EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=j.observation_id AND o.generation=j.observation_generation AND o.active=1))
        AND (SELECT COUNT(*) FROM collection_jobs busy WHERE busy.project_id=j.project_id AND busy.summary_only=j.summary_only AND busy.state='running')<${LANE_CONCURRENCY}
        AND NOT EXISTS (SELECT 1 FROM collection_jobs busy WHERE busy.project_id=j.project_id AND busy.summary_only=j.summary_only AND busy.state='running' AND (j.kind='list' OR busy.kind='list'))
        AND NOT EXISTS (SELECT 1 FROM collection_jobs discovery WHERE discovery.project_id=j.project_id AND discovery.kind='list' AND discovery.state='queued'
          AND j.kind='details' AND j.summary_only=0 AND discovery.requested_at<j.requested_at)
        AND NOT EXISTS (SELECT 1 FROM collection_jobs auth WHERE auth.project_id=j.project_id AND auth.state='auth_required' AND auth.not_before>?)
      ORDER BY j.requested_at,j.rowid LIMIT 1)`)
			.bind(
				token,
				timestamp + LEASE_SECONDS,
				timestamp,
				timestamp,
				timestamp,
				options.jobId ?? null,
				options.jobId ?? null,
				options.kind ?? null,
				options.kind ?? null,
				options.source ?? null,
				options.source ?? null,
				Number(options.lane === "status"),
				timestamp,
			),
		db
			.prepare(
				"DELETE FROM collection_staging WHERE job_id IN (SELECT id FROM collection_jobs WHERE lease_token=?)",
			)
			.bind(token),
		db
			.prepare(
				"DELETE FROM collection_claim_bindings WHERE job_id IN (SELECT id FROM collection_jobs WHERE lease_token=?)",
			)
			.bind(token),
		db
			.prepare(`INSERT INTO collection_claim_bindings(job_id,pull_id,snapshot_version,observation_id,generation)
      SELECT j.id,pr.id,pr.version,o.id,o.generation FROM collection_jobs j JOIN pull_requests pr ON pr.project_id=j.project_id
      LEFT JOIN pr_observations o ON o.project_id=j.project_id AND o.active=1 AND lower(json_extract(o.ref_json,'$.repository.id'))=lower(pr.repository_id) AND json_extract(o.ref_json,'$.number')=CAST(pr.external_id AS INTEGER)
      WHERE j.lease_token=? AND (j.kind='list' OR pr.id IN (SELECT value FROM json_each(j.pull_ids_json)))
      AND (json_array_length(j.scope_json)=0 OR EXISTS (SELECT 1 FROM json_each(j.scope_json) s WHERE lower(s.value) IN (lower(pr.repository_id),lower(json_extract(pr.snapshot,'$.repository.name')))))`)
			.bind(token),
		db
			.prepare(`INSERT INTO collection_claim_bindings(job_id,pull_id,snapshot_version,observation_id,generation)
      SELECT j.id,COALESCE(o.pull_id,json_extract(o.ref_json,'$.provider')||':'||o.project_id||':'||json_extract(o.ref_json,'$.repository.id')||':'||json_extract(o.ref_json,'$.number')),0,o.id,o.generation
      FROM collection_jobs j JOIN pr_observations o ON o.project_id=j.project_id AND o.active=1
      WHERE j.lease_token=? AND (j.kind='list' OR (o.id=j.observation_id AND o.generation=j.observation_generation))
      AND (json_array_length(j.scope_json)=0 OR EXISTS (SELECT 1 FROM json_each(j.scope_json) s WHERE lower(s.value) IN (lower(json_extract(o.ref_json,'$.repository.id')),lower(json_extract(o.ref_json,'$.repository.name')))))
      ON CONFLICT(job_id,pull_id) DO NOTHING`)
			.bind(token),
		db.prepare("SELECT * FROM collection_jobs WHERE lease_token=?").bind(token),
		db
			.prepare(
				"SELECT p.* FROM projects p JOIN collection_jobs j ON j.project_id=p.id WHERE j.lease_token=?",
			)
			.bind(token),
		db
			.prepare(
				"SELECT o.* FROM pr_observations o JOIN collection_jobs j ON j.observation_id=o.id AND j.observation_generation=o.generation WHERE j.lease_token=?",
			)
			.bind(token),
		db
			.prepare(
				"SELECT pr.snapshot FROM pull_requests pr JOIN collection_jobs j ON j.project_id=pr.project_id WHERE j.lease_token=? AND pr.id IN (SELECT value FROM json_each(j.pull_ids_json))",
			)
			.bind(token),
		db
			.prepare(
				"SELECT r.* FROM collection_job_repositories r JOIN collection_jobs j ON j.id=r.job_id WHERE j.lease_token=? ORDER BY r.repository_id",
			)
			.bind(token),
	]);
	const job = results[6]?.results[0] as JobRow | undefined;
	const project = results[7]?.results[0] as ProjectRow | undefined;
	if (!job || !project) return null;
	const observationRow = results[8]?.results[0] as ObservationRow | undefined;
	const observation: Observation | undefined = observationRow
		? mapObservation(observationRow)
		: undefined;
	return {
		job: mapJob(job),
		project: mapProject(project),
		leaseToken: token,
		observation,
		scope: JSON.parse(job.scope_json) as string[],
		repositories: job.repositories_resolved
			? (
					(results[10]?.results ?? []) as {
						repository_id: string;
						name: string;
						project_external_id: string | null;
					}[]
				).map((r) => ({
					id: r.repository_id,
					name: r.name,
					...(r.project_external_id
						? { projectExternalId: r.project_external_id }
						: {}),
				}))
			: undefined,
		targets: (results[9]?.results as { snapshot: string }[]).map((r) =>
			pullRequestSchema.parse(JSON.parse(r.snapshot)),
		),
	};
}

export async function renewJob(
	db: D1Database,
	id: string,
	token: string,
	timestamp: number,
	progress?: {
		completedPulls: number;
		totalPulls: number | null;
		message: string;
	},
) {
	const result = await db
		.prepare(`UPDATE collection_jobs SET lease_expires_at=?,updated_at=?,completed_pulls=COALESCE(?,completed_pulls),
    total_pulls=CASE WHEN ?=1 THEN ? ELSE total_pulls END,message=COALESCE(?,message) WHERE id=? AND ${RUNNING_JOB}`)
		.bind(
			timestamp + LEASE_SECONDS,
			timestamp,
			progress?.completedPulls ?? null,
			Number(Boolean(progress)),
			progress?.totalPulls ?? null,
			progress?.message ?? null,
			id,
			id,
			token,
			timestamp,
		)
		.run();
	if (result.meta.changes < 1)
		throw new MonitoringError(
			"LEASE_LOST",
			"Collection lease or observation generation changed",
			409,
		);
	return readJob(db, id);
}

export async function failJob(
	db: D1Database,
	id: string,
	token: string,
	kind: string,
	message: string,
	timestamp: number,
) {
	const row = await readJob(db, id);
	const auth = kind === "auth_required";
	const retryAt =
		timestamp + Math.min(60, 15 * 2 ** Math.min(row.attempts - 1, 3));
	const results = await db.batch([
		db
			.prepare(
				`DELETE FROM collection_staging WHERE job_id=? AND ${RUNNING_JOB}`,
			)
			.bind(id, id, token, timestamp),
		db
			.prepare(
				`UPDATE collection_job_repositories SET state='failed',message=? WHERE job_id=? AND state IN ('queued','running') AND ?=0 AND ${RUNNING_JOB}`,
			)
			.bind(message, id, Number(auth), id, token, timestamp),
		db
			.prepare(
				`UPDATE collection_jobs SET state=?,error_kind=?,message=?,updated_at=?,completed_at=?,not_before=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND ${RUNNING_JOB}`,
			)
			.bind(
				auth ? "auth_required" : "failed",
				kind,
				message.slice(0, 1000),
				timestamp,
				auth ? null : timestamp,
				auth ? retryAt : timestamp,
				id,
				id,
				token,
				timestamp,
			),
	]);
	if ((results[2]?.meta.changes ?? 0) < 1)
		throw new MonitoringError(
			"LEASE_LOST",
			"Collection lease or observation generation changed",
			409,
		);
	return readJob(db, id);
}
