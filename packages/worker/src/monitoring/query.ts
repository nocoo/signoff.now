import {
	canonicalObservationKey,
	type DataSource,
	makeWatchRef,
	type Observation,
	parseRepositoryReference,
	publicSource,
	referenceLinks,
	type WatchRef,
	watchRefSchema,
} from "@signoff/domain/monitoring";
import {
	type JobHistoryFilters,
	observationItemSchema,
	type PullQueryItem,
	projectQuerySchema,
	pullQuerySchema,
	type RepositoryQueryItem,
} from "@signoff/domain/query";
import { checksValidity, evaluatePull } from "@signoff/domain/state-machine";
import {
	type Project,
	type PullRequest,
	projectMergeRequirements,
	projectUrl,
	pullRequestSchema,
	pullUrl,
	repositoryUrl,
} from "@signoff/domain/workbench";
import { z } from "zod";
import { type EvaluationRow, evaluationOutput } from "../ai/scheduler.js";
import { inspectionContext, inspectObservation } from "./inspection.js";
import {
	type JobRepositoryRow,
	type JobRow,
	MonitoringError,
	mapObservation,
	mapProject,
	matchesAlias,
	type ObservationRow,
	type ProjectRow,
	REPOSITORY_IDENTITIES,
	type RepositoryRow,
	type RepositoryScopeRow,
	repositoriesInScope,
	resolveRepositoryAlias,
} from "./store.js";

export function iso(seconds: number): string;
export function iso(seconds: number | null | undefined): string | null;
export function iso(seconds: number | null | undefined): string | null {
	return seconds === null || seconds === undefined
		? null
		: new Date(seconds * 1000).toISOString();
}
export const publicObservation = (o: Observation) => ({
	...o,
	ref: { ...o.ref, url: pullUrl(o.ref, o.ref) },
	source: publicSource(o.source),
	addedAt: iso(o.addedAt),
	stoppedAt: iso(o.stoppedAt),
});
export const publicProject = (p: Project) =>
	projectQuerySchema.parse({
		...p,
		source: publicSource(p.source),
		createdAt: iso(p.createdAt),
		updatedAt: iso(p.updatedAt),
		lastScannedAt: iso(p.lastScannedAt),
		key: p.projectKey,
		url: projectUrl(p),
	});

const querySchema = z.object({
	source: z.enum(["live", "sample"]).default("live"),
	provider: z.enum(["ado", "github"]).optional(),
	org: z.string().max(240).default(""),
	project: z.string().max(240).default(""),
	projectId: z.string().max(240).default(""),
	repositoryId: z.string().max(240).default(""),
	repo: z.array(z.string().max(4096)).default([]),
	author: z.array(z.string().max(1024)).default([]),
	state: z.enum(["open", "merged", "closed", "all"]).default("open"),
	draft: z.enum(["exclude", "include", "only"]).default("exclude"),
	watching: z.enum(["true", "false"]).optional(),
	pending: z.enum(["true", "false"]).optional(),
	includeStopped: z.enum(["true", "false"]).default("false"),
	q: z.string().max(1000).default(""),
	status: z
		.enum([
			"all",
			"skipped",
			"conflict",
			"attention",
			"warning",
			"running",
			"ready",
			"waiting",
			"unknown",
			"error",
		])
		.default("all"),
	sort: z
		.enum([
			"identity",
			"repository",
			"author",
			"target",
			"stateChecked",
			"checksChecked",
			"evaluated",
			"readiness",
			"title",
			"progress",
			"action",
			"updated",
			"oldest",
		])
		.default("identity"),
	direction: z.enum(["asc", "desc"]).default("asc"),
	limit: z.coerce.number().int().min(1).max(200).default(100),
	page: z.coerce.number().int().min(1).max(1000000).default(1),
	cursor: z.string().max(32768).optional(),
});
export type QueryFilters = z.infer<typeof querySchema>;
type QueryDatabase = Pick<D1Database, "prepare" | "batch">;
export function parseQuery(params: URLSearchParams): QueryFilters {
	const values = Object.fromEntries(params);
	const parsed = querySchema.parse({
		...values,
		repo: [...new Set(params.getAll("repo"))].sort(),
		author: [...new Set(params.getAll("author"))].sort(),
	});
	for (const repo of parsed.repo) parseRepositoryReference(repo);
	return {
		...parsed,
		org: parsed.org.toLowerCase(),
		q: parsed.q.trim().toLowerCase(),
	};
}

type SnapshotRow = {
	id: string;
	project_id: string;
	repository_id: string;
	external_id: string;
	snapshot: string;
	published_at: number | null;
	version: number;
};
type RepositoryCounts = {
	project_id: string;
	repository_id: string;
	open: number;
	draft: number;
	merged: number;
	closed: number;
};
type ScopeSnapshot = {
	projects: Project[];
	repositories: RepositoryRow[];
	identities: RepositoryScopeRow[];
	revision: string;
};
async function readScope(
	db: QueryDatabase,
	source: DataSource,
): Promise<ScopeSnapshot> {
	const results = await db.batch([
		db
			.prepare("SELECT * FROM projects WHERE source=? ORDER BY id")
			.bind(source),
		db
			.prepare(
				"SELECT r.* FROM workbench_repositories r JOIN projects p ON p.id=r.project_id WHERE p.source=? ORDER BY r.project_id,r.repository_id",
			)
			.bind(source),
		db
			.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
			.bind(source),
		db.prepare(REPOSITORY_IDENTITIES).bind(source, source),
	]);
	return {
		projects: ((results[0]?.results ?? []) as ProjectRow[]).map(mapProject),
		repositories: (results[1]?.results ?? []) as RepositoryRow[],
		identities: (results[3]?.results ?? []) as RepositoryScopeRow[],
		revision: String((results[2]?.results[0] as { revision: number }).revision),
	};
}
function pullScopeSql(
	source: DataSource,
	filters?: QueryFilters,
	scope?: ScopeSnapshot,
) {
	const where = ["p.source=?"];
	const values: (string | number)[] = [source];
	if (filters) {
		for (const [sql, value] of [
			["p.provider=?", filters.provider],
			["p.id=?", filters.projectId],
		] as const)
			if (value) {
				where.push(sql);
				values.push(value);
			}
		if (scope) {
			const projects = new Map(scope.projects.map((p) => [p.id, p]));
			const matches = scopeMatcher(filters, scope.identities);
			const pairs = scope.repositories
				.filter((r) => {
					const project = projects.get(r.project_id);
					return (
						project &&
						matches(project, {
							id: r.repository_id,
							name: r.name,
						})
					);
				})
				.map((r) => [r.project_id, r.repository_id]);
			where.push(
				"json_array(pr.project_id,pr.repository_id) IN (SELECT value FROM json_each(?))",
			);
			values.push(JSON.stringify(pairs));
		}
	}
	return { where, values };
}

