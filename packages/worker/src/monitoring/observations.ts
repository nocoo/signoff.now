import { adoPullId } from "@signoff/domain/collection";
import {
	canonicalObservationKey,
	type DataSource,
	makeWatchRef,
	type Observation,
	parsePullReference,
	parseRepositoryReference,
	type WatchRef,
} from "@signoff/domain/monitoring";
import { type Project, pullRequestSchema } from "@signoff/domain/workbench";
import {
	ACTIVE_JOBS,
	inProjectScope,
	type JobReceipt,
	type JobRow,
	jobReceipt,
	MonitoringError,
	mapObservation,
	mapProject,
	type ObservationRow,
	type ProjectRow,
	REPOSITORY_IDENTITIES,
	type RepositoryRow,
	type RepositoryScopeRow,
	readProject,
	repositoriesInScope,
	resolveRepositoryAlias,
} from "./store.js";

export type PullReference = { pullId: string } | { url: string };
export type RefreshTarget =
	| PullReference
	| { repositoryUrl: string }
	| { all: true };
function supported(project: Project) {
	if (project.source === "cli" && project.provider !== "ado")
		throw new MonitoringError(
			"PROVIDER_UNSUPPORTED",
			"Live GitHub collection is not available yet",
		);
}

export async function resolveRepository(
	db: D1Database,
	source: DataSource,
	url: string,
) {
	const ref = parseRepositoryReference(url);
	const projects = await db
		.prepare("SELECT * FROM projects WHERE source=? AND provider=?")
		.bind(source, ref.provider)
		.all<ProjectRow>();
	// SQLite lower() folds ASCII only; names share the canonical watch key's JS normalization.
	const matchesProject = projects.results.filter(
		(p) =>
			p.organization.toLowerCase() === ref.organization.toLowerCase() &&
			p.project_key.toLowerCase() === ref.projectKey.toLowerCase(),
	);
	if (matchesProject.length > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"Project reference matches multiple registered projects",
			409,
		);
	const projectRow = matchesProject[0];
	if (!projectRow)
		throw new MonitoringError(
			"REPOSITORY_NOT_TRACKED",
			"Register this repository before discovering PRs",
			404,
		);
	const project = mapProject(projectRow);
	const rows = await db
		.prepare("SELECT * FROM workbench_repositories WHERE project_id=?")
		.bind(project.id)
		.all<RepositoryRow>();
	const repository = resolveRepositoryAlias(
		rows.results,
		ref.repository,
		project.provider,
	);
	if (
		!inProjectScope(
			project,
			{
				id: repository?.repository_id ?? ref.repository,
				name: repository?.name ?? ref.repository,
			},
			rows.results.map((row) => row.repository_id),
			JSON.parse(repository?.aliases_json ?? "[]") as string[],
		)
	)
		throw new MonitoringError(
			"REPOSITORY_NOT_TRACKED",
			"Repository is outside the registered project scope",
			404,
		);
	return { project, repository, reference: ref };
}

