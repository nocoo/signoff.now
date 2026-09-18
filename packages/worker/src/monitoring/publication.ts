import { adoPullId } from "@signoff/domain/collection";
import {
	mergeDiscoveredPull,
	type RepositoryIdentity,
} from "@signoff/domain/monitoring";
import {
	type MergeRequirement,
	type Project,
	type PullRequest,
	projectMergeRequirements,
	pullRequestSchema,
} from "@signoff/domain/workbench";
import {
	type JobRepositoryRow,
	type JobRow,
	LEASE_SECONDS,
	MonitoringError,
	type RepositoryRow,
	RUNNING_JOB,
	readJob,
	readProject,
} from "./store.js";

async function activeJob(
	db: D1Database,
	id: string,
	token: string,
	timestamp: number,
): Promise<{ job: JobRow; project: Project }> {
	const ok = await db
		.prepare(`SELECT 1 AS ok WHERE ${RUNNING_JOB}`)
		.bind(id, token, timestamp)
		.first();
	if (!ok)
		throw new MonitoringError(
			"LEASE_LOST",
			"Collection lease, project or observation generation changed",
			409,
		);
	const job = await readJob(db, id);
	const project = await readProject(db, job.project_id);
	if (!project)
		throw new MonitoringError("LEASE_LOST", "Project was removed", 409);
	return { job, project };
}

export async function registerJobRepositories(
	db: D1Database,
	id: string,
	token: string,
	repositories: RepositoryIdentity[],
	timestamp: number,
) {
	const { job, project } = await activeJob(db, id, token, timestamp);
	const scope = JSON.parse(job.scope_json) as string[];
	const known = (
		await db
			.prepare("SELECT * FROM workbench_repositories WHERE project_id=?")
			.bind(project.id)
			.all<RepositoryRow>()
	).results;
	const names = (repo: RepositoryIdentity) => [
		repo.id.toLowerCase(),
		repo.name.toLowerCase(),
		...(
			JSON.parse(
				known.find(
					(r) => r.repository_id.toLowerCase() === repo.id.toLowerCase(),
				)?.aliases_json ?? "[]",
			) as string[]
		).map((s) => s.toLowerCase()),
	];
	if (
		new Set(repositories.map((r) => r.id.toLowerCase())).size !==
			repositories.length ||
		repositories.some(
			(repo) =>
				(scope.length &&
					!scope.some((s) => names(repo).includes(s.toLowerCase()))) ||
				(project.repositories?.length &&
					!project.repositories.some((s) =>
						names(repo).includes(s.toLowerCase()),
					)),
		) ||
		scope.some(
			(s) =>
				!repositories.some((repo) => names(repo).includes(s.toLowerCase())),
		)
	)
		throw new MonitoringError(
			"INVALID_SCOPE",
			"Repository identities do not match the frozen discovery scope",
		);
	const results = await db.batch([
		db
			.prepare(
				`UPDATE collection_jobs SET repositories_resolved=1,scope_json=?,updated_at=?,lease_expires_at=? WHERE id=? AND (repositories_resolved=0 OR scope_json=?) AND ${RUNNING_JOB}`,
			)
			.bind(
				JSON.stringify(
					repositories.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
				),
				timestamp,
				timestamp + LEASE_SECONDS,
				id,
				JSON.stringify(
					repositories.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
				),
				id,
				token,
				timestamp,
			),
		db
			.prepare(`INSERT INTO collection_job_repositories(job_id,repository_id,name,project_external_id,state)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.projectExternalId'),'queued'
      FROM json_each(?) WHERE ${RUNNING_JOB} AND (SELECT scope_json FROM collection_jobs WHERE id=?)=? ON CONFLICT(job_id,repository_id) DO NOTHING`)
			.bind(
				id,
				JSON.stringify(repositories),
				id,
				token,
				timestamp,
				id,
				JSON.stringify(
					repositories.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
				),
			),
		db
			.prepare(`INSERT INTO workbench_repositories(project_id,repository_id,name,project_external_id,aliases_json)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.projectExternalId'),json_array(json_extract(value,'$.id'),json_extract(value,'$.name'))
      FROM json_each(?) WHERE ${RUNNING_JOB} AND (SELECT scope_json FROM collection_jobs WHERE id=?)=?
      ON CONFLICT(project_id,repository_id) DO UPDATE SET name=excluded.name,project_external_id=COALESCE(excluded.project_external_id,workbench_repositories.project_external_id),
      aliases_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(workbench_repositories.aliases_json) UNION SELECT excluded.name UNION SELECT excluded.repository_id))`)
			.bind(
				project.id,
				JSON.stringify(repositories),
				id,
				token,
				timestamp,
				id,
				JSON.stringify(
					repositories.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
				),
			),
	]);
	if ((results[0]?.meta.changes ?? 0) < 1)
		throw new MonitoringError(
			"LEASE_LOST",
			"Collection lease or repository plan changed",
			409,
		);
	return (
		await db
			.prepare(
				"SELECT * FROM collection_job_repositories WHERE job_id=? ORDER BY repository_id",
			)
			.bind(id)
			.all<JobRepositoryRow>()
	).results;
}