/** All statements here are SELECTs in one consistency batch. Queries never change collection state. */
async function readSnapshot(
	db: Pick<D1Database, "prepare" | "batch">,
	source: DataSource,
	options: {
		detailId?: string;
		catalog?: boolean;
		openOnly?: boolean;
		filters?: QueryFilters;
	} = {},
) {
	const { detailId, filters } = options;
	const scope =
		filters &&
		(filters.org ||
			filters.project ||
			filters.repositoryId ||
			filters.repo.length)
			? await readScope(db, source)
			: undefined;
	const { where, values } = pullScopeSql(source, filters, scope);
	const searchScope = pullScopeSql(source, filters, scope);
	const searching = options.openOnly && Boolean(filters?.q);
	if (detailId) {
		where.push("pr.id=?");
		values.push(detailId);
	}
	if (options.catalog)
		where.push("pr.state='open' AND json_extract(pr.snapshot,'$.draft')=0");
	else if (options.openOnly) where.push("pr.state='open'");

	const results = await db.batch([
		db
			.prepare("SELECT * FROM projects WHERE source=? ORDER BY id")
			.bind(source),
		db
			.prepare(`SELECT pr.id,pr.project_id,pr.repository_id,pr.external_id,pr.version,pr.published_at,
      CASE WHEN ? IS NULL THEN json_set(pr.snapshot,'$.description','','$.activity',json('[]')) ELSE pr.snapshot END AS snapshot
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE ${where.join(" AND ")} ORDER BY pr.id`)
			.bind(detailId ?? null, ...values),
		db
			.prepare(
				"SELECT o.* FROM pr_observations o WHERE source=? ORDER BY identity",
			)
			.bind(source),
		db
			.prepare(
				"SELECT r.* FROM workbench_repositories r JOIN projects p ON p.id=r.project_id WHERE p.source=? ORDER BY r.project_id,r.repository_id",
			)
			.bind(source),
		db
			.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
			.bind(source),
		db.prepare(REPOSITORY_IDENTITIES).bind(source, source),
		...(options.catalog
			? [
					db
						.prepare(`SELECT pr.project_id,pr.repository_id,
      SUM(pr.state='open' AND json_extract(pr.snapshot,'$.draft')=0) AS open,
      SUM(pr.state='open' AND json_extract(pr.snapshot,'$.draft')=1) AS draft,
      SUM(pr.state='merged') AS merged,SUM(pr.state='closed') AS closed
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE p.source=? GROUP BY pr.project_id,pr.repository_id`)
						.bind(source),
				]
			: []),
		...(searching
			? [
					db
						.prepare(`SELECT pr.id,
      json_extract(pr.snapshot,'$.title')||' #'||pr.external_id||' '||json_extract(pr.snapshot,'$.author.name')||' '||
      json_extract(pr.snapshot,'$.repository.name')||' '||p.name||' '||p.organization||' '||p.project_key||' '||
      CASE pr.state WHEN 'merged' THEN p.owner||' Merged into '||json_extract(pr.snapshot,'$.targetBranch')
      WHEN 'closed' THEN json_extract(pr.snapshot,'$.author.name')||' Closed without merging' ELSE '' END AS text
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE ${searchScope.where.join(" AND ")}`)
						.bind(...searchScope.values),
				]
			: []),
		db
			.prepare(
				"SELECT e.* FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id AND o.generation=e.generation WHERE o.source=?",
			)
			.bind(source),
	]);
	const revision = String(
		(results[4]?.results[0] as { revision: number }).revision,
	);
	if (scope && scope.revision !== revision)
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Repository scope changed during the query; retry the query",
			409,
		);
	const pulls = ((results[1]?.results ?? []) as SnapshotRow[]).map(
		(stored) => ({
			stored,
			pull: pullRequestSchema.parse(JSON.parse(stored.snapshot)),
		}),
	);
	const projects = ((results[0]?.results ?? []) as ProjectRow[])
		.map(mapProject)
		.map((p) => ({
			...p,
			mergeRequirements: projectMergeRequirements(
				p,
				pulls.map((row) => row.pull),
			),
		}));
	return {
		evaluations: (results[results.length - 1]?.results ??
			[]) as EvaluationRow[],
		projects,
		pulls,
		observations: ((results[2]?.results ?? []) as ObservationRow[]).map(
			mapObservation,
		),
		repositories: (results[3]?.results ?? []) as RepositoryRow[],
		identities: (results[5]?.results ?? []) as RepositoryScopeRow[],
		revision,
		counts: (options.catalog
			? (results[6]?.results ?? [])
			: []) as RepositoryCounts[],
		searchRows: (searching
			? (results[options.catalog ? 7 : 6]?.results ?? [])
			: []) as { id: string; text: string }[],
	};
}
type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
const authorKey = (p: Project, pr: PullRequest) =>
	JSON.stringify([p.provider, p.organization.toLowerCase(), pr.author.id]);
function observationFor(data: Snapshot, project: Project, ref: WatchRef) {
	const identity = canonicalObservationKey(project.source, ref);
	return (
		data.observations.find(
			(o) =>
				o.ref.projectId === project.id &&
				canonicalObservationKey(o.source, o.ref) === identity,
		) ?? null
	);
}

