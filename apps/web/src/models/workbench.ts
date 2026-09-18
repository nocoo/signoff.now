import type { Observation } from "@signoff/domain/monitoring";
import {
	type Project,
	type PullReadiness,
	type PullRequest,
	type pullProgress,
	readinessKindSchema,
} from "@signoff/domain/workbench";

export type PullRow = {
	observation?: Observation | null;
	watching?: boolean;
	watchPending?: boolean;
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
	sort: "readiness" | "title" | "progress" | "action" | "updated" | "oldest";
	sortDirection: "asc" | "desc";
	watching: "all" | "watching" | "unwatched";
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
	sort: "readiness",
	sortDirection: "asc",
	watching: "all",
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
	sortDirection: "direction",
	watching: "watching",
} as const;
export const PULL_FILTER_STORAGE_KEY = "signoff-pull-filters";
export const REFRESH_INTERVALS = [0, 60, 120, 300, 600] as const;

export function updatePullFilter(
	filter: PullFilter,
	patch: Partial<PullFilter> = {},
): PullFilter {
	const next = { ...filter, ...patch };
	if (patch.state !== undefined && patch.status === undefined)
		next.status = "all";
	if (
		(patch.status !== undefined && patch.status !== "all") ||
		(patch.watching === "watching" &&
			(next.state === "merged" || next.state === "closed"))
	)
		next.state = "open";
	// Old readiness links used terminal states as readiness values.
	if (next.status === "merged" || next.status === "closed") {
		next.state = next.status;
		next.status = "all";
	}
	if (next.state === "merged" || next.state === "closed") {
		next.status = "all";
		if (next.watching === "watching") next.watching = "all";
	} else if (next.status !== "all") next.state = "open";
	return next;
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
	const requestedSort = params.get("sort");
	const sort = [
		"readiness",
		"title",
		"progress",
		"action",
		"updated",
		"oldest",
	].includes(requestedSort ?? "")
		? (requestedSort as PullFilter["sort"])
		: "readiness";
	const direction = params.get("direction");
	const draft =
		params.get("draft") ?? (legacyStatus === "draft" ? "only" : "exclude");
	return updatePullFilter({
		watching:
			params.get("watching") === "watching" ||
			params.get("watching") === "unwatched"
				? (params.get("watching") as PullFilter["watching"])
				: "all",
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
		status: ["all", "attention", ...readinessKindSchema.options].includes(
			status,
		)
			? (status as PullFilter["status"])
			: "all",
		sort,
		sortDirection:
			direction === "asc" || direction === "desc"
				? direction
				: defaultSortDirection(sort),
	});
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
		if (
			key !== "source" &&
			filter[key] === DEFAULT_PULL_FILTER[key] &&
			!(key === "sortDirection" && filter.sort !== "readiness")
		)
			params.delete(param);
		else params.set(param, filter[key]);
	}
	params.delete("author");
	for (const author of filter.authors) params.append("author", author);
	return params;
}

export function matchesRepository(
	repository: PullRequest["repository"],
	value: string,
) {
	return repository.id.toLowerCase() === value.toLowerCase();
}

function defaultSortDirection(
	sort: PullFilter["sort"],
): PullFilter["sortDirection"] {
	return sort === "updated" || sort === "progress" ? "desc" : "asc";
}
export function nextPullSort(
	filter: PullFilter,
	sort: PullFilter["sort"],
): Pick<PullFilter, "sort" | "sortDirection"> {
	return {
		sort,
		sortDirection:
			filter.sort === sort
				? filter.sortDirection === "asc"
					? "desc"
					: "asc"
				: defaultSortDirection(sort),
	};
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