export async function stagePulls(
	db: D1Database,
	id: string,
	token: string,
	pulls: PullRequest[],
	timestamp: number,
) {
	const { job, project } = await activeJob(db, id, token, timestamp);
	const selected = JSON.parse(job.pull_ids_json ?? "[]") as string[];
	const repositories = (
		await db
			.prepare(
				"SELECT * FROM collection_job_repositories WHERE job_id=? AND state IN ('queued','running')",
			)
			.bind(id)
			.all<JobRepositoryRow>()
	).results;
	const ids = new Set<string>();
	for (const pull of pulls) {
		if (
			pull.projectId !== project.id ||
			pull.externalId !== String(pull.number) ||
			ids.has(pull.id) ||
			(project.source === "cli" &&
				pull.id !==
					adoPullId(project.id, pull.repository.id, pull.externalId)) ||
			!repositories.some((repo) => repo.repository_id === pull.repository.id) ||
			(job.kind === "details" && !selected.includes(pull.id)) ||
			pull.createdAt > pull.updatedAt ||
			pull.updatedAt > pull.observedAt ||
			pull.observedAt > timestamp + 300 ||
			(typeof pull.checksObservedAt === "number" &&
				pull.checksObservedAt > pull.observedAt)
		)
			throw new MonitoringError(
				"INVALID_PULL",
				"PR identity, scope or timestamps do not match this task",
			);
		ids.add(pull.id);
	}
	const previous = (
		await db
			.prepare(
				"SELECT id,snapshot FROM pull_requests WHERE id IN (SELECT value FROM json_each(?))",
			)
			.bind(JSON.stringify([...ids]))
			.all<{ id: string; snapshot: string }>()
	).results;
	const cached = new Map(
		previous.map((row) => [
			row.id,
			pullRequestSchema.parse(JSON.parse(row.snapshot)),
		]),
	);
	const results = await db.batch(
		pulls.map((raw) => {
			const pull =
				job.kind === "list"
					? mergeDiscoveredPull(raw, cached.get(raw.id))
					: raw;
			return db
				.prepare(`INSERT INTO collection_staging(job_id,pull_id,project_id,repository_id,external_id,state,updated_at,snapshot)
      SELECT ?,?,?,?,?,?,?,? WHERE ${RUNNING_JOB}
      AND COALESCE((SELECT version FROM pull_requests WHERE id=?),0)=COALESCE((SELECT snapshot_version FROM collection_claim_bindings WHERE job_id=? AND pull_id=?),0)
      AND NOT EXISTS (SELECT 1 FROM collection_claim_bindings b WHERE b.job_id=? AND b.pull_id=? AND b.observation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=b.observation_id AND o.active=1 AND o.generation=b.generation))
      ON CONFLICT(job_id,pull_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,snapshot=excluded.snapshot`)
				.bind(
					id,
					pull.id,
					project.id,
					pull.repository.id,
					pull.externalId,
					pull.state,
					pull.updatedAt,
					JSON.stringify(pull),
					id,
					token,
					timestamp,
					pull.id,
					id,
					pull.id,
					id,
					pull.id,
				);
		}),
	);
	if (results.some((result) => result.meta.changes < 1))
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"PR changed since the task was claimed",
			409,
		);
}