function pullOutput(
	data: Snapshot,
	row: Snapshot["pulls"][number],
	timestamp: number,
): PullQueryItem {
	const pr = row.pull;
	const project = data.projects.find((p) => p.id === pr.projectId);
	if (!project) throw new Error("Cached PR has no project");
	const ref = makeWatchRef(project, pr.repository, pr.number);
	const links = referenceLinks(ref);
	const evaluated = evaluatePull(pr, project);
	const observation = observationFor(data, project, ref);
	const readiness = evaluationOutput(
		data.evaluations.find(
			(e) =>
				e.observation_id === observation?.id &&
				e.generation === observation.generation,
		),
		Boolean(observation?.active),
		pr,
	);
	const checks =
		pr.checksObservedAt === undefined ? pr.observedAt : pr.checksObservedAt;
	const summary = pr.summaryObservedAt ?? pr.observedAt;
	return pullQuerySchema.parse({
		...evaluated.pull,
		provider: project.provider,
		...links,
		project: publicProject(project),
		url: ref.url,
		state: pr.state === "open" && pr.draft ? "draft" : pr.state,
		createdAt: iso(pr.createdAt),
		updatedAt: iso(pr.updatedAt),
		mergedAt: iso(pr.mergedAt),
		publishedAt: iso(row.stored.published_at ?? pr.observedAt),
		author: { ...pr.author, key: authorKey(project, pr) },
		activity: pr.activity.map((a) => ({ ...a, at: iso(a.at) })),
		observation: observation ? publicObservation(observation) : null,
		freshness: {
			listObservedAt: iso(summary),
			checksObservedAt: iso(checks),
			checksValidity: checksValidity(pr),
			ageSeconds: {
				list: Math.max(0, Math.floor(timestamp - summary)),
				checks: checks === null ? null : Math.max(0, timestamp - checks),
			},
			clockSkew:
				Math.floor(summary) > timestamp ||
				(checks !== null && checks > timestamp),
		},
		readiness,
		checks: evaluated.progress,
		requirements: evaluated.requirements,
		content: { state: pr.coverage, missing: pr.collectionIssues ?? [] },
	});
}
function coverage(data: Snapshot) {
	const missing: string[] = [];
	for (const project of data.projects) {
		const repos = data.repositories.filter((r) => r.project_id === project.id);
		const ids = repos.map((repo) => repo.repository_id);
		if (
			!repos.length ||
			project.repositories?.some(
				(name) =>
					!repos.some((r) => matchesAlias(r, name, project.provider, ids)),
			)
		)
			missing.push(
				`${project.organization}/${project.projectKey}: repositories not yet discovered`,
			);
		for (const repo of repos)
			if (repo.discovery_state !== "complete")
				missing.push(
					`${project.organization}/${project.projectKey}/${repo.name}: ${repo.discovery_message ?? (repo.discovery_state === "legacy" ? "legacy limited history" : "not fully discovered")}`,
				);
	}
	return {
		state: !data.repositories.length
			? ("not_collected" as const)
			: missing.length
				? ("partial" as const)
				: ("complete" as const),
		missing,
	};
}
function envelope(data: Snapshot, source: DataSource, timestamp: number) {
	return {
		schemaVersion: 1 as const,
		source: publicSource(source),
		dataRevision: data.revision,
		generatedAt: iso(timestamp),
		coverage: coverage(data),
	};
}
function pagePosition(filters: QueryFilters, revision: string, kind: string) {
	const { cursor, ...query } = filters;
	const signature = JSON.stringify([kind, query]);
	let offset = (filters.page - 1) * filters.limit;
	if (cursor) {
		let decoded: { signature: string; revision: string; offset: number };
		try {
			decoded = z
				.object({
					signature: z.string(),
					revision: z.string(),
					offset: z.number().int().nonnegative(),
				})
				.parse(JSON.parse(decodeURIComponent(atob(cursor))));
		} catch {
			throw new MonitoringError("INVALID_CURSOR", "Cursor is invalid");
		}
		if (decoded.signature !== signature)
			throw new MonitoringError(
				"INVALID_CURSOR",
				"Cursor belongs to another query",
			);
		if (decoded.revision !== revision)
			throw new MonitoringError(
				"SNAPSHOT_CHANGED",
				"Data changed during pagination; restart at the first page",
				409,
			);
		offset = decoded.offset;
	}
	return { offset, signature };
}

function pageMetadata(
	total: number,
	filters: QueryFilters,
	revision: string,
	position: { offset: number; signature: string },
) {
	const next = position.offset + filters.limit;
	return {
		limit: filters.limit,
		total,
		nextCursor:
			next < total
				? btoa(
						encodeURIComponent(
							JSON.stringify({
								signature: position.signature,
								revision,
								offset: next,
							}),
						),
					)
				: null,
	};
}
function page<T>(
	items: T[],
	filters: QueryFilters,
	revision: string,
	kind: string,
) {
	const position = pagePosition(filters, revision, kind);
	return {
		data: items.slice(position.offset, position.offset + filters.limit),
		page: pageMetadata(items.length, filters, revision, position),
	};
}

function scopeMatcher(
	f: QueryFilters,
	identities: readonly RepositoryScopeRow[],
) {
	const references = f.repo.map((url) => {
		const ref = parseRepositoryReference(url);
		return {
			...ref,
			id: resolveRepositoryAlias(
				repositoriesInScope(identities, ref),
				ref.repository,
				ref.provider,
			)?.repository_id.toLowerCase(),
		};
	});
	return (
		project: Pick<Project, "id" | "provider" | "organization" | "projectKey">,
		repo: { id: string | null; name: string },
	) =>
		(!f.provider || f.provider === project.provider) &&
		(!f.org || f.org === project.organization.toLowerCase()) &&
		(!f.project ||
			[project.projectKey.toLowerCase(), project.id.toLowerCase()].includes(
				f.project.toLowerCase(),
			)) &&
		(!f.projectId || f.projectId === project.id) &&
		(!f.repositoryId ||
			repo.id?.toLowerCase() === f.repositoryId.toLowerCase()) &&
		(!f.repo.length ||
			references.some((r) => {
				if (
					r.provider === project.provider &&
					r.organization.toLowerCase() === project.organization.toLowerCase() &&
					r.projectKey.toLowerCase() === project.projectKey.toLowerCase()
				) {
					return r.id !== undefined
						? r.id === repo.id?.toLowerCase()
						: repo.id === null &&
								repo.name.toLowerCase() === r.repository.toLowerCase();
				}
				return false;
			}));
}