export async function resolvePull(
	db: D1Database,
	source: DataSource,
	input: PullReference,
): Promise<{
	project: Project;
	ref: WatchRef;
	pullId: string | null;
	state: string | null;
}> {
	if ("pullId" in input) {
		const row = await db
			.prepare(
				"SELECT pr.snapshot,p.*,r.aliases_json,(SELECT json_group_array(repository_id) FROM workbench_repositories WHERE project_id=p.id) repository_ids_json FROM pull_requests pr JOIN projects p ON p.id=pr.project_id LEFT JOIN workbench_repositories r ON r.project_id=p.id AND r.repository_id=pr.repository_id WHERE pr.id=? AND p.source=?",
			)
			.bind(input.pullId, source)
			.first<
				ProjectRow & {
					snapshot: string;
					aliases_json: string | null;
					repository_ids_json: string;
				}
			>();
		if (!row)
			throw new MonitoringError(
				"CACHE_MISS",
				"PR is not in this source's cache",
				404,
			);
		const pull = pullRequestSchema.parse(JSON.parse(row.snapshot));
		// The project revision must belong to the snapshot we resolved, before the guarded activation batch.
		const project = mapProject(row);
		if (project.id !== pull.projectId)
			throw new MonitoringError(
				"REPOSITORY_NOT_TRACKED",
				"Project was removed",
				404,
			);
		if (
			!inProjectScope(
				project,
				pull.repository,
				JSON.parse(row.repository_ids_json) as string[],
				JSON.parse(row.aliases_json ?? "[]") as string[],
			)
		)
			throw new MonitoringError(
				"REPOSITORY_NOT_TRACKED",
				"PR is outside the registered scope",
				404,
			);
		return {
			project,
			ref: makeWatchRef(project, pull.repository, pull.number),
			pullId: pull.id,
			state: pull.state,
		};
	}
	const inputRef = parsePullReference(input.url);
	const { project, repository } = await resolveRepository(
		db,
		source,
		inputRef.repositoryUrl,
	);
	if (!repository)
		throw new MonitoringError(
			"REFERENCE_UNRESOLVED",
			"Discover this repository first to resolve its provider identity",
			409,
		);
	const ref = makeWatchRef(
		project,
		{
			id: repository.repository_id,
			name: repository.name,
			projectExternalId: repository.project_external_id ?? undefined,
		},
		inputRef.number,
	);
	const row = await db
		.prepare(
			"SELECT id,state FROM pull_requests WHERE project_id=? AND lower(repository_id)=? AND external_id=?",
		)
		.bind(project.id, ref.repository.id.toLowerCase(), String(ref.number))
		.first<{ id: string; state: string }>();
	return { project, ref, pullId: row?.id ?? null, state: row?.state ?? null };
}

/** Also works for stopped observations after their project/cache was deleted. */
export async function resolveObservation(
	db: D1Database,
	source: DataSource,
	input: PullReference,
): Promise<Observation> {
	let rows: ObservationRow[];
	if ("pullId" in input) {
		rows = (
			await db
				.prepare("SELECT * FROM pr_observations WHERE source=? AND pull_id=?")
				.bind(source, input.pullId)
				.all<ObservationRow>()
		).results;
	} else {
		const ref = parsePullReference(input.url);
		const results = await db.batch([
			db
				.prepare(`SELECT o.* FROM pr_observations o
      WHERE o.source=? AND json_extract(o.identity,'$[1]')=? AND json_extract(o.identity,'$[2]')=?
      AND json_extract(o.identity,'$[3]')=? AND json_extract(o.identity,'$[5]')=?`)
				.bind(
					source,
					ref.provider,
					ref.organization.toLowerCase(),
					ref.projectKey.toLowerCase(),
					ref.number,
				),
			db.prepare(REPOSITORY_IDENTITIES).bind(source, source),
		]);
		const repository = resolveRepositoryAlias(
			repositoriesInScope(
				(results[1]?.results ?? []) as RepositoryScopeRow[],
				ref,
			),
			ref.repository,
			ref.provider,
		);
		rows = ((results[0]?.results ?? []) as ObservationRow[]).filter(
			(row) =>
				mapObservation(row).ref.repository.id.toLowerCase() ===
				repository?.repository_id.toLowerCase(),
		);
	}
	if (rows.length > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"PR alias matches multiple observations; use its provider repository ID",
			409,
		);
	if (!rows[0])
		throw new MonitoringError(
			"NOT_FOUND",
			"PR has not been added to the watch list",
			404,
		);
	return mapObservation(rows[0]);
}

const insertRefresh = `INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,pull_ids_json,scope_json,observation_id,observation_generation,message)
 SELECT lower(hex(randomblob(16))),p.id,p.revision,p.source,?, 'queued',?,?,?,'details',json_array(COALESCE(o.pull_id,?)),json_array(json_extract(o.ref_json,'$.repository.id')),o.id,o.generation,'Waiting to refresh watched PR'
 FROM pr_observations o JOIN projects p ON p.id=o.project_id AND p.source=o.source
 WHERE o.active=1 AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.state IN (${ACTIVE_JOBS}))`;