export async function publishRepository(
	db: D1Database,
	id: string,
	token: string,
	repositoryId: string,
	pullCount: number,
	state: "complete" | "partial",
	message: string,
	timestamp: number,
	mergeRequirements?: MergeRequirement[],
) {
	const { job, project } = await activeJob(db, id, token, timestamp);
	const repository = await db
		.prepare(
			"SELECT * FROM collection_job_repositories WHERE job_id=? AND repository_id=?",
		)
		.bind(id, repositoryId)
		.first<JobRepositoryRow>();
	if (!repository || !["queued", "running"].includes(repository.state))
		throw new MonitoringError(
			"INVALID_SCOPE",
			"Repository is not pending in this task",
			409,
		);
	const counts = await db
		.prepare(
			"SELECT COUNT(*) AS total,COALESCE(SUM(json_extract(snapshot,'$.coverage')='partial'),0) AS partial FROM collection_staging WHERE job_id=? AND repository_id=?",
		)
		.bind(id, repositoryId)
		.first<{ total: number; partial: number }>();
	const staged =
		job.kind === "details"
			? (
					await db
						.prepare(
							"SELECT snapshot FROM collection_staging WHERE job_id=? AND repository_id=? LIMIT 1",
						)
						.bind(id, repositoryId)
						.all<{ snapshot: string }>()
				).results.map((r) => pullRequestSchema.parse(JSON.parse(r.snapshot)))
			: [];
	if (
		counts?.total !== pullCount ||
		(job.kind === "details" && pullCount !== 1) ||
		(job.kind === "details" && state === "complete" && counts.partial > 0)
	)
		throw new MonitoringError(
			"INCOMPLETE_UPLOAD",
			"Upload every PR and declare incomplete checks before publishing",
			409,
		);
	const publication = crypto.randomUUID();
	const receipt =
		"EXISTS (SELECT 1 FROM collection_job_repositories r WHERE r.job_id=? AND r.repository_id=? AND r.publication_token=?)";
	const receiptBinds = [id, repositoryId, publication];
	const results = await db.batch([
		db
			.prepare(`UPDATE collection_job_repositories SET state='succeeded',pull_count=?,message=?,publication_token=?
      WHERE job_id=? AND repository_id=? AND state IN ('queued','running') AND ${RUNNING_JOB}
      AND (SELECT COUNT(*) FROM collection_staging WHERE job_id=? AND repository_id=?)=?
      AND NOT EXISTS (SELECT 1 FROM collection_staging s LEFT JOIN pull_requests pr ON pr.id=s.pull_id
        LEFT JOIN collection_claim_bindings b ON b.job_id=s.job_id AND b.pull_id=s.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND (COALESCE(pr.version,0)<>COALESCE(b.snapshot_version,0)
          OR (b.observation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=b.observation_id AND o.active=1 AND o.generation=b.generation))))`)
			.bind(
				pullCount,
				message,
				publication,
				id,
				repositoryId,
				id,
				token,
				timestamp,
				id,
				repositoryId,
				pullCount,
				id,
				repositoryId,
			),
		db
			.prepare(`INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot,published_at)
      SELECT s.pull_id,s.project_id,s.repository_id,s.external_id,s.state,s.updated_at,s.snapshot,? FROM collection_staging s WHERE s.job_id=? AND s.repository_id=? AND ${receipt}
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,snapshot=excluded.snapshot,published_at=excluded.published_at`)
			.bind(timestamp, id, repositoryId, ...receiptBinds),
		db
			.prepare(
				`UPDATE workbench_repositories SET last_discovered_at=?,discovery_state='complete',discovery_message=NULL WHERE project_id=? AND repository_id=? AND ?='list' AND ${receipt}`,
			)
			.bind(timestamp, project.id, repositoryId, job.kind, ...receiptBinds),
		db
			.prepare(
				`UPDATE projects SET merge_requirements_json=? WHERE id=? AND ?='details' AND ${receipt}`,
			)
			.bind(
				JSON.stringify(
					projectMergeRequirements(
						{
							...project,
							mergeRequirements: [
								...(project.mergeRequirements ?? []),
								...(mergeRequirements ?? []),
							],
						},
						staged,
					),
				),
				project.id,
				job.kind,
				...receiptBinds,
			),
		// Finish the current refresh before retiring it: the observation trigger cancels only outstanding work.
		db
			.prepare(`UPDATE collection_jobs SET state=?,updated_at=?,completed_at=?,completed_pulls=?,total_pulls=?,message=?,lease_token=NULL,lease_expires_at=NULL
      WHERE id=? AND kind='details' AND ${receipt}`)
			.bind(
				state,
				timestamp,
				timestamp,
				pullCount,
				pullCount,
				message,
				id,
				...receiptBinds,
			),
		db
			.prepare(`UPDATE pr_observations SET pull_id=(SELECT s.pull_id FROM collection_staging s JOIN collection_claim_bindings b ON b.job_id=s.job_id AND b.pull_id=s.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND b.observation_id=pr_observations.id AND b.generation=pr_observations.generation),
      active=CASE WHEN EXISTS (SELECT 1 FROM collection_staging s JOIN collection_claim_bindings b ON b.job_id=s.job_id AND b.pull_id=s.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND b.observation_id=pr_observations.id AND b.generation=pr_observations.generation AND s.state IN ('merged','closed')) THEN 0 ELSE active END,
      stopped_at=CASE WHEN EXISTS (SELECT 1 FROM collection_staging s JOIN collection_claim_bindings b ON b.job_id=s.job_id AND b.pull_id=s.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND b.observation_id=pr_observations.id AND b.generation=pr_observations.generation AND s.state IN ('merged','closed')) THEN ? ELSE stopped_at END,
      stop_reason=(SELECT CASE s.state WHEN 'merged' THEN 'completed' WHEN 'closed' THEN 'abandoned' ELSE pr_observations.stop_reason END
        FROM collection_staging s JOIN collection_claim_bindings b ON b.job_id=s.job_id AND b.pull_id=s.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND b.observation_id=pr_observations.id AND b.generation=pr_observations.generation)
      WHERE active=1 AND EXISTS (SELECT 1 FROM collection_claim_bindings b JOIN collection_staging s ON s.job_id=b.job_id AND s.pull_id=b.pull_id
        WHERE s.job_id=? AND s.repository_id=? AND b.observation_id=pr_observations.id AND b.generation=pr_observations.generation) AND ${receipt}`)
			.bind(
				id,
				repositoryId,
				id,
				repositoryId,
				id,
				repositoryId,
				timestamp,
				id,
				repositoryId,
				id,
				repositoryId,
				...receiptBinds,
			),
		db
			.prepare(
				`DELETE FROM collection_staging WHERE job_id=? AND repository_id=? AND ${receipt}`,
			)
			.bind(id, repositoryId, ...receiptBinds),
	]);
	if ((results[0]?.meta.changes ?? 0) < 1)
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Lease or PR snapshot changed before publication",
			409,
		);
	return readJob(db, id);
}