/** Readiness needs open PR facts; terminal history stays in SQLite until its page is selected. */
async function readPullPage(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	const snapshot = await readSnapshot(db, source, { filters, openOnly: true });
	const projects = new Map(snapshot.projects.map((p) => [p.id, p]));
	// ponytail: open-set readiness is evaluated per query; materialize facts if large open sets exceed the CPU budget.
	const facts = snapshot.pulls.map(({ pull }) => {
		const project = projects.get(pull.projectId);
		if (!project) throw new Error("Cached PR has no project");
		const { progress } = evaluatePull(pull, project);
		const observation = observationFor(
			snapshot,
			project,
			makeWatchRef(project, pull.repository, pull.number),
		);
		const readiness = evaluationOutput(
			snapshot.evaluations.find(
				(e) =>
					e.observation_id === observation?.id &&
					e.generation === observation.generation,
			),
			Boolean(observation?.active),
			pull,
		);
		return {
			id: pull.id,
			kind:
				readiness.status === "not_watched" ? "not_evaluated" : readiness.kind,
			rank:
				readiness.status === "not_watched"
					? 9
					: {
							skipped: 8,
							conflict: 0,
							error: 1,
							attention: 2,
							warning: 3,
							unknown: 4,
							running: 5,
							waiting: 6,
							ready: 7,
						}[readiness.kind],
			action: readiness.nextAction,
			evaluated: (readiness.current ?? readiness.previous)?.evaluatedAt ?? "",
			owner: "",
			completion:
				pull.coverage === "partial" ||
				pull.checksObservedAt === null ||
				pull.checksInvalidated
					? -1
					: progress.checksTotal
						? progress.checksPassed / progress.checksTotal
						: 1,
		};
	});
	const position = pagePosition(filters, snapshot.revision, "prs");
	// SQLite lower() folds ASCII only. Transfer compact search text, never historical snapshots.
	const openActions = new Map(
		facts.map((fact) => [fact.id, `${fact.owner} ${fact.action}`]),
	);
	const searchIds = snapshot.searchRows
		.filter((row) =>
			`${row.text} ${openActions.get(row.id) ?? ""}`
				.toLowerCase()
				.includes(filters.q),
		)
		.map((row) => row.id);
	const { where, values } = pullScopeSql(source, filters, snapshot);
	if (filters.watching !== undefined)
		where.push(`${filters.watching === "false" ? "NOT " : ""}EXISTS (
      SELECT 1 FROM pr_observations o WHERE o.project_id=pr.project_id AND o.source=p.source AND o.active=1
      AND lower(json_extract(o.ref_json,'$.repository.id'))=lower(pr.repository_id)
      AND json_extract(o.ref_json,'$.number')=CAST(pr.external_id AS INTEGER))`);
	// Only progress sorting requires historical check arrays, and SQLite reduces them to a scalar.
	const historyCompletion =
		filters.sort === "progress"
			? `CASE WHEN json_extract(pr.snapshot,'$.coverage')='partial'
      OR json_type(pr.snapshot,'$.checksObservedAt')='null' OR json_extract(pr.snapshot,'$.checksInvalidated')=1 THEN -1
      ELSE COALESCE((SELECT AVG(CASE WHEN json_extract(value,'$.state')='passed' THEN 1.0 ELSE 0.0 END)
        FROM (SELECT value FROM json_each(pr.snapshot,'$.policies') UNION ALL SELECT value FROM json_each(pr.snapshot,'$.builds'))
        WHERE json_extract(value,'$.required')=1),1) END`
			: "0";
	const cte = `WITH open_facts AS MATERIALIZED (
      SELECT json_extract(value,'$.id') id,json_extract(value,'$.kind') kind,json_extract(value,'$.rank') rank,
        json_extract(value,'$.evaluated') evaluated,json_extract(value,'$.action') action,json_extract(value,'$.owner') owner,json_extract(value,'$.completion') completion FROM json_each(?)
    ), scoped AS (
      SELECT pr.*,p.provider,p.organization,p.project_key,p.name project_name,
        json_extract(pr.snapshot,'$.draft') draft,json_extract(pr.snapshot,'$.author.name') author_name,
        json_array(p.provider,lower(p.organization),json_extract(pr.snapshot,'$.author.id')) author_key,
        COALESCE(f.kind,'not_evaluated') readiness_kind,COALESCE(f.evaluated,'') evaluated,
        COALESCE(f.rank,CASE pr.state WHEN 'merged' THEN 4 ELSE 5 END) readiness_rank,
        COALESCE(f.action,CASE pr.state WHEN 'merged' THEN 'Merged into '||json_extract(pr.snapshot,'$.targetBranch') ELSE 'Closed without merging' END) next_action,
        COALESCE(f.owner,CASE pr.state WHEN 'merged' THEN p.owner ELSE json_extract(pr.snapshot,'$.author.name') END) next_owner,
        COALESCE(f.completion,${historyCompletion}) completion
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id LEFT JOIN open_facts f ON f.id=pr.id
      WHERE ${where.join(" AND ")} AND (SELECT revision FROM workbench_revisions WHERE source=?)=?
    ), searched AS (
      SELECT * FROM scoped WHERE ?='' OR id IN (SELECT value FROM json_each(?))
    ), filtered AS (
      SELECT * FROM searched WHERE (?='include' OR draft=?) AND (json_array_length(?)=0 OR author_key IN (SELECT value FROM json_each(?)))
    ), matched AS (
      SELECT * FROM filtered WHERE (?='all' OR state=?) AND (?='all' OR readiness_kind=?)
    )`;
	const binds = [
		JSON.stringify(facts),
		...values,
		source,
		Number(snapshot.revision),
		filters.q,
		JSON.stringify(searchIds),
		filters.draft,
		Number(filters.draft === "only"),
		JSON.stringify(filters.author),
		JSON.stringify(filters.author),
		filters.state,
		filters.state,
		filters.status,
		filters.status,
	];
	const sort = {
		identity: "id",
		evaluated: "evaluated",
		repository: "json_extract(snapshot,'$.repository.name') COLLATE NOCASE",
		author: "author_name COLLATE NOCASE",
		target: "json_extract(snapshot,'$.targetBranch') COLLATE NOCASE",
		stateChecked:
			"COALESCE(json_extract(snapshot,'$.summaryObservedAt'),json_extract(snapshot,'$.observedAt'))",
		checksChecked:
			"CASE WHEN json_type(snapshot,'$.checksObservedAt')='null' THEN -1 ELSE COALESCE(json_extract(snapshot,'$.checksObservedAt'),json_extract(snapshot,'$.observedAt')) END",
		readiness: "readiness_rank",
		title: "json_extract(snapshot,'$.title') COLLATE NOCASE",
		progress: "completion",
		action: "next_action COLLATE NOCASE",
		updated: "updated_at",
		oldest: "json_extract(snapshot,'$.createdAt')",
	}[filters.sort];
	const results = await db.batch([
		db
			.prepare(`${cte} SELECT id,project_id,repository_id,external_id,version,published_at,
      json_set(snapshot,'$.description','','$.activity',json('[]')) snapshot FROM matched ORDER BY ${sort} ${filters.direction},id ASC LIMIT ? OFFSET ?`)
			.bind(...binds, filters.limit, position.offset),
		db.prepare(`${cte} SELECT COUNT(*) total FROM matched`).bind(...binds),
		db
			.prepare(`${cte} SELECT COALESCE(SUM(state='open'),0) open,
      COALESCE(SUM(readiness_kind='attention'),0) attention,COALESCE(SUM(readiness_kind='skipped'),0) skipped,
 COALESCE(SUM(readiness_kind='running'),0) running,COALESCE(SUM(readiness_kind='conflict'),0) conflict,COALESCE(SUM(readiness_kind='warning'),0) warning,COALESCE(SUM(readiness_kind='ready'),0) ready,COALESCE(SUM(readiness_kind='waiting'),0) waiting,COALESCE(SUM(readiness_kind='unknown'),0) unknown,COALESCE(SUM(readiness_kind='error'),0) error,
      COALESCE(SUM(state='open' AND draft=1),0) draft,COALESCE(SUM(state='merged'),0) merged,COALESCE(SUM(state='closed'),0) closed FROM filtered`)
			.bind(...binds),
		db
			.prepare(
				`${cte} SELECT author_key id,MAX(author_name) name,provider FROM searched GROUP BY author_key,provider ORDER BY name COLLATE NOCASE,id`,
			)
			.bind(...binds),
		db
			.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
			.bind(source),
	]);
	if (
		String((results[4]?.results[0] as { revision: number }).revision) !==
		snapshot.revision
	)
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Data changed while preparing the page; retry the query",
			409,
		);
	const rows = ((results[0]?.results ?? []) as SnapshotRow[]).map((stored) => ({
		stored,
		pull: pullRequestSchema.parse(JSON.parse(stored.snapshot)),
	}));
	const total = (results[1]?.results[0] as { total: number }).total;
	return {
		...envelope(snapshot, source, timestamp),
		data: rows.map((row) => pullOutput(snapshot, row, timestamp)),
		page: pageMetadata(total, filters, snapshot.revision, position),
		metrics: results[2]?.results[0] as {
			open: number;
			attention: number;
			running: number;
			ready: number;
			draft: number;
			merged: number;
			closed: number;
		},
		authors: (results[3]?.results ?? []) as {
			id: string;
			name: string;
			provider: Project["provider"];
		}[],
	};
}