export async function addObservation(
	db: D1Database,
	source: DataSource,
	input: PullReference,
	timestamp: number,
): Promise<{
	status: "added" | "already_observed";
	observation: Observation;
	job: JobReceipt | null;
}> {
	const { project, ref, pullId, state } = await resolvePull(db, source, input);
	supported(project);
	if (state && state !== "open")
		throw new MonitoringError(
			"PR_TERMINAL",
			"Merged or closed PRs cannot be watched; their final cache remains queryable",
			409,
		);
	const key = canonicalObservationKey(source, ref);
	const token = crypto.randomUUID();
	const id = crypto.randomUUID();
	const results = await db.batch([
		db
			.prepare(`INSERT INTO pr_observations(id,identity,activation_token,source,project_id,ref_json,pull_id,generation,active,added_at)
      SELECT ?,?,?,?,?,?,?,1,1,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND source=? AND revision=?)
      AND NOT EXISTS (SELECT 1 FROM pull_requests WHERE project_id=? AND lower(repository_id)=? AND external_id=? AND state<>'open')
      ON CONFLICT(identity) DO UPDATE SET activation_token=excluded.activation_token,ref_json=excluded.ref_json,pull_id=excluded.pull_id,
        project_id=excluded.project_id,generation=pr_observations.generation+1,active=1,added_at=excluded.added_at,stopped_at=NULL,stop_reason=NULL
      WHERE pr_observations.active=0`)
			.bind(
				id,
				key,
				token,
				source,
				project.id,
				JSON.stringify(ref),
				pullId,
				timestamp,
				project.id,
				source,
				project.revision,
				project.id,
				ref.repository.id.toLowerCase(),
				String(ref.number),
			),
		db
			.prepare(`${insertRefresh} AND o.identity=? AND o.activation_token=?`)
			.bind(
				JSON.stringify(project),
				timestamp,
				timestamp,
				timestamp,
				adoPullId(project.id, ref.repository.id, String(ref.number)),
				key,
				token,
			),
		db.prepare("SELECT * FROM pr_observations WHERE identity=?").bind(key),
		db
			.prepare(
				`SELECT j.* FROM collection_jobs j JOIN pr_observations o ON o.id=j.observation_id AND o.generation=j.observation_generation WHERE o.identity=? AND j.state IN (${ACTIVE_JOBS})`,
			)
			.bind(key),
	]);
	const row = results[2]?.results[0] as ObservationRow | undefined;
	if (!row?.active)
		throw new MonitoringError(
			"CONFLICT",
			"PR or project changed; read its current state before adding it",
			409,
		);
	const added = row.activation_token === token;
	const job = results[3]?.results[0] as JobRow | undefined;
	return {
		status: added ? "added" : "already_observed",
		observation: mapObservation(row),
		job: job ? jobReceipt(job, !added) : null,
	};
}

export async function removeObservation(
	db: D1Database,
	source: DataSource,
	id: string,
	generation: number,
	timestamp: number,
) {
	const results = await db.batch([
		db
			.prepare(
				"UPDATE pr_observations SET active=0,stopped_at=?,stop_reason='manual' WHERE id=? AND source=? AND generation=? AND active=1",
			)
			.bind(timestamp, id, source, generation),
		db
			.prepare("SELECT * FROM pr_observations WHERE id=? AND source=?")
			.bind(id, source),
	]);
	const row = results[1]?.results[0] as ObservationRow | undefined;
	const status = !row
		? "not_found"
		: row.generation !== generation
			? "conflict"
			: results[0]?.meta.changes
				? "removed"
				: "already_stopped";
	return { status, observation: row ? mapObservation(row) : null };
}

