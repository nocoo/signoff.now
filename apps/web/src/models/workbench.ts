import {
	type Project,
	type PullReadiness,
	type PullRequest,
	pullProgress,
	pullReadiness,
	READINESS_PRIORITY,
	readinessPriority,
	type Workbench,
} from "@signoff/domain/workbench";

export type PullRow = {
	pull: PullRequest;
	project: Project;
	readiness: PullReadiness;
	progress: ReturnType<typeof pullProgress>;
};
export type PullFilter = {
	source: "cli" | "demo";
	query: string;
	organization: string;
	projectId: string;
	repository: string;
	draft: "exclude" | "include" | "only";
	authors: string[];
	state: "open" | "merged" | "closed" | "all";
	status: "all" | "attention" | PullReadiness["kind"];
	sort: "attention" | "updated" | "oldest";
};
export const DEFAULT_PULL_FILTER: PullFilter = {
	source: "demo",
	query: "",
	organization: "",
	projectId: "",
	repository: "",
	draft: "exclude",
	authors: [],
	state: "open",
	status: "all",
	sort: "attention",
};
export const PULL_FILTER_PARAMS = {
	source: "source",
	query: "q",
	organization: "org",
	projectId: "project",
	repository: "repo",
	draft: "draft",
	state: "state",
	status: "status",
	sort: "sort",
} as const;
export const PULL_FILTER_STORAGE_KEY = "signoff-pull-filters";
export const AUTO_REFRESH_STORAGE_KEY = "signoff-auto-refresh-seconds";
export const REFRESH_INTERVALS = [0, 60, 120, 300, 600];
export const DEFAULT_REFRESH_INTERVAL = 120;
const ATTENTION = new Set(["blocked", "approval", "review", "unknown"]);

export function pullRows(data: Workbench): PullRow[] {
	const projects = new Map(data.projects.map((p) => [p.id, p]));
	return data.pullRequests.flatMap((pull) => {
		const project = projects.get(pull.projectId);
		return project
			? [
					{
						pull,
						project,
						readiness: pullReadiness(pull, project),
						progress: pullProgress(pull),
					},
				]
			: [];
	});
}

export function readPullFilter(
	params: URLSearchParams,
	hasLiveProjects = false,
): PullFilter {
	const defaultSource = hasLiveProjects ? "cli" : "demo";
	const source = params.get("source") ?? defaultSource;
	const state = params.get("state") ?? "open";
	const legacyStatus = params.get("status") ?? "all";
	const status = legacyStatus === "draft" ? "all" : legacyStatus;
	const sort = params.get("sort") ?? "attention";
	const draft =
		params.get("draft") ?? (legacyStatus === "draft" ? "only" : "exclude");
	return {
		source: ["cli", "demo"].includes(source)
			? (source as PullFilter["source"])
			: defaultSource,
		query: params.get("q") ?? "",
		organization: (params.get("org") ?? "").toLowerCase(),
		projectId: params.get("project") ?? "",
		repository: params.get("repo") ?? "",
		draft: ["exclude", "include", "only"].includes(draft)
			? (draft as PullFilter["draft"])
			: "exclude",
		authors: [...new Set(params.getAll("author").filter(Boolean))],
		state: ["open", "merged", "closed", "all"].includes(state)
			? (state as PullFilter["state"])
			: "open",
		status: ["all", "attention", ...Object.keys(READINESS_PRIORITY)].includes(
			status,
		)
			? (status as PullFilter["status"])
			: "all",
		sort: ["attention", "updated", "oldest"].includes(sort)
			? (sort as PullFilter["sort"])
			: "attention",
	};
}

export function writePullFilter(
	filter: PullFilter,
	previous = new URLSearchParams(),
): URLSearchParams {
	const params = new URLSearchParams(previous);
	for (const key of Object.keys(
		PULL_FILTER_PARAMS,
	) as (keyof typeof PULL_FILTER_PARAMS)[]) {
		const param = PULL_FILTER_PARAMS[key];
		if (key !== "source" && filter[key] === DEFAULT_PULL_FILTER[key])
			params.delete(param);
		else params.set(param, filter[key]);
	}
	params.delete("author");
	for (const author of filter.authors) params.append("author", author);
	return params;
}

export function pullAuthorId(row: PullRow): string {
	return `${row.project.provider}:${row.pull.author.id}`;
}

