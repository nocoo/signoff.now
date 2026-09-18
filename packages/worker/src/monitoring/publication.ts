import {
	adoPullId,
	type CollectedRepository,
	discoveryCursorSchema,
} from "@signoff/domain/collection";
import {
	matchesRepositoryReference,
	mergeCollectedPull,
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
	repositories: CollectedRepository[],
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
	const aliases = (repo: RepositoryIdentity) =>
		JSON.parse(
			known.find((r) => r.repository_id.toLowerCase() === repo.id.toLowerCase())
				?.aliases_json ?? "[]",
		) as string[];
	const knownIds = [
		...known.map((r) => r.repository_id),
		...repositories.map((r) => r.id),
	];
	const matchesScope = (
		repo: RepositoryIdentity,
		value: string,
		resolved = false,
	) =>
		resolved
			? repo.id.toLowerCase() === value.toLowerCase()
			: matchesRepositoryReference(
					{ ...repo, aliases: aliases(repo) },
					value,
					project.provider,
					knownIds,
				);
	if (
		new Set(repositories.map((r) => r.id.toLowerCase())).size !==
			repositories.length ||
		repositories.some(
			(repo) =>
				(repo.observedAt !== undefined && repo.observedAt > timestamp + 300) ||
				(scope.length &&
					!scope.some((s) =>
						matchesScope(repo, s, job.repositories_resolved === 1),
					)) ||
				(project.repositories?.length &&
					!project.repositories.some((s) => matchesScope(repo, s))),
		) ||
		scope.some(
			(s) =>
				!repositories.some((repo) =>
					matchesScope(repo, s, job.repositories_resolved === 1),
				),
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
			.prepare(`INSERT INTO collection_job_repositories(job_id,repository_id,name,project_external_id,state,discovery_cursor_json)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.projectExternalId'),'queued',
      (SELECT r.discovery_cursor_json FROM workbench_repositories r WHERE r.project_id=? AND r.repository_id=json_extract(value,'$.id') AND ?=0)
      FROM json_each(?) WHERE ${RUNNING_JOB} AND (SELECT scope_json FROM collection_jobs WHERE id=?)=? ON CONFLICT(job_id,repository_id) DO NOTHING`)
			.bind(
				id,
				project.id,
				job.full_discovery,
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
			.prepare(`INSERT INTO workbench_repositories(project_id,repository_id,name,project_external_id,aliases_json,name_observed_at)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.projectExternalId'),json_array(json_extract(value,'$.id'),json_extract(value,'$.name')),COALESCE(json_extract(value,'$.observedAt'),?)
      FROM json_each(?) WHERE ${RUNNING_JOB} AND (SELECT scope_json FROM collection_jobs WHERE id=?)=? AND ?='list'
      ON CONFLICT(project_id,repository_id) DO UPDATE SET name=CASE WHEN excluded.name_observed_at>=workbench_repositories.name_observed_at THEN excluded.name ELSE workbench_repositories.name END,
      name_observed_at=MAX(excluded.name_observed_at,workbench_repositories.name_observed_at),project_external_id=COALESCE(excluded.project_external_id,workbench_repositories.project_external_id),
      aliases_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(workbench_repositories.aliases_json) UNION SELECT excluded.name UNION SELECT excluded.repository_id))`)
			.bind(
				project.id,
				timestamp,
				JSON.stringify(repositories),
				id,
				token,
				timestamp,
				id,
				JSON.stringify(
					repositories.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
				),
				job.kind,
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
	).results.map((row) => ({
		...row,
		discoveryCursor: row.discovery_cursor_json
			? discoveryCursorSchema.parse(JSON.parse(row.discovery_cursor_json))
			: null,
	}));
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
				pull.checksObservedAt > pull.observedAt) ||
			(pull.summaryObservedAt !== undefined &&
				Math.floor(pull.summaryObservedAt) > pull.observedAt)
		)
			throw new MonitoringError(
				"INVALID_PULL",
				"PR identity, scope or timestamps do not match this task",
			);
		ids.add(pull.id);
	}
	const cachedRows = (
		await db
			.prepare(
				"SELECT id,snapshot,version FROM pull_requests WHERE id IN (SELECT value FROM json_each(?))",
			)
			.bind(JSON.stringify([...ids]))
			.all<{ id: string; snapshot: string; version: number }>()
	).results;
	const cached = new Map(
		cachedRows.map((row) => [
			row.id,
			{
				pull: pullRequestSchema.parse(JSON.parse(row.snapshot)),
				version: row.version,
			},
		]),
	);
	const results = await db.batch(
		pulls.map((raw) => {
			const versioned = raw.summaryObservedAt !== undefined;
			const previous = cached.get(raw.id);
			const pull = versioned
				? mergeCollectedPull(
						raw,
						previous?.pull,
						job.kind === "list" || job.summary_only === 1,
					)
				: job.kind === "list"
					? mergeDiscoveredPull(raw, previous?.pull)
					: raw;
			return db
				.prepare(`INSERT INTO collection_staging(job_id,pull_id,project_id,repository_id,external_id,state,updated_at,snapshot,raw_snapshot,base_version)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${RUNNING_JOB}
      AND (?=1 OR COALESCE((SELECT version FROM pull_requests WHERE id=?),0)=COALESCE((SELECT snapshot_version FROM collection_claim_bindings WHERE job_id=? AND pull_id=?),0))
      AND NOT EXISTS (SELECT 1 FROM collection_claim_bindings b WHERE b.job_id=? AND b.pull_id=? AND b.observation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=b.observation_id AND o.active=1 AND o.generation=b.generation))
      ON CONFLICT(job_id,pull_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,snapshot=excluded.snapshot,raw_snapshot=excluded.raw_snapshot,base_version=excluded.base_version`)
				.bind(
					id,
					pull.id,
					project.id,
					pull.repository.id,
					pull.externalId,
					pull.state,
					pull.updatedAt,
					JSON.stringify(pull),
					versioned ? JSON.stringify(raw) : null,
					versioned ? (previous?.version ?? 0) : null,
					id,
					token,
					timestamp,
					Number(versioned),
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

/** Uploads merge their own bounded chunks; publication only rebases concurrent changes. */
async function reconcileStaging(
	db: D1Database,
	job: JobRow,
	token: string,
	repositoryId: string,
	timestamp: number,
) {
	// At most 200 rows per attempt, 600 over all three CAS attempts. A hot writer
	// cannot trap a request in an unbounded rebase loop or exceed the D1 SQL budget.
	for (let batch = 0; batch < 10; batch++) {
		const rows = (
			await db
				.prepare(`SELECT s.pull_id,s.raw_snapshot,pr.snapshot,COALESCE(pr.version,0) AS version
      FROM collection_staging s LEFT JOIN pull_requests pr ON pr.id=s.pull_id
      WHERE s.job_id=? AND s.repository_id=? AND s.raw_snapshot IS NOT NULL
      AND s.base_version<>COALESCE(pr.version,0) ORDER BY s.pull_id LIMIT 20`)
				.bind(job.id, repositoryId)
				.all<{
					pull_id: string;
					raw_snapshot: string;
					snapshot: string | null;
					version: number;
				}>()
		).results;
		if (!rows.length) return;
		const results = await db.batch(
			rows.map((row) => {
				const merged = mergeCollectedPull(
					pullRequestSchema.parse(JSON.parse(row.raw_snapshot)),
					row.snapshot
						? pullRequestSchema.parse(JSON.parse(row.snapshot))
						: undefined,
					job.kind === "list" || job.summary_only === 1,
				);
				return db
					.prepare(`UPDATE collection_staging SET snapshot=?,state=?,updated_at=?,base_version=?
        WHERE job_id=? AND pull_id=? AND raw_snapshot=? AND ${RUNNING_JOB}
        AND COALESCE((SELECT version FROM pull_requests WHERE id=?),0)=?`)
					.bind(
						JSON.stringify(merged),
						merged.state,
						merged.updatedAt,
						row.version,
						job.id,
						row.pull_id,
						row.raw_snapshot,
						job.id,
						token,
						timestamp,
						row.pull_id,
						row.version,
					);
			}),
		);
		// A concurrent publication is retried by the outer, bounded publication CAS.
		if (results.some((result) => result.meta.changes < 1)) return;
	}
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
	retry = 0,
): Promise<JobRow> {
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
	await reconcileStaging(db, job, token, repositoryId, timestamp);
	const counts = await db
		.prepare(
			"SELECT COUNT(*) AS total,COALESCE(SUM(json_extract(snapshot,'$.coverage')='partial'),0) AS partial,COALESCE(SUM(json_extract(COALESCE(raw_snapshot,snapshot),'$.coverage')='partial'),0) AS raw_partial,COUNT(raw_snapshot) AS versioned FROM collection_staging WHERE job_id=? AND repository_id=?",
		)
		.bind(id, repositoryId)
		.first<{
			total: number;
			partial: number;
			raw_partial: number;
			versioned: number;
		}>();
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
		(job.kind === "list" && state !== "complete") ||
		(job.kind === "details" && pullCount !== 1) ||
		(job.kind === "details" &&
			!job.summary_only &&
			state === "complete" &&
			counts.raw_partial > 0)
	)
		throw new MonitoringError(
			"INCOMPLETE_UPLOAD",
			"Publish complete discovery pages and declare incomplete detail checks",
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
		WHERE s.job_id=? AND s.repository_id=? AND (COALESCE(pr.version,0)<>COALESCE(s.base_version,b.snapshot_version,0)
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
				`UPDATE workbench_repositories SET last_discovered_at=?,discovery_state='complete',discovery_message=NULL,
        discovery_cursor_json=(
          SELECT json_object('number',number,'createdAt',createdAt) FROM (
            SELECT CAST(s.external_id AS INTEGER) number,json_extract(s.snapshot,'$.createdAt') createdAt FROM collection_staging s WHERE s.job_id=? AND s.repository_id=?
            UNION ALL SELECT json_extract(workbench_repositories.discovery_cursor_json,'$.number'),json_extract(workbench_repositories.discovery_cursor_json,'$.createdAt') WHERE workbench_repositories.discovery_cursor_json IS NOT NULL
          ) ORDER BY createdAt DESC,number DESC LIMIT 1
        )
        WHERE project_id=? AND repository_id=? AND ?='list' AND ${receipt}`,
			)
			.bind(
				timestamp,
				id,
				repositoryId,
				project.id,
				repositoryId,
				job.kind,
				...receiptBinds,
			),
		// A saved watch ref is a target, not a new provider observation. Publish
		// refreshed metadata only alongside the validated PR snapshot and receipt.
		db
			.prepare(`UPDATE workbench_repositories SET name=CASE WHEN ?>=name_observed_at THEN ? ELSE name END,
      name_observed_at=MAX(name_observed_at,?),
      aliases_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(workbench_repositories.aliases_json) UNION SELECT workbench_repositories.name UNION SELECT ?))
      WHERE project_id=? AND repository_id=? AND ?='details' AND ${receipt}`)
			.bind(
				staged[0]?.summaryObservedAt ?? staged[0]?.observedAt ?? 0,
				staged[0]?.repository.name ?? "",
				staged[0]?.summaryObservedAt ?? staged[0]?.observedAt ?? 0,
				staged[0]?.repository.name ?? "",
				project.id,
				repositoryId,
				job.kind,
				...receiptBinds,
			),
		db
			.prepare(
				`UPDATE projects SET merge_requirements_json=? WHERE id=? AND ?='details' AND ?=0 AND ${receipt}`,
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
				job.summary_only,
				...receiptBinds,
			),
		// Finish the current refresh before retiring it: the observation trigger cancels only outstanding work.
		db
			.prepare(`UPDATE collection_jobs SET state=?,updated_at=?,completed_at=?,completed_pulls=?,total_pulls=?,message=?,lease_token=NULL,lease_expires_at=NULL
      WHERE id=? AND kind='details' AND ${receipt}`)
			.bind(
				!job.summary_only && counts.partial > 0 ? "partial" : state,
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
	if ((results[0]?.meta.changes ?? 0) < 1) {
		if (counts.versioned > 0 && retry < 2)
			return publishRepository(
				db,
				id,
				token,
				repositoryId,
				pullCount,
				state,
				message,
				timestamp,
				mergeRequirements,
				retry + 1,
			);
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Lease or PR snapshot changed before publication",
			409,
		);
	}
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
	const publication = crypto.randomUUID();
	const receipt =
		"EXISTS (SELECT 1 FROM collection_job_repositories r WHERE r.job_id=? AND r.repository_id=? AND r.publication_token=?)";
	const receiptBinds = [id, repositoryId, publication];
	const results = await db.batch([
		db
			.prepare(
				`UPDATE collection_job_repositories SET state='failed',pull_count=NULL,message=?,publication_token=? WHERE job_id=? AND repository_id=? AND state IN ('queued','running') AND ${RUNNING_JOB}`,
			)
			.bind(message, publication, id, repositoryId, id, token, timestamp),
		db
			.prepare(
				`UPDATE workbench_repositories SET discovery_state='failed',discovery_message=? WHERE project_id=(SELECT project_id FROM collection_jobs WHERE id=? AND kind='list') AND repository_id=? AND ${receipt}`,
			)
			.bind(message, id, repositoryId, ...receiptBinds),
		db
			.prepare(
				`DELETE FROM collection_staging WHERE job_id=? AND repository_id=? AND ${receipt}`,
			)
			.bind(id, repositoryId, ...receiptBinds),
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
