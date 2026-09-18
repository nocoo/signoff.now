import {
	type DataSource,
	matchesRepositoryReference,
	type Observation,
	observationSchema,
	type RepositoryReference,
} from "@signoff/domain/monitoring";
import {
	type CollectionJob,
	collectionJobSchema,
	type Project,
	projectSchema,
} from "@signoff/domain/workbench";

export const ACTIVE_JOBS = "'queued','running','auth_required'";
export const LEASE_SECONDS = 120;
export class MonitoringError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status: 400 | 403 | 404 | 409 | 413 | 500 | 503 = 400,
	) {
		super(message);
	}
}

export type ObservationRow = {
	id: string;
	identity: string;
	activation_token: string;
	source: DataSource;
	project_id: string;
	ref_json: string;
	pull_id: string | null;
	generation: number;
	active: number;
	added_at: number;
	stopped_at: number | null;
	stop_reason: Observation["stopReason"];
};
export function mapObservation(row: ObservationRow): Observation {
	return observationSchema.parse({
		id: row.id,
		source: row.source,
		ref: JSON.parse(row.ref_json),
		pullId: row.pull_id,
		generation: row.generation,
		active: row.active === 1,
		addedAt: row.added_at,
		stoppedAt: row.stopped_at,
		stopReason: row.stop_reason,
	});
}
export type RepositoryRow = {
	project_id: string;
	repository_id: string;
	name: string;
	project_external_id: string | null;
	aliases_json: string;
	last_discovered_at: number | null;
	discovery_state: "not_collected" | "legacy" | "complete" | "failed";
	discovery_message: string | null;
};
export const matchesAlias = (
	row: Pick<RepositoryRow, "name" | "repository_id" | "aliases_json">,
	alias: string,
	provider: Project["provider"],
	knownIds: readonly string[],
) =>
	matchesRepositoryReference(
		{
			id: row.repository_id,
			name: row.name,
			aliases: JSON.parse(row.aliases_json) as string[],
		},
		alias,
		provider,
		knownIds,
	);
export function resolveRepositoryAlias<
	T extends Pick<RepositoryRow, "name" | "repository_id" | "aliases_json">,
>(rows: readonly T[], alias: string, provider: Project["provider"]) {
	const id = rows.find(
		(row) => row.repository_id.toLowerCase() === alias.toLowerCase(),
	);
	if (id) return id;
	const matches = rows.filter((row) => matchesAlias(row, alias, provider, []));
	if (new Set(matches.map((row) => row.repository_id.toLowerCase())).size > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"Repository alias matches multiple identities; use its provider ID",
			409,
		);
	return matches[0];
}
export const inProjectScope = (
	project: Pick<Project, "provider" | "repositories">,
	repository: { id: string; name: string },
	knownIds: readonly string[],
	aliases: string[] = [],
) =>
	!project.repositories?.length ||
	project.repositories.some((value) =>
		matchesRepositoryReference(
			{ ...repository, aliases },
			value,
			project.provider,
			knownIds,
		),
	);

// Resolve against all repository identities before filtering by PR number or active state.
// Stopped watches preserve identity context after their project/catalog has been removed.
export const REPOSITORY_IDENTITIES = `SELECT r.repository_id,r.name,r.aliases_json,p.provider,p.organization,p.project_key
 FROM workbench_repositories r JOIN projects p ON p.id=r.project_id WHERE p.source=?
 UNION SELECT json_extract(ref_json,'$.repository.id'),json_extract(ref_json,'$.repository.name'),'[]',
 json_extract(ref_json,'$.provider'),json_extract(ref_json,'$.organization'),json_extract(ref_json,'$.projectKey')
 FROM pr_observations WHERE source=?`;
export type RepositoryScopeRow = Pick<
	RepositoryRow,
	"repository_id" | "name" | "aliases_json"
> & {
	provider: Project["provider"];
	organization: string;
	project_key: string;
};
export const repositoriesInScope = (
	rows: readonly RepositoryScopeRow[],
	scope: Pick<RepositoryReference, "provider" | "organization" | "projectKey">,
) =>
	rows.filter(
		(row) =>
			row.provider === scope.provider &&
			row.organization.toLowerCase() === scope.organization.toLowerCase() &&
			row.project_key.toLowerCase() === scope.projectKey.toLowerCase(),
	);
export type JobRow = {
	id: string;
	project_id: string;
	revision: number;
	source: DataSource;
	project_json: string;
	state: CollectionJob["state"];
	requested_at: number;
	started_at: number | null;
	updated_at: number;
	completed_at: number | null;
	completed_pulls: number;
	total_pulls: number | null;
	message: string;
	lease_token: string | null;
	lease_expires_at: number | null;
	pull_ids_json: string | null;
	kind: "list" | "details" | "full";
	round_id: string | null;
	scope_json: string;
	scope_key: string;
	observation_id: string | null;
	observation_generation: number | null;
	not_before: number;
	attempts: number;
	cancel_reason: string | null;
	error_kind: string | null;
	repositories_resolved: number;
};
export type JobRepositoryRow = {
	job_id: string;
	repository_id: string;
	name: string;
	project_external_id: string | null;
	state: "queued" | "running" | "succeeded" | "failed" | "canceled";
	pull_count: number | null;
	message: string | null;
	publication_token: string | null;
};
export type JobReceipt = {
	id: string;
	kind: "discover" | "refresh";
	state:
		| "queued"
		| "running"
		| "auth_required"
		| "succeeded"
		| "partial"
		| "failed"
		| "canceled";
	coalesced: boolean;
	notBefore: string;
};
export function jobReceipt(row: JobRow, coalesced = false): JobReceipt {
	return {
		id: row.id,
		kind: row.kind === "list" ? "discover" : "refresh",
		state: row.state === "complete" ? "succeeded" : row.state,
		coalesced,
		notBefore: new Date(row.not_before * 1000).toISOString(),
	};
}
export function mapJob(row: JobRow): CollectionJob {
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
export async function readProject(
	db: D1Database,
	id: string,
): Promise<Project | null> {
	const row = await db
		.prepare("SELECT * FROM projects WHERE id=?")
		.bind(id)
		.first<ProjectRow>();
	return row ? mapProject(row) : null;
}
export async function readJob(db: D1Database, id: string): Promise<JobRow> {
	const row = await db
		.prepare("SELECT * FROM collection_jobs WHERE id=?")
		.bind(id)
		.first<JobRow>();
	if (!row)
		throw new MonitoringError("NOT_FOUND", "Collection job not found", 404);
	return row;
}

/** Repeated at every write, including after async pre-reads. */
export const RUNNING_JOB = `EXISTS (SELECT 1 FROM collection_jobs j JOIN projects p ON p.id=j.project_id AND p.revision=j.revision AND p.source=j.source
 WHERE j.id=? AND j.lease_token=? AND j.state='running' AND j.lease_expires_at>?
 AND (j.kind='list' OR EXISTS (SELECT 1 FROM pr_observations o WHERE o.id=j.observation_id AND o.generation=j.observation_generation AND o.active=1)))`;

export type ProjectRow = {
	id: string;
	provider: string;
	name: string;
	organization: string;
	project_key: string;
	repositories_json?: string;
	readiness_rules_json?: string;
	merge_requirements_json?: string;
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
		mergeRequirements: JSON.parse(row.merge_requirements_json || "[]"),
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
