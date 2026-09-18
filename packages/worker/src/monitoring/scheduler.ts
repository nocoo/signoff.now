import type { CollectorClaim } from "@signoff/domain/collection";
import type { DataSource, Observation } from "@signoff/domain/monitoring";
import { pullRequestSchema } from "@signoff/domain/workbench";
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

/** Only explicit observations create periodic work. Discovery never appears here. */
export async function scheduleObservations(
	db: D1Database,
	timestamp: number,
	source?: DataSource,
) {
	const round = crypto.randomUUID();
	await db.batch([
		db
			.prepare(`UPDATE collection_jobs SET state='canceled',cancel_reason='scope_changed',updated_at=?,completed_at=?,lease_token=NULL,lease_expires_at=NULL
      WHERE state IN (${ACTIVE_JOBS}) AND (kind='full' OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id=collection_jobs.project_id AND p.revision=collection_jobs.revision AND p.source=collection_jobs.source)
      OR (kind='details' AND NOT EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=collection_jobs.observation_id AND o.generation=collection_jobs.observation_generation AND o.active=1)))`)
			.bind(timestamp, timestamp),
		db
			.prepare(`INSERT INTO collection_project_rounds(project_id) SELECT DISTINCT o.project_id FROM pr_observations o JOIN projects p ON p.id=o.project_id
      WHERE o.active=1 AND (? IS NULL OR o.source=?) ON CONFLICT(project_id) DO NOTHING`)
			.bind(source ?? null, source ?? null),
		db
			.prepare(`UPDATE collection_project_rounds SET last_completed_at=COALESCE((SELECT MAX(completed_at) FROM collection_jobs j WHERE j.round_id=collection_project_rounds.round_id AND j.project_id=collection_project_rounds.project_id),?),round_id=NULL
      WHERE round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.round_id=collection_project_rounds.round_id AND j.project_id=collection_project_rounds.project_id AND j.state IN (${ACTIVE_JOBS}))`)
			.bind(timestamp),
		db
			.prepare(`UPDATE collection_project_rounds SET round_id=?||':'||project_id WHERE round_id IS NULL
      AND EXISTS (SELECT 1 FROM collection_refresh s WHERE s.kind='details' AND s.cooldown_seconds>0 AND (collection_project_rounds.last_completed_at IS NULL OR collection_project_rounds.last_completed_at+s.cooldown_seconds<=?))
      AND EXISTS (SELECT 1 FROM pr_observations o WHERE o.project_id=collection_project_rounds.project_id AND o.active=1 AND (? IS NULL OR o.source=?))`)
			.bind(round, timestamp, source ?? null, source ?? null),
		db
			.prepare(`UPDATE collection_jobs SET round_id=(SELECT q.round_id FROM collection_project_rounds q WHERE q.project_id=collection_jobs.project_id)
      WHERE kind='details' AND round_id IS NULL AND state IN (${ACTIVE_JOBS}) AND EXISTS (SELECT 1 FROM collection_project_rounds q WHERE q.project_id=collection_jobs.project_id AND q.round_id=?||':'||q.project_id)`)
			.bind(round),
		db
			.prepare(`INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,pull_ids_json,scope_json,observation_id,observation_generation,round_id,message)
      SELECT lower(hex(randomblob(16))),p.id,p.revision,p.source,json_object('id',p.id,'provider',p.provider,'organization',p.organization,'projectKey',p.project_key,'name',p.name),
      'queued',?,?,?,'details',json_array(COALESCE(o.pull_id,p.provider||':'||p.id||':'||json_extract(o.ref_json,'$.repository.id')||':'||json_extract(o.ref_json,'$.number'))),
      json_array(json_extract(o.ref_json,'$.repository.id')),o.id,o.generation,q.round_id,'Waiting to refresh watched PR'
      FROM pr_observations o JOIN projects p ON p.id=o.project_id AND p.source=o.source JOIN collection_project_rounds q ON q.project_id=p.id
      WHERE o.active=1 AND q.round_id=?||':'||q.project_id
      AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.state IN (${ACTIVE_JOBS}))
      ORDER BY o.added_at,o.id`)
			.bind(timestamp, timestamp, timestamp, round),
	]);
}

export async function claimJob(
	db: D1Database,
	timestamp: number,
	options: {
		jobId?: string;
		kind?: "list" | "details";
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
        AND (? IS NULL OR j.id=?) AND (? IS NULL OR j.kind=?) AND (? IS NULL OR j.source=?)
        AND (j.kind='list' OR EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=j.observation_id AND o.generation=j.observation_generation AND o.active=1))
        AND NOT EXISTS (SELECT 1 FROM collection_jobs busy WHERE busy.project_id=j.project_id AND busy.state='running')
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
      WHERE j.lease_token=? AND (json_array_length(j.scope_json)=0 OR EXISTS (SELECT 1 FROM json_each(j.scope_json) s WHERE lower(s.value) IN (lower(pr.repository_id),lower(json_extract(pr.snapshot,'$.repository.name')))))`)
			.bind(token),
		db
			.prepare(`INSERT INTO collection_claim_bindings(job_id,pull_id,snapshot_version,observation_id,generation)
      SELECT j.id,COALESCE(o.pull_id,json_extract(o.ref_json,'$.provider')||':'||o.project_id||':'||json_extract(o.ref_json,'$.repository.id')||':'||json_extract(o.ref_json,'$.number')),0,o.id,o.generation
      FROM collection_jobs j JOIN pr_observations o ON o.project_id=j.project_id AND o.active=1
      WHERE j.lease_token=? AND (json_array_length(j.scope_json)=0 OR EXISTS (SELECT 1 FROM json_each(j.scope_json) s WHERE lower(s.value) IN (lower(json_extract(o.ref_json,'$.repository.id')),lower(json_extract(o.ref_json,'$.repository.name')))))
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