export function authorOptions(rows: PullRow[]) {
	return [
		...new Map(
			rows.map((row) => [
				pullAuthorId(row),
				{
					id: pullAuthorId(row),
					name: row.pull.author.name,
					provider: row.project.provider,
				},
			]),
		).values(),
	].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function matchesRepository(
	repository: PullRequest["repository"],
	value: string,
) {
	const key = value.toLowerCase();
	return (
		repository.id.toLowerCase() === key || repository.name.toLowerCase() === key
	);
}

export function scopePulls(rows: PullRow[], filter: PullFilter): PullRow[] {
	const query = filter.query.trim().toLowerCase();
	return rows.filter((row) => {
		const { pull, project, readiness } = row;
		return (
			project.source === filter.source &&
			(filter.draft === "include" ||
				pull.draft === (filter.draft === "only")) &&
			(!filter.authors.length || filter.authors.includes(pullAuthorId(row))) &&
			(!filter.organization ||
				project.organization.toLowerCase() ===
					filter.organization.toLowerCase()) &&
			(!filter.projectId || project.id === filter.projectId) &&
			(!filter.repository ||
				matchesRepository(pull.repository, filter.repository)) &&
			(!query ||
				[
					pull.title,
					`#${pull.number}`,
					pull.author.name,
					pull.repository.name,
					project.name,
					project.organization,
					project.projectKey,
					readiness.owner,
					readiness.action,
				]
					.join(" ")
					.toLowerCase()
					.includes(query))
		);
	});
}

export function visiblePulls(scoped: PullRow[], filter: PullFilter): PullRow[] {
	return scoped
		.filter(
			(row) =>
				(filter.state === "all" || row.pull.state === filter.state) &&
				(filter.status === "all" ||
					(filter.status === "attention"
						? ATTENTION.has(row.readiness.kind)
						: row.readiness.kind === filter.status)),
		)
		.sort((a, b) => {
			if (filter.sort === "oldest")
				return (
					a.pull.createdAt - b.pull.createdAt ||
					a.pull.id.localeCompare(b.pull.id)
				);
			const priority =
				filter.sort === "attention"
					? readinessPriority(a.readiness) - readinessPriority(b.readiness)
					: 0;
			return (
				priority ||
				b.pull.updatedAt - a.pull.updatedAt ||
				a.pull.id.localeCompare(b.pull.id)
			);
		});
}

export function pullMetrics(rows: PullRow[]) {
	const open = rows.filter((row) => row.pull.state === "open");
	return {
		open: open.length,
		attention: open.filter((row) => ATTENTION.has(row.readiness.kind)).length,
		running: open.filter((row) => row.readiness.kind === "running").length,
		ready: open.filter((row) => row.readiness.kind === "ready").length,
		draft: open.filter((row) => row.readiness.kind === "draft").length,
		merged: rows.filter((row) => row.pull.state === "merged").length,
		closed: rows.filter((row) => row.pull.state === "closed").length,
	};
}

export function repositoryOptions(
	rows: PullRow[],
	projectId = "",
	projects: Project[] = [],
	matchingRows = rows,
) {
	const matchingIds = new Set(matchingRows.map((row) => row.pull.id));
	const repositories = new Map<
		string,
		{ key: string; id: string; name: string; project: Project; rows: PullRow[] }
	>();
	for (const row of rows) {
		const { pull, project } = row;
		if (projectId && project.id !== projectId) continue;
		const key = JSON.stringify([project.id, pull.repository.id]);
		const repository = repositories.get(key) ?? {
			key,
			...pull.repository,
			project,
			rows: [],
		};
		repository.rows.push(row);
		repositories.set(key, repository);
	}
	for (const project of projects) {
		if (projectId && project.id !== projectId) continue;
		const known = [...repositories.values()].filter(
			(repo) => repo.project.id === project.id,
		);
		for (const name of project.repositories ?? []) {
			if (known.some((repo) => matchesRepository(repo, name))) continue;
			const key = JSON.stringify([project.id, name]);
			repositories.set(key, { key, id: name, name, project, rows: [] });
		}
	}
	return [...repositories.values()]
		.map(({ rows: pulls, ...repository }) => {
			const matching = pulls.filter((row) => matchingIds.has(row.pull.id));
			return {
				...repository,
				metrics: pullMetrics(matching),
				total: matching.length,
			};
		})
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name) ||
				a.project.organization.localeCompare(b.project.organization) ||
				a.project.projectKey.localeCompare(b.project.projectKey) ||
				a.key.localeCompare(b.key),
		);
}

export function projectSummaries(
	data: Workbench,
	rows: PullRow[],
	matchingRows = rows,
) {
	return data.projects.map((project) => {
		const pulls = matchingRows.filter((row) => row.project.id === project.id);
		return {
			project,
			job:
				(data.collectionJobs ?? [])
					.filter((job) => job.projectId === project.id)
					.sort(
						(a, b) =>
							b.revision - a.revision ||
							b.requestedAt - a.requestedAt ||
							b.updatedAt - a.updatedAt,
					)[0] ?? null,
			metrics: pullMetrics(pulls),
			total: pulls.length,
			repositories: repositoryOptions(rows, project.id, [project], pulls),
			scans: data.scans.filter((scan) => scan.projectId === project.id),
		};
	});
}

export function canScanProject(project: Project, data: Workbench): boolean {
	return (
		project.enabled &&
		(project.source === "demo" ? data.demoMode : project.provider === "ado") &&
		!(data.collectionJobs ?? []).some(
			(job) =>
				job.projectId === project.id &&
				job.revision === project.revision &&
				(job.state === "queued" || job.state === "running"),
		)
	);
}

export function collectorConnection(
	data: Workbench | null,
	now = data?.fetchedAt ?? Date.now() / 1000,
) {
	if (!data?.collector || now - data.collector.lastSeenAt > 65)
		return {
			state: "offline" as const,
			message:
				"Start the local collector to scan Azure DevOps: bun run dev:collector",
		};
	return { state: data.collector.state, message: data.collector.message };
}

export function relativeTime(
	timestamp: number | null,
	now = Date.now() / 1000,
): string {
	if (timestamp === null) return "Never scanned";
	const seconds = Math.max(0, now - timestamp);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

export function duration(seconds: number | null): string {
	if (seconds === null) return "—";
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
