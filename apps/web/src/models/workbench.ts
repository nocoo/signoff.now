import {
	type Project,
	type PullReadiness,
	type PullRequest,
	pullProgress,
	pullReadiness,
	type Workbench,
} from "@signoff/domain/workbench";

export type PullRow = {
	pull: PullRequest;
	project: Project;
	readiness: PullReadiness;
	progress: ReturnType<typeof pullProgress>;
};
export type PullFilter = {
	source: "all" | "cli" | "demo";
	query: string;
	projectId: string;
	repository: string;
	state: "open" | "merged" | "closed" | "all";
	status: "all" | "attention" | PullReadiness["kind"];
	sort: "attention" | "updated" | "oldest";
};
export const DEFAULT_PULL_FILTER: PullFilter = {
	source: "all",
	query: "",
	projectId: "",
	repository: "",
	state: "open",
	status: "all",
	sort: "attention",
};
const ATTENTION = new Set(["blocked", "approval", "review", "unknown"]);
const ORDER = {
	blocked: 0,
	approval: 1,
	unknown: 2,
	review: 3,
	running: 4,
	ready: 5,
	draft: 6,
	merged: 7,
	closed: 8,
};

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
	const source = params.get("source") ?? (hasLiveProjects ? "cli" : "all");
	const state = params.get("state") ?? "open";
	const status = params.get("status") ?? "all";
	const sort = params.get("sort") ?? "attention";
	return {
		source: ["all", "cli", "demo"].includes(source)
			? (source as PullFilter["source"])
			: "all",
		query: params.get("q") ?? "",
		projectId: params.get("project") ?? "",
		repository: params.get("repo") ?? "",
		state: ["open", "merged", "closed", "all"].includes(state)
			? (state as PullFilter["state"])
			: "open",
		status: ["all", "attention", ...Object.keys(ORDER)].includes(status)
			? (status as PullFilter["status"])
			: "all",
		sort: ["attention", "updated", "oldest"].includes(sort)
			? (sort as PullFilter["sort"])
			: "attention",
	};
}

export function scopePulls(rows: PullRow[], filter: PullFilter): PullRow[] {
	const query = filter.query.trim().toLowerCase();
	return rows.filter(
		({ pull, project, readiness }) =>
			(filter.source === "all" || project.source === filter.source) &&
			(!filter.projectId || project.id === filter.projectId) &&
			(!filter.repository || pull.repository.id === filter.repository) &&
			(!query ||
				[
					pull.title,
					`#${pull.number}`,
					pull.author.name,
					pull.repository.name,
					project.name,
					readiness.owner,
					readiness.action,
				]
					.join(" ")
					.toLowerCase()
					.includes(query)),
	);
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
					? ORDER[a.readiness.kind] - ORDER[b.readiness.kind]
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

export function repositoryOptions(rows: PullRow[], projectId = "") {
	const repositories = new Map<
		string,
		{ id: string; name: string; projectName: string }
	>();
	for (const { pull, project } of rows) {
		if (!projectId || project.id === projectId)
			repositories.set(pull.repository.id, {
				...pull.repository,
				projectName: project.name,
			});
	}
	return [...repositories.values()].sort(
		(a, b) =>
			a.name.localeCompare(b.name) ||
			a.projectName.localeCompare(b.projectName),
	);
}

export function projectSummaries(data: Workbench, rows: PullRow[]) {
	return data.projects.map((project) => {
		const pulls = rows.filter((row) => row.project.id === project.id);
		return {
			project,
			job:
				(data.collectionJobs ?? [])
					.filter((job) => job.projectId === project.id)
					.sort(
						(a, b) =>
							b.requestedAt - a.requestedAt || b.updatedAt - a.updatedAt,
					)[0] ?? null,
			metrics: pullMetrics(pulls),
			total: pulls.length,
			repositories: repositoryOptions(pulls),
			scans: data.scans.filter((scan) => scan.projectId === project.id),
		};
	});
}

export function canScanProject(project: Project, data: Workbench): boolean {
	return (
		project.enabled &&
		project.provider === "ado" &&
		(project.source === "cli" || data.demoMode) &&
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
	now = Date.now() / 1000,
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
