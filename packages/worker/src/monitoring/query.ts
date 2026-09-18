import {
	type DataSource,
	makeWatchRef,
	type Observation,
	parseRepositoryReference,
	publicSource,
	referenceLinks,
} from "@signoff/domain/monitoring";
import {
	observationItemSchema,
	type PullQueryItem,
	projectQuerySchema,
	pullQuerySchema,
	type RepositoryQueryItem,
} from "@signoff/domain/query";
import {
	type Project,
	type PullRequest,
	projectMergeRequirements,
	projectUrl,
	pullProgress,
	pullReadiness,
	pullRequestSchema,
	pullRequirements,
	readinessPriority,
	repositoryUrl,
} from "@signoff/domain/workbench";
import { z } from "zod";
import {
	type JobRepositoryRow,
	type JobRow,
	MonitoringError,
	mapObservation,
	mapProject,
	type ObservationRow,
	type ProjectRow,
	type RepositoryRow,
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
			"attention",
			"ready",
			"approval",
			"review",
			"running",
			"unknown",
			"blocked",
			"draft",
			"merged",
			"closed",
		])
		.default("all"),
	sort: z
		.enum([
			"identity",
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
/** All statements here are SELECTs in one consistency batch. Queries never change collection state. */
async function readSnapshot(
	db: Pick<D1Database, "prepare" | "batch">,
	source: DataSource,
	options: {
		detailId?: string;
		observedOnly?: boolean;
		catalog?: boolean;
		filters?: QueryFilters;
	} = {},
) {
	const { detailId, filters } = options;
	const where = ["p.source=?"];
	const values: (string | number)[] = [source];
	if (detailId) {
		where.push("pr.id=?");
		values.push(detailId);
	}
	if (options.observedOnly)
		where.push(
			"EXISTS (SELECT 1 FROM pr_observations o WHERE o.pull_id=pr.id AND o.source=p.source)",
		);
	if (options.catalog)
		where.push("pr.state='open' AND json_extract(pr.snapshot,'$.draft')=0");
	if (filters) {
		for (const [sql, value] of [
			["p.provider=?", filters.provider],
			["lower(p.organization)=?", filters.org],
			[
				"(lower(p.project_key)=? OR lower(p.id)=?)",
				filters.project.toLowerCase(),
			],
			["p.id=?", filters.projectId],
			[
				"(lower(pr.repository_id)=? OR lower(json_extract(pr.snapshot,'$.repository.name'))=?)",
				filters.repositoryId.toLowerCase(),
			],
		] as const)
			if (value) {
				where.push(sql);
				values.push(value);
				if (sql.includes(" OR ")) values.push(value);
			}
		if (filters.repo.length) {
			where.push(`EXISTS (SELECT 1 FROM json_each(?) f WHERE json_extract(f.value,'$.provider')=p.provider
        AND json_extract(f.value,'$.organization')=lower(p.organization) AND json_extract(f.value,'$.projectKey')=lower(p.project_key)
        AND json_extract(f.value,'$.repository') IN (lower(pr.repository_id),lower(json_extract(pr.snapshot,'$.repository.name'))))`);
			values.push(
				JSON.stringify(
					filters.repo.map((url) => {
						const ref = parseRepositoryReference(url);
						return {
							provider: ref.provider,
							organization: ref.organization.toLowerCase(),
							projectKey: ref.projectKey.toLowerCase(),
							repository: ref.repository.toLowerCase(),
						};
					}),
				),
			);
		}
	}
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
	]);
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
		projects,
		pulls,
		observations: ((results[2]?.results ?? []) as ObservationRow[]).map(
			mapObservation,
		),
		repositories: (results[3]?.results ?? []) as RepositoryRow[],
		revision: String((results[4]?.results[0] as { revision: number }).revision),
		counts: (results[5]?.results ?? []) as RepositoryCounts[],
	};
}
type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
const authorKey = (p: Project, pr: PullRequest) =>
	JSON.stringify([p.provider, p.organization.toLowerCase(), pr.author.id]);