export async function enqueueDiscovery(
	db: D1Database,
	project: Project,
	scope: string[],
	timestamp: number,
): Promise<JobReceipt> {
	supported(project);
	const repositories = (
		await db
			.prepare("SELECT * FROM workbench_repositories WHERE project_id=?")
			.bind(project.id)
			.all<RepositoryRow>()
	).results;
	const normalized = [
		...new Set(
			scope.map(
				(name) =>
					resolveRepositoryAlias(
						repositories,
						name,
						project.provider,
					)?.repository_id.toLowerCase() ?? name.toLowerCase(),
			),
		),
	].sort();
	const scopeKey = JSON.stringify(normalized);
	const id = crypto.randomUUID();
	const results = await db.batch([
		db
			.prepare(`INSERT INTO collection_jobs(id,project_id,revision,source,project_json,state,requested_at,updated_at,not_before,kind,pull_ids_json,scope_json,scope_key,message)
      SELECT ?,?,?,?,?,'queued',?,?,?,'list','[]',?,?,'Waiting to discover all PRs'
      WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND revision=? AND source=?)
      AND NOT EXISTS (SELECT 1 FROM collection_jobs WHERE project_id=? AND revision=? AND kind='list' AND scope_key=? AND state IN (${ACTIVE_JOBS}))`)
			.bind(
				id,
				project.id,
				project.revision,
				project.source,
				JSON.stringify(project),
				timestamp,
				timestamp,
				timestamp,
				scopeKey,
				scopeKey,
				project.id,
				project.revision,
				project.source,
				project.id,
				project.revision,
				scopeKey,
			),
		db
			.prepare(
				`SELECT * FROM collection_jobs WHERE project_id=? AND revision=? AND kind='list' AND scope_key=? AND state IN (${ACTIVE_JOBS})`,
			)
			.bind(project.id, project.revision, scopeKey),
	]);
	const row = results[1]?.results[0] as JobRow | undefined;
	if (!row)
		throw new MonitoringError(
			"CONFLICT",
			"Project changed while queuing discovery",
			409,
		);
	return jobReceipt(row, row.id !== id);
}

export async function refreshObserved(
	db: D1Database,
	source: DataSource,
	target: RefreshTarget,
	timestamp: number,
): Promise<{ jobs: JobReceipt[]; message?: string }> {
	let where = "o.source=? AND o.active=1";
	const args: (number | string)[] = [source];
	if ("url" in target || "pullId" in target) {
		let observation: Observation;
		try {
			observation = await resolveObservation(db, source, target);
		} catch (error) {
			if (error instanceof MonitoringError && error.code === "NOT_FOUND")
				throw new MonitoringError(
					"NOT_OBSERVED",
					"Add this PR to the watch list before refreshing its checks",
					409,
				);
			throw error;
		}
		if (!observation.active)
			throw new MonitoringError(
				"NOT_OBSERVED",
				"This PR is no longer watched",
				409,
			);
		where += " AND o.id=? AND o.generation=?";
		args.push(observation.id, observation.generation);
	} else if ("repositoryUrl" in target) {
		const { project, repository } = await resolveRepository(
			db,
			source,
			target.repositoryUrl,
		);
		if (!repository)
			return { jobs: [], message: "No watched PRs in this repository" };
		where +=
			" AND o.project_id=? AND lower(json_extract(o.ref_json,'$.repository.id'))=?";
		args.push(project.id, repository.repository_id.toLowerCase());
	}
	const rows = (
		await db
			.prepare(`SELECT o.* FROM pr_observations o WHERE ${where}`)
			.bind(...args)
			.all<ObservationRow>()
	).results;
	const jobs: JobReceipt[] = [];
	for (const row of rows) {
		const observation = mapObservation(row);
		const project = await readProject(db, observation.ref.projectId);
		if (!project) continue;
		supported(project);
		const results = await db.batch([
			db
				.prepare(
					`${insertRefresh} AND o.id=? AND o.generation=? AND p.revision=?`,
				)
				.bind(
					JSON.stringify(project),
					timestamp,
					timestamp,
					timestamp,
					adoPullId(
						project.id,
						observation.ref.repository.id,
						String(observation.ref.number),
					),
					observation.id,
					observation.generation,
					project.revision,
				),
			db
				.prepare(
					`SELECT * FROM collection_jobs WHERE observation_id=? AND observation_generation=? AND state IN (${ACTIVE_JOBS})`,
				)
				.bind(observation.id, observation.generation),
		]);
		const job = results[1]?.results[0] as JobRow | undefined;
		if (job) jobs.push(jobReceipt(job, !results[0]?.meta.changes));
	}
	return jobs.length ? { jobs } : { jobs, message: "No active watched PRs" };
}