export async function rejectRepository(
	db: D1Database,
	id: string,
	token: string,
	repositoryId: string,
	message: string,
	timestamp: number,
) {
	const results = await db.batch([
		db
			.prepare(
				`UPDATE collection_job_repositories SET state='failed',pull_count=NULL,message=? WHERE job_id=? AND repository_id=? AND state IN ('queued','running') AND ${RUNNING_JOB}`,
			)
			.bind(message, id, repositoryId, id, token, timestamp),
		db
			.prepare(
				`UPDATE workbench_repositories SET discovery_state='failed',discovery_message=? WHERE project_id=(SELECT project_id FROM collection_jobs WHERE id=? AND kind='list') AND repository_id=? AND ${RUNNING_JOB}`,
			)
			.bind(message, id, repositoryId, id, token, timestamp),
		db
			.prepare(
				`DELETE FROM collection_staging WHERE job_id=? AND repository_id=? AND ${RUNNING_JOB}`,
			)
			.bind(id, repositoryId, id, token, timestamp),
	]);
	if ((results[0]?.meta.changes ?? 0) < 1)
		throw new MonitoringError(
			"LEASE_LOST",
			"Repository or collection lease changed",
			409,
		);
}

export async function completeJob(
	db: D1Database,
	id: string,
	token: string,
	timestamp: number,
) {
	const { job } = await activeJob(db, id, token, timestamp);
	if (job.kind !== "list")
		throw new MonitoringError(
			"INCOMPLETE_UPLOAD",
			"Refresh finishes with its PR publication",
			409,
		);
	const result = await db
		.prepare(`UPDATE collection_jobs SET state=CASE
      WHEN NOT EXISTS (SELECT 1 FROM collection_job_repositories r WHERE r.job_id=collection_jobs.id AND r.state='failed') THEN 'complete'
      WHEN EXISTS (SELECT 1 FROM collection_job_repositories r WHERE r.job_id=collection_jobs.id AND r.state='succeeded') THEN 'partial' ELSE 'failed' END,
      updated_at=?,completed_at=?,completed_pulls=COALESCE((SELECT SUM(pull_count) FROM collection_job_repositories WHERE job_id=collection_jobs.id),0),
      total_pulls=(SELECT SUM(pull_count) FROM collection_job_repositories WHERE job_id=collection_jobs.id),
      message='Repository discovery finished',lease_token=NULL,lease_expires_at=NULL
      WHERE id=? AND repositories_resolved=1 AND ${RUNNING_JOB}
      AND NOT EXISTS (SELECT 1 FROM collection_job_repositories r WHERE r.job_id=collection_jobs.id AND r.state IN ('queued','running','canceled'))`)
		.bind(timestamp, timestamp, id, id, token, timestamp)
		.run();
	if (result.meta.changes < 1)
		throw new MonitoringError(
			"INCOMPLETE_UPLOAD",
			"Finish every repository before completing discovery",
			409,
		);
	return readJob(db, id);
}