function observationFor(data: Snapshot, pr: PullRequest) {
	return (
		data.observations.find(
			(o) =>
				o.ref.projectId === pr.projectId &&
				o.ref.repository.id.toLowerCase() === pr.repository.id.toLowerCase() &&
				o.ref.number === pr.number,
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
	const readiness = pullReadiness(pr, project);
	const observation = observationFor(data, pr);
	const checks =
		pr.checksObservedAt === undefined ? pr.observedAt : pr.checksObservedAt;
	return pullQuerySchema.parse({
		...pr,
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
			listObservedAt: iso(pr.observedAt),
			checksObservedAt: iso(checks),
			checksValidity:
				checks !== null
					? "valid"
					: pr.checksInvalidated
						? "invalidated"
						: "missing",
			ageSeconds: {
				list: Math.max(0, timestamp - pr.observedAt),
				checks: checks === null ? null : Math.max(0, timestamp - checks),
			},
			clockSkew:
				pr.observedAt > timestamp || (checks !== null && checks > timestamp),
		},
		readiness: {
			...readiness,
			ready: readiness.kind === "ready",
			primaryRequirementId: readiness.gateId ?? null,
			nextAction: readiness.action,
		},
		checks: pullProgress(pr),
		requirements: pullRequirements(pr, project),
		content: { state: pr.coverage, missing: pr.collectionIssues ?? [] },
	});
}
function coverage(data: Snapshot) {
	const missing: string[] = [];
	for (const project of data.projects) {
		const repos = data.repositories.filter((r) => r.project_id === project.id);
		if (
			!repos.length ||
			project.repositories?.some(
				(name) =>
					!repos.some((r) =>
						[r.name.toLowerCase(), r.repository_id.toLowerCase()].includes(
							name.toLowerCase(),
						),
					),
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
function page<T>(
	items: T[],
	filters: QueryFilters,
	revision: string,
	kind: string,
) {
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
	const next = offset + filters.limit;
	return {
		data: items.slice(offset, next),
		page: {
			limit: filters.limit,
			total: items.length,
			nextCursor:
				next < items.length
					? btoa(
							encodeURIComponent(
								JSON.stringify({ signature, revision, offset: next }),
							),
						)
					: null,
		},
	};
}
function scopeMatches(
	project: Project,
	repo: { id: string | null; name: string },
	f: QueryFilters,
) {
	return (
		(!f.provider || f.provider === project.provider) &&
		(!f.org || f.org === project.organization.toLowerCase()) &&
		(!f.project ||
			[project.projectKey.toLowerCase(), project.id].includes(
				f.project.toLowerCase(),
			)) &&
		(!f.projectId || f.projectId === project.id) &&
		(!f.repositoryId ||
			[repo.id?.toLowerCase(), repo.name.toLowerCase()].includes(
				f.repositoryId.toLowerCase(),
			)) &&
		(!f.repo.length ||
			f.repo.some((url) => {
				const r = parseRepositoryReference(url);
				return (
					r.provider === project.provider &&
					r.organization.toLowerCase() === project.organization.toLowerCase() &&
					r.projectKey.toLowerCase() === project.projectKey.toLowerCase() &&
					[repo.id?.toLowerCase(), repo.name.toLowerCase()].includes(
						r.repository.toLowerCase(),
					)
				);
			}))
	);
}

export async function queryPulls(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	const snapshot = await readSnapshot(db, source, { filters });
	const projects = new Map(snapshot.projects.map((p) => [p.id, p]));
	// ponytail: readiness sorting evaluates cached facts in the Worker; materialize ranks if large open sets exceed the CPU budget.
	const scoped = snapshot.pulls.flatMap((row) => {
		const p = projects.get(row.pull.projectId);
		if (!p) throw new Error("Cached PR has no project");
		const pr = row.pull;
		if (!scopeMatches(p, pr.repository, filters)) return [];
		const readiness = pullReadiness(pr, p);
		const observation = observationFor(snapshot, pr);
		if (
			filters.watching !== undefined &&
			(observation?.active ?? false) !== (filters.watching === "true")
		)
			return [];
		if (
			filters.q &&
			![
				pr.title,
				`#${pr.number}`,
				pr.author.name,
				pr.repository.name,
				p.name,
				p.organization,
				p.projectKey,
				readiness.owner,
				readiness.action,
			]
				.join(" ")
				.toLowerCase()
				.includes(filters.q)
		)
			return [];
		return [{ ...row, project: p, readiness, progress: pullProgress(pr) }];
	});
	const authors = [
		...new Map(
			scoped.map((row) => [
				authorKey(row.project, row.pull),
				{
					id: authorKey(row.project, row.pull),
					name: row.pull.author.name,
					provider: row.project.provider,
				},
			]),
		).values(),
	].sort((a, b) => a.name.localeCompare(b.name));
	const base = scoped.filter(
		(row) =>
			(filters.draft === "include" ||
				row.pull.draft === (filters.draft === "only")) &&
			(!filters.author.length ||
				filters.author.includes(authorKey(row.project, row.pull))),
	);
	const open = base.filter((row) => row.pull.state === "open");
	const attention = new Set(["blocked", "approval", "review", "unknown"]);
	const metrics = {
		open: open.length,
		attention: open.filter((r) => attention.has(r.readiness.kind)).length,
		running: open.filter((r) => r.readiness.kind === "running").length,
		ready: open.filter((r) => r.readiness.kind === "ready").length,
		draft: open.filter((r) => r.pull.draft).length,
		merged: base.filter((r) => r.pull.state === "merged").length,
		closed: base.filter((r) => r.pull.state === "closed").length,
	};
	const rows = base.filter(
		(row) =>
			(filters.state === "all" || row.pull.state === filters.state) &&
			(filters.status === "all" ||
				(filters.status === "attention"
					? attention.has(row.readiness.kind)
					: row.readiness.kind === filters.status)),
	);
	const completion = (r: (typeof rows)[number]) =>
		r.pull.coverage === "partial" || r.pull.checksObservedAt === null
			? -1
			: r.progress.checksTotal
				? r.progress.checksPassed / r.progress.checksTotal
				: 1;
	rows.sort((a, b) => {
		let compare = 0;
		switch (filters.sort) {
			case "readiness":
				compare =
					readinessPriority(a.readiness, a.project) -
					readinessPriority(b.readiness, b.project);
				break;
			case "title":
				compare = a.pull.title.localeCompare(b.pull.title);
				break;
			case "progress":
				compare = completion(a) - completion(b);
				break;
			case "action":
				compare = a.readiness.action.localeCompare(b.readiness.action);
				break;
			case "updated":
				compare = a.pull.updatedAt - b.pull.updatedAt;
				break;
			case "oldest":
				compare = a.pull.createdAt - b.pull.createdAt;
				break;
			default:
				compare = a.pull.id.localeCompare(b.pull.id);
		}
		return (
			compare * (filters.direction === "desc" ? -1 : 1) ||
			a.pull.id.localeCompare(b.pull.id)
		);
	});
	const selected = page(rows, filters, snapshot.revision, "prs");
	return {
		...envelope(snapshot, source, timestamp),
		...selected,
		data: selected.data.map((row) => pullOutput(snapshot, row, timestamp)),
		metrics,
		authors,
	};
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
	const ref = parseRepositoryReference(url);
	const row = await db
		.prepare(`SELECT pr.id FROM pull_requests pr JOIN projects p ON p.id=pr.project_id LEFT JOIN workbench_repositories r ON r.project_id=p.id AND r.repository_id=pr.repository_id
    WHERE p.source=? AND p.provider=? AND lower(p.organization)=? AND lower(p.project_key)=? AND pr.external_id=?
    AND (lower(pr.repository_id)=? OR lower(json_extract(pr.snapshot,'$.repository.name'))=? OR EXISTS (SELECT 1 FROM json_each(r.aliases_json) a WHERE lower(a.value)=?))`)
		.bind(
			source,
			ref.provider,
			ref.organization.toLowerCase(),
			ref.projectKey.toLowerCase(),
			String(number),
			ref.repository.toLowerCase(),
			ref.repository.toLowerCase(),
			ref.repository.toLowerCase(),
		)
		.all<{ id: string }>();
	if (row.results.length > 1)
		throw new MonitoringError(
			"REFERENCE_AMBIGUOUS",
			"Repository alias is ambiguous",
			409,
		);
	if (!row.results[0])
		throw new MonitoringError("CACHE_MISS", "PR is not in the cache", 404);
	return queryPull(db, source, row.results[0].id, timestamp);
}

export async function queryRepos(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
) {
	const snapshot = await readSnapshot(db, source, { catalog: true, filters });
	const output: RepositoryQueryItem[] = [];
	for (const project of snapshot.projects) {
		const known = snapshot.repositories.filter(
			(r) => r.project_id === project.id,
		);
		const items: [string | null, string, RepositoryRow | undefined][] =
			known.map((r) => [r.repository_id, r.name, r]);
		for (const name of project.repositories ?? [])
			if (
				!known.some((r) =>
					[r.repository_id.toLowerCase(), r.name.toLowerCase()].includes(
						name.toLowerCase(),
					),
				)
			)
				items.push([null, name, undefined]);
		for (const [id, name, stored] of items) {
			if (!scopeMatches(project, { id, name }, filters)) continue;
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
					url: repositoryUrl(project, name),
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
					attention: prs.filter(
						(p) =>
							p.state === "open" &&
							!p.draft &&
							["blocked", "approval", "review", "unknown"].includes(
								pullReadiness(p, project).kind,
							),
					).length,
					running: prs.filter(
						(p) =>
							p.state === "open" &&
							!p.draft &&
							pullReadiness(p, project).kind === "running",
					).length,
					ready: prs.filter(
						(p) =>
							p.state === "open" &&
							!p.draft &&
							pullReadiness(p, project).kind === "ready",
					).length,
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
export async function queryObservations(
	db: QueryDatabase,
	source: DataSource,
	filters: QueryFilters,
	timestamp: number,
	lookup?: { pullId: string } | { repositoryUrl: string; number: number },
) {
	const snapshot = await readSnapshot(db, source, { observedOnly: true });
	let rows = snapshot.observations.filter(
		(o) =>
			(lookup || filters.includeStopped === "true" || o.active) &&
			(lookup || filters.pending !== "true" || o.pullId === null),
	);
	if (lookup) {
		if ("pullId" in lookup)
			rows = rows.filter((o) => o.pullId === lookup.pullId);
		else {
			const ref = parseRepositoryReference(lookup.repositoryUrl);
			rows = rows.filter(
				(o) =>
					o.ref.provider === ref.provider &&
					o.ref.organization.toLowerCase() === ref.organization.toLowerCase() &&
					o.ref.projectKey.toLowerCase() === ref.projectKey.toLowerCase() &&
					o.ref.number === lookup.number &&
					[
						o.ref.repository.id,
						o.ref.repository.name,
						...(JSON.parse(
							snapshot.repositories.find(
								(r) =>
									r.project_id === o.ref.projectId &&
									r.repository_id === o.ref.repository.id,
							)?.aliases_json ?? "[]",
						) as string[]),
					].some((s) => s.toLowerCase() === ref.repository.toLowerCase()),
			);
		}
		if (rows.length > 1)
			throw new MonitoringError(
				"REFERENCE_AMBIGUOUS",
				"PR alias matches multiple observations",
				409,
			);
		if (!rows[0])
			throw new MonitoringError("NOT_FOUND", "PR has not been watched", 404);
	} else
		rows = rows.filter((o) =>
			scopeMatches(
				{
					provider: o.ref.provider,
					organization: o.ref.organization,
					projectKey: o.ref.projectKey,
					id: o.ref.projectId,
				} as Project,
				o.ref.repository,
				filters,
			),
		);
	const selected = page(
		rows,
		lookup ? { ...filters, cursor: undefined, page: 1 } : filters,
		snapshot.revision,
		"observations",
	);
	const output = selected.data.map((o) => {
		const row = snapshot.pulls.find((r) => r.pull.id === o.pullId);
		return {
			...publicObservation(o),
			pull: row ? pullOutput(snapshot, row, timestamp) : null,
		};
	});
	return lookup
		? {
				...envelope(snapshot, source, timestamp),
				data: observationItemSchema.parse(output[0]),
			}
		: { ...envelope(snapshot, source, timestamp), ...selected, data: output };
}

export function publicJob(row: JobRow, repositories: JobRepositoryRow[]) {
	return {
		id: row.id,
		source: publicSource(row.source),
		kind: row.kind === "list" ? ("discover" as const) : ("refresh" as const),
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
	return publicJob(job, (results[1]?.results ?? []) as JobRepositoryRow[]);
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
				"SELECT * FROM collection_jobs WHERE source=? ORDER BY CASE WHEN state IN ('queued','running','auth_required') THEN 0 ELSE 1 END,updated_at DESC LIMIT 200",
			)
			.bind(source),
		db
			.prepare(
				"SELECT SUM(active) AS active,SUM(CASE WHEN active=1 AND pull_id IS NULL THEN 1 ELSE 0 END) AS pending FROM pr_observations WHERE source=?",
			)
			.bind(source),
		db
			.prepare(
				"SELECT q.* FROM collection_project_rounds q JOIN projects p ON p.id=q.project_id WHERE p.source=?",
			)
			.bind(source),
		db.prepare(
			"SELECT cooldown_seconds FROM collection_refresh WHERE kind='details'",
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
	return {
		queue: results[5]?.results[0] as {
			running: number;
			queued: number;
			authRequired: number;
		},
		schemaVersion: 1 as const,
		source: publicSource(source),
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
		discovery: "on_demand" as const,
		jobs: jobs.map((j) => publicJob(j, [])),
		rounds: (
			(results[3]?.results ?? []) as {
				project_id: string;
				round_id: string | null;
				last_completed_at: number | null;
			}[]
		).map((r) => ({
			projectId: r.project_id,
			roundId: r.round_id,
			lastCompletedAt: iso(r.last_completed_at),
			nextDueAt:
				r.round_id || !cooldown || r.last_completed_at === null
					? null
					: iso(r.last_completed_at + cooldown),
		})),
	};
}