async function retrySnapshot<T>(
	filters: Pick<QueryFilters, "cursor">,
	read: () => Promise<T>,
) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await read();
		} catch (error) {
			if (
				filters.cursor ||
				attempt === 2 ||
				!(error instanceof MonitoringError) ||
				error.code !== "SNAPSHOT_CHANGED"
			)
				throw error;
		}
	}
}

export async function queryPulls(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	return retrySnapshot(filters, () =>
		readPullPage(db, source, filters, timestamp),
	);
}

export async function queryPull(
	db: QueryDatabase,
	source: DataSource,
	id: string,
	timestamp: number,
) {
	const snapshot = await readSnapshot(db, source, { detailId: id });
	const row = snapshot.pulls[0];
	if (!row)
		throw new MonitoringError("CACHE_MISS", "PR is not in the cache", 404);
	return {
		...envelope(snapshot, source, timestamp),
		data: pullOutput(snapshot, row, timestamp),
	};
}
export async function lookupPull(
	db: QueryDatabase,
	source: DataSource,
	url: string,
	number: number,
	timestamp: number,
) {
	return retrySnapshot({}, () =>
		readPullLookup(db, source, url, number, timestamp),
	);
}
async function readPullLookup(
	db: QueryDatabase,
	source: DataSource,
	url: string,
	number: number,
	timestamp: number,
) {
	const ref = parseRepositoryReference(url);
	const results = await db.batch([
		db
			.prepare(`SELECT pr.id,p.organization,p.project_key,pr.repository_id,
    (SELECT revision FROM workbench_revisions WHERE source=p.source) data_revision
    FROM pull_requests pr JOIN projects p ON p.id=pr.project_id
    WHERE p.source=? AND p.provider=? AND pr.external_id=?`)
			.bind(source, ref.provider, String(number)),
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
	const rows = (results[0]?.results ?? []) as {
		id: string;
		organization: string;
		project_key: string;
		repository_id: string;
		data_revision: number;
	}[];
	const matches = rows.filter(
		(r) =>
			r.organization.toLowerCase() === ref.organization.toLowerCase() &&
			r.project_key.toLowerCase() === ref.projectKey.toLowerCase() &&
			r.repository_id.toLowerCase() === repository?.repository_id.toLowerCase(),
	);
	if (matches.length > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"Repository alias is ambiguous",
			409,
		);
	if (!matches[0])
		throw new MonitoringError("CACHE_MISS", "PR is not in the cache", 404);
	const result = await queryPull(db, source, matches[0].id, timestamp);
	if (result.dataRevision !== String(matches[0].data_revision))
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"PR reference changed during lookup; retry the query",
			409,
		);
	return result;
}

export async function queryRepos(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	return retrySnapshot(filters, () =>
		readRepositoryPage(db, source, filters, timestamp),
	);
}
async function readRepositoryPage(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	const snapshot = await readSnapshot(db, source, { catalog: true, filters });
	const output: RepositoryQueryItem[] = [];
	const matches = scopeMatcher(filters, snapshot.identities);
	for (const project of snapshot.projects) {
		const known = snapshot.repositories.filter(
			(r) => r.project_id === project.id,
		);
		const items: [string | null, string, RepositoryRow | undefined][] =
			known.map((r) => [r.repository_id, r.name, r]);
		const ids = known.map((repo) => repo.repository_id);
		for (const name of project.repositories ?? [])
			if (!known.some((r) => matchesAlias(r, name, project.provider, ids)))
				items.push([null, name, undefined]);
		for (const [id, name, stored] of items) {
			if (!matches(project, { id, name })) continue;
			const ref = makeWatchRef(project, { id: id ?? name, name }, 1);
			const prs = snapshot.pulls
				.filter(
					(r) => r.pull.projectId === project.id && r.pull.repository.id === id,
				)
				.map((r) => r.pull);
			const counts = snapshot.counts.find(
				(r) => r.project_id === project.id && r.repository_id === id,
			);
			output.push({
				key: JSON.stringify([project.id, id ?? name]),
				provider: project.provider,
				organization: referenceLinks(ref).organization,
				project: publicProject(project),
				repository: {
					id,
					name,
					url: repositoryUrl(project, { id, name }),
					projectExternalId: stored?.project_external_id ?? null,
				},
				identityResolved: id !== null,
				lastDiscoveredAt: iso(stored?.last_discovered_at),
				coverage: {
					state:
						stored?.discovery_state === "complete"
							? "complete"
							: stored?.discovery_state === "legacy" ||
									stored?.discovery_state === "failed"
								? "partial"
								: "not_collected",
					missing:
						stored?.discovery_state === "complete"
							? []
							: [
									stored?.discovery_message ??
										"Repository history has not been fully discovered",
								],
				},
				counts: {
					open: counts?.open ?? 0,
					draft: counts?.draft ?? 0,
					merged: counts?.merged ?? 0,
					closed: counts?.closed ?? 0,
					watching: snapshot.observations.filter(
						(o) =>
							o.active &&
							o.ref.projectId === project.id &&
							o.ref.repository.id === id,
					).length,
					...(Object.fromEntries(
						[
							"skipped",
							"conflict",
							"attention",
							"warning",
							"running",
							"ready",
							"waiting",
							"unknown",
							"error",
						].map((kind) => [
							kind,
							prs.filter((p) => {
								const o = observationFor(
									snapshot,
									project,
									makeWatchRef(project, p.repository, p.number),
								);
								return (
									(o?.active || kind === "skipped") &&
									evaluationOutput(
										snapshot.evaluations.find(
											(e) =>
												e.observation_id === o?.id &&
												e.generation === o.generation,
										),
										Boolean(o?.active),
										p,
									).kind === kind
								);
							}).length,
						]),
					) as Record<
						| "skipped"
						| "conflict"
						| "attention"
						| "warning"
						| "running"
						| "ready"
						| "waiting"
						| "unknown"
						| "error",
						number
					>),
				},
			});
		}
	}
	return {
		...envelope(snapshot, source, timestamp),
		...page(
			output.sort((a, b) => a.key.localeCompare(b.key)),
			filters,
			snapshot.revision,
			"repos",
		),
		projects: snapshot.projects.map(publicProject),
	};
}
type ObservationLookup =
	| { pullId: string }
	| { repositoryUrl: string; number: number };
export async function queryObservations(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
	lookup?: ObservationLookup,
) {
	return retrySnapshot(
		lookup ? { ...filters, cursor: undefined } : filters,
		() => readObservationPage(db, source, filters, timestamp, lookup),
	);
}

async function readObservationPage(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
	lookup?: ObservationLookup,
) {
	const scope = await readScope(db, source);
	const matches = scopeMatcher(filters, scope.identities);
	const where = ["o.source=?"];
	const values: (string | number)[] = [source];
	const ref =
		lookup && "repositoryUrl" in lookup
			? parseRepositoryReference(lookup.repositoryUrl)
			: null;
	const resolvedRepository = ref
		? resolveRepositoryAlias(
				repositoriesInScope(scope.identities, ref),
				ref.repository,
				ref.provider,
			)
		: null;
	if (lookup) {
		if ("pullId" in lookup) {
			where.push("o.pull_id=?");
			values.push(lookup.pullId);
		} else if (ref) {
			where.push(
				"json_extract(o.identity,'$[1]')=? AND json_extract(o.identity,'$[2]')=? AND json_extract(o.identity,'$[3]')=? AND json_extract(o.identity,'$[5]')=?",
			);
			values.push(
				ref.provider,
				ref.organization.toLowerCase(),
				ref.projectKey.toLowerCase(),
				lookup.number,
			);
		}
	} else {
		if (filters.includeStopped !== "true") where.push("o.active=1");
		if (filters.pending === "true") where.push("o.pull_id IS NULL");
	}
	if (
		ref ||
		(!lookup &&
			(filters.provider ||
				filters.org ||
				filters.project ||
				filters.projectId ||
				filters.repositoryId ||
				filters.repo.length))
	) {
		// Resolve only distinct repository identities, including stopped watches whose projects were removed.
		const identities = await db
			.prepare(`SELECT DISTINCT json_array(o.project_id,json_remove(o.identity,'$[5]')) scope_key,
      json_remove(o.ref_json,'$.number','$.url') ref_json FROM pr_observations o WHERE ${where.join(" AND ")}`)
			.bind(...values)
			.all<{ scope_key: string; ref_json: string }>();
		const matching = identities.results
			.filter((row) => {
				const identity = JSON.parse(row.ref_json) as Omit<
					Observation["ref"],
					"number" | "url"
				>;
				return ref
					? identity.repository.id.toLowerCase() ===
							resolvedRepository?.repository_id.toLowerCase()
					: matches(
							{ ...identity, id: identity.projectId },
							identity.repository,
						);
			})
			.map((row) => row.scope_key);
		where.push(
			"json_array(o.project_id,json_remove(o.identity,'$[5]')) IN (SELECT value FROM json_each(?))",
		);
		values.push(JSON.stringify([...new Set(matching)]));
	}
	const selectedFilters = lookup
		? { ...filters, cursor: undefined, page: 1 }
		: filters;
	const position = pagePosition(
		selectedFilters,
		scope.revision,
		"observations",
	);
	// Page observations in SQL before joining snapshot JSON; pending reads transfer no PR facts.
	const results = await db.batch([
		db
			.prepare(`WITH selected_observations AS MATERIALIZED (
      SELECT o.* FROM pr_observations o WHERE ${where.join(" AND ")} ORDER BY o.identity LIMIT ? OFFSET ?
    ) SELECT o.*,pr.id cached_id,pr.project_id cached_project_id,pr.repository_id cached_repository_id,pr.external_id cached_external_id,pr.version,pr.published_at,
      CASE WHEN pr.id IS NOT NULL THEN json_set(pr.snapshot,'$.description','','$.activity',json('[]')) END AS snapshot
    FROM selected_observations o LEFT JOIN pull_requests pr ON pr.id=o.pull_id
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id=pr.project_id AND p.source=?) ORDER BY o.identity`)
			.bind(...values, lookup ? 1 : filters.limit, position.offset, source),
		db
			.prepare(
				`SELECT COUNT(*) total FROM pr_observations o WHERE ${where.join(" AND ")}`,
			)
			.bind(...values),
		db
			.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
			.bind(source),
		db.prepare("SELECT * FROM ai_evaluations"),
	]);
	if (
		String((results[2]?.results[0] as { revision: number }).revision) !==
		scope.revision
	)
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Data changed while preparing the watch page; retry the query",
			409,
		);
	const total = (results[1]?.results[0] as { total: number }).total;
	if (lookup && total > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"PR alias matches multiple observations",
			409,
		);
	if (lookup && total === 0)
		throw new MonitoringError("NOT_FOUND", "PR has not been watched", 404);
	const rows = (results[0]?.results ?? []) as (ObservationRow & {
		cached_id: string;
		cached_project_id: string;
		cached_repository_id: string;
		cached_external_id: string;
		snapshot: string | null;
		published_at: number | null;
		version: number;
	})[];
	const pulls = rows.flatMap((row) =>
		row.snapshot
			? [
					{
						stored: {
							id: row.cached_id,
							project_id: row.cached_project_id,
							repository_id: row.cached_repository_id,
							external_id: row.cached_external_id,
							snapshot: row.snapshot,
							published_at: row.published_at,
							version: row.version,
						},
						pull: pullRequestSchema.parse(JSON.parse(row.snapshot)),
					},
				]
			: [],
	);
	const observations = rows.map(mapObservation);
	const context = await inspectionContext(db, source, observations, timestamp);
	const evaluations = results[3]?.results as EvaluationRow[];
	const output = await Promise.all(
		observations.map((o) =>
			inspectObservation(
				o,
				pulls.find((r) => r.pull.id === o.pullId)?.pull,
				scope.projects.find((p) => p.id === o.ref.projectId),
				scope.repositories.find(
					(r) =>
						r.project_id === o.ref.projectId &&
						r.repository_id === o.ref.repository.id,
				)?.project_external_id ?? null,
				evaluations.find(
					(e) => e.observation_id === o.id && e.generation === o.generation,
				),
				context,
				timestamp,
			),
		),
	);
	const finalRevision = await db
		.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
		.bind(source)
		.first<{ revision: number }>();
	if (String(finalRevision?.revision) !== scope.revision)
		throw new MonitoringError(
			"SNAPSHOT_CHANGED",
			"Data changed while preparing the watch page; retry the query",
			409,
		);
	const metadata = {
		schemaVersion: 2 as const,
		source: publicSource(source),
		dataRevision: scope.revision,
		generatedAt: iso(timestamp),
	};
	return lookup
		? {
				...metadata,
				data: observationItemSchema.parse(output[0]),
			}
		: {
				...metadata,
				data: output,
				page: pageMetadata(total, filters, scope.revision, position),
			};
}

export function publicJob(
	row: JobRow & { ref_json?: string | null },
	repositories: JobRepositoryRow[],
) {
	return {
		id: row.id,
		target: row.ref_json
			? watchRefSchema.parse(JSON.parse(row.ref_json))
			: null,
		source: publicSource(row.source),
		kind: row.kind === "list" ? ("discover" as const) : ("refresh" as const),
		lane: row.kind === "list" ? ("discover" as const) : ("checks" as const),
		phase: row.phase,
		state: row.state === "complete" ? ("succeeded" as const) : row.state,
		projectId: row.project_id,
		projectRevision: row.revision,
		scope: JSON.parse(row.scope_json) as string[],
		reason: row.cancel_reason,
		error: row.error_kind,
		message: row.message,
		requestedAt: iso(row.requested_at),
		startedAt: iso(row.started_at),
		updatedAt: iso(row.updated_at),
		completedAt: iso(row.completed_at),
		notBefore: iso(row.not_before),
		progress: { completed: row.completed_pulls, total: row.total_pulls },
		observation: row.observation_id
			? {
					id: row.observation_id,
					generation: z
						.number()
						.int()
						.positive()
						.parse(row.observation_generation),
				}
			: null,
		repositories: repositories
			.filter((r) => r.job_id === row.id)
			.map((r) => ({
				repository: { id: r.repository_id, name: r.name },
				state: r.state,
				pullCount: r.pull_count,
				error: r.state === "failed" ? r.message : null,
			})),
	};
}
export async function queryJob(
	db: QueryDatabase,
	source: DataSource,
	id: string,
) {
	const results = await db.batch([
		db
			.prepare("SELECT * FROM collection_jobs WHERE id=? AND source=?")
			.bind(id, source),
		db
			.prepare(
				"SELECT * FROM collection_job_repositories WHERE job_id=? ORDER BY repository_id",
			)
			.bind(id),
	]);
	const job = results[0]?.results[0] as JobRow | undefined;
	if (!job) throw new MonitoringError("NOT_FOUND", "Job not found", 404);
	return {
		...publicJob(job, (results[1]?.results ?? []) as JobRepositoryRow[]),
		events: JSON.parse(job.events_json),
		result: job.result_json ? JSON.parse(job.result_json) : null,
	};
}
export async function queryJobHistory(
	db: QueryDatabase,
	source: DataSource,
	filters: JobHistoryFilters,
) {
	const signature = JSON.stringify([
		source,
		filters.lane,
		filters.outcome,
		filters.group,
	]);
	const where = ["j.source=?", "j.summary_only=0"];
	const values: (string | number)[] = [source];
	if (filters.lane === "discover") where.push("j.kind='list'");
	else if (filters.lane !== "all") {
		where.push("j.kind='details'");
	}
	if (filters.group) {
		if (filters.group.startsWith("pr:")) {
			where.push("j.observation_id=?");
			values.push(filters.group.slice(3));
		} else if (filters.group.startsWith("project:")) {
			where.push("j.project_id=? AND j.kind='list'");
			values.push(filters.group.slice(8));
		} else
			throw new MonitoringError("INVALID_ARGUMENT", "Invalid collection group");
	}
	if (filters.outcome === "issues")
		where.push("j.state IN ('partial','failed','auth_required')");
	if (filters.cursor) {
		try {
			const cursor = z
				.object({
					signature: z.literal(signature),
					at: z.number().int().nonnegative(),
					id: z.string().min(1).max(240),
				})
				.parse(JSON.parse(decodeURIComponent(atob(filters.cursor))));
			where.push("(j.requested_at<? OR (j.requested_at=? AND j.id<?))");
			values.push(cursor.at, cursor.at, cursor.id);
		} catch {
			throw new MonitoringError(
				"INVALID_CURSOR",
				"History cursor is invalid for this query",
			);
		}
	}
	const rows = (
		await db
			.prepare(`SELECT j.*,COALESCE(p.name,json_extract(j.project_json,'$.name'),j.project_id) AS project_name,o.ref_json
		FROM collection_jobs j LEFT JOIN projects p ON p.id=j.project_id
		LEFT JOIN pr_observations o ON o.id=j.observation_id
		WHERE ${where.join(" AND ")} ORDER BY j.requested_at DESC,j.id DESC LIMIT 51`)
			.bind(...values)
			.all<JobRow & { project_name: string; ref_json: string | null }>()
	).results;
	const historyRows = rows.slice(0, 50);
	const last = historyRows.at(-1);
	return {
		data: historyRows.map((row) => ({
			...publicJob(row, []),
			projectName: row.project_name,
			target: row.ref_json
				? watchRefSchema.parse(JSON.parse(row.ref_json))
				: null,
		})),
		nextCursor:
			rows.length > 50 && last
				? btoa(
						encodeURIComponent(
							JSON.stringify({ signature, at: last.requested_at, id: last.id }),
						),
					)
				: null,
	};
}
export async function queryCollector(
	db: QueryDatabase,
	source: DataSource,
	timestamp: number,
) {
	const results = await db.batch([
		db.prepare("SELECT * FROM collector_heartbeat WHERE id=1"),
		db
			.prepare(
				`WITH latest AS (
        SELECT *, (SELECT ref_json FROM pr_observations o WHERE o.id=collection_jobs.observation_id) ref_json,ROW_NUMBER() OVER (
          PARTITION BY project_id,kind,summary_only,observation_id,scope_key ORDER BY requested_at DESC,rowid DESC
        ) AS newest FROM collection_jobs WHERE source=? AND summary_only=0 AND (kind='list' OR EXISTS (
          SELECT 1 FROM pr_observations o WHERE o.id=collection_jobs.observation_id
          AND o.active=1 AND o.generation=collection_jobs.observation_generation))
      ) SELECT * FROM latest WHERE newest=1
      ORDER BY CASE WHEN state IN ('queued','running','auth_required') THEN 0
        WHEN state IN ('failed','partial') AND updated_at>=? THEN 1 ELSE 2 END,updated_at DESC LIMIT 200`,
			)
			.bind(source, timestamp - 300),
		db
			.prepare(
				"SELECT SUM(active) AS active,SUM(CASE WHEN active=1 AND pull_id IS NULL THEN 1 ELSE 0 END) AS pending FROM pr_observations WHERE source=?",
			)
			.bind(source),
		db
			.prepare(
				`SELECT o.id,o.project_id,o.pull_id,
        (SELECT MAX(completed_at) FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=0) last_completed_at,
        EXISTS(SELECT 1 FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=0 AND j.state IN ('queued','running','auth_required')) busy,
        COALESCE(json_extract(pr.snapshot,'$.summaryObservedAt'),json_extract(pr.snapshot,'$.observedAt')) summary_observed_at,
        CASE WHEN json_type(pr.snapshot,'$.checksObservedAt') IS NULL THEN json_extract(pr.snapshot,'$.observedAt') ELSE json_extract(pr.snapshot,'$.checksObservedAt') END checks_observed_at
        FROM pr_observations o LEFT JOIN pull_requests pr ON pr.id=o.pull_id WHERE o.source=? AND o.active=1 ORDER BY o.id`,
			)
			.bind(source),
		db.prepare(
			"SELECT cooldown_seconds,(SELECT cooldown_seconds FROM collection_refresh WHERE kind='list') list_cooldown_seconds FROM collection_refresh WHERE kind='details'",
		),
		db
			.prepare(
				"SELECT COUNT(CASE WHEN state='running' THEN 1 END) AS running,COUNT(CASE WHEN state='queued' THEN 1 END) AS queued,COUNT(CASE WHEN state='auth_required' THEN 1 END) AS authRequired FROM collection_jobs WHERE source=?",
			)
			.bind(source),
		db
			.prepare(
				"SELECT message FROM collection_jobs WHERE source=? AND state='auth_required' ORDER BY updated_at DESC LIMIT 1",
			)
			.bind(source),
		db
			.prepare("SELECT revision FROM workbench_revisions WHERE source=?")
			.bind(source),
	]);
	const heartbeat = results[0]?.results[0] as
		| {
				last_seen_at: number;
				state: "ready" | "auth_required" | "error";
				message: string;
		  }
		| undefined;
	const jobs = (results[1]?.results ?? []) as JobRow[];
	const counts = results[2]?.results[0] as {
		active: number | null;
		pending: number | null;
	};
	const cooldown = (results[4]?.results[0] as { cooldown_seconds: number })
		.cooldown_seconds;
	const auth = results[6]?.results[0] as { message: string } | undefined;
	const offline = !heartbeat || timestamp - heartbeat.last_seen_at > 65;
	const cadence = (results[3]?.results ?? []) as {
		id: string;
		project_id: string;
		pull_id: string | null;
		last_completed_at: number | null;
		busy: number;
		summary_observed_at: number | null;
		checks_observed_at: number | null;
	}[];
	const due = cadence.flatMap((item) =>
		cooldown && !item.busy
			? [
					item.last_completed_at === null
						? timestamp
						: item.last_completed_at + cooldown,
				]
			: [],
	);
	const oldest = (field: "summary_observed_at" | "checks_observed_at") => {
		const ages = cadence.flatMap((item) =>
			item[field] === null
				? []
				: [Math.max(0, timestamp - Math.floor(item[field]))],
		);
		return ages.length ? Math.max(...ages) : null;
	};
	return {
		queue: results[5]?.results[0] as {
			running: number;
			queued: number;
			authRequired: number;
		},
		schemaVersion: 1 as const,
		source: publicSource(source),
		dataRevision: String(
			(results[7]?.results[0] as { revision: number }).revision,
		),
		generatedAt: iso(timestamp),
		connection: {
			state: offline
				? ("offline" as const)
				: auth
					? ("auth_required" as const)
					: heartbeat.state,
			lastSeenAt: iso(heartbeat?.last_seen_at),
			message: offline
				? "Start signoff daemon to collect watched PRs"
				: (auth?.message ?? heartbeat.message),
		},
		watching: counts.active ?? 0,
		pendingFirstResult: counts.pending ?? 0,
		detailCooldownSeconds: cooldown,
		listCooldownSeconds: (
			results[4]?.results[0] as { list_cooldown_seconds: number }
		).list_cooldown_seconds,
		discovery: "scheduled" as const,
		jobs: jobs.map((j) => publicJob(j, [])),
		// Retained as an empty compatibility field for older v1 clients.
		rounds: [],
		scheduling: {
			strategy: "per_pr" as const,
			checksConcurrency: 2,
			discoveryConcurrency: 1,
			nextCheckDueAt: due.length ? iso(Math.min(...due)) : null,
			overdueChecks: due.filter((at) => at <= timestamp).length,
			oldestChecksAgeSeconds: oldest("checks_observed_at"),
			oldestSummaryAgeSeconds: oldest("summary_observed_at"),
			missingChecks: cadence.filter((item) => item.checks_observed_at === null)
				.length,
		},
	};
}
