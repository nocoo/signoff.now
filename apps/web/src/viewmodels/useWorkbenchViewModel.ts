import {
	canonicalObservationKey,
	makeWatchRef,
	type Observation,
	publicSource,
	type WatchRef,
} from "@signoff/domain/monitoring";
import type { PullQueryItem, RepositoryQueryItem } from "@signoff/domain/query";
import {
	type CollectionJob,
	type Project,
	type ProjectWrite,
	projectWriteSchema,
	type RefreshQueueKind,
	refreshCooldownSchema,
	repositoryUrl,
	type Workbench,
} from "@signoff/domain/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import {
	addWatches,
	discover,
	loadCatalog,
	loadCollector,
	loadPending,
	loadPull,
	loadPulls,
	lookupPull,
	pullQueryParams,
	queryProject,
	queryRow,
	refreshWatches,
	removeWatches,
	seconds,
} from "@/models/monitoringApi";
import {
	matchesRepository,
	PULL_FILTER_PARAMS,
	PULL_FILTER_STORAGE_KEY,
	type PullFilter,
	type PullRow,
	readPullFilter,
	updatePullFilter,
	writePullFilter,
} from "@/models/workbench";
import {
	createProject,
	deleteProject,
	patchProject,
	patchRefreshSettings,
} from "@/models/workbenchApi";
import {
	parseWorkspaceLocation,
	pullHref,
	type WorkspaceLocation,
	withQuery,
} from "@/models/workspaceLocation";
import { useQueryBlock } from "./useQueryBlock";

const PAGE_SIZE = 20;
const emptyMetrics = {
	open: 0,
	attention: 0,
	running: 0,
	conflict: 0,
	skipped: 0,
	warning: 0,
	ready: 0,
	waiting: 0,
	unknown: 0,
	error: 0,
	draft: 0,
	merged: 0,
	closed: 0,
};
const message = (error: unknown) =>
	error instanceof Error ? error.message : "Request failed";
function storedFilters() {
	try {
		return localStorage.getItem(PULL_FILTER_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

function uniqueRepository(
	data: Awaited<ReturnType<typeof loadCatalog>> | null,
	error: string | null,
) {
	return !error && data?.page.total === 1 && data.data.length === 1
		? data.data[0]
		: null;
}

function matchesResolvedRepository(
	repository: { id: string; identityResolved: boolean; project: Project },
	resolved: RepositoryQueryItem | null | undefined,
) {
	if (!resolved) return false;
	const project = repository.project;
	return (
		publicSource(project.source) === resolved.project.source &&
		project.id === resolved.project.id &&
		project.provider === resolved.project.provider &&
		project.organization.toLowerCase() ===
			resolved.project.organization.toLowerCase() &&
		project.projectKey.toLowerCase() ===
			resolved.project.projectKey.toLowerCase() &&
		repository.identityResolved === resolved.identityResolved &&
		repository.id.toLowerCase() ===
			(resolved.repository.id ?? resolved.repository.url).toLowerCase()
	);
}

type Selection = {
	key: string;
	pullId: string;
	observation: Pick<Observation, "id" | "generation" | "active"> | null;
};
type MutationFeedback = {
	source: PullFilter["source"];
	kind: "watch" | "refresh-settings" | "other";
	error: string | null;
	notice: string | null;
};
function feedbackForSource(
	feedback: MutationFeedback,
	source: PullFilter["source"],
) {
	return feedback.kind === "refresh-settings" || feedback.source === source
		? feedback
		: null;
}
const watchKey = (
	source: PullFilter["source"],
	pullId: string,
	ref: WatchRef,
) =>
	JSON.stringify([pullId, ref.projectId, canonicalObservationKey(source, ref)]);
const rowWatchKey = (source: PullFilter["source"], row: PullRow) =>
	watchKey(
		source,
		row.pull.id,
		makeWatchRef(row.project, row.pull.repository, row.pull.number),
	);
const pendingWatchKey = (
	source: PullFilter["source"],
	observation: { id: string; generation: number },
) => `${source}:observation:${observation.id}:${observation.generation}`;

function usePullDetail(
	source: PullFilter["source"],
	route: WorkspaceLocation | null,
) {
	const location = useLocation();
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const isPullsPage = route?.section === "prs";
	// Keep the resolved identity/query when a legacy URL is replaced, without a second load.
	const identity = useRef<{
		source: PullFilter["source"];
		pathname: string;
		id: string;
		key: string;
	} | null>(null);
	const remembered =
		identity.current?.source === source &&
		identity.current.pathname === location.pathname
			? identity.current
			: null;
	const legacyId =
		isPullsPage && route.valid && !route.project ? params.get("pr") : null;
	const selectedId = isPullsPage ? (legacyId ?? remembered?.id ?? null) : null;
	const pullReference =
		route?.valid &&
		isPullsPage &&
		route.project &&
		route.repository &&
		route.number
			? {
					repositoryUrl: repositoryUrl(route.project, route.repository),
					number: route.number,
				}
			: null;
	const hasSelection = Boolean(selectedId || pullReference);
	const key = hasSelection
		? legacyId
			? `pr:${source}:${legacyId}`
			: (remembered?.key ?? `pr:${source}:${JSON.stringify(pullReference)}`)
		: null;
	const query = useQueryBlock(
		key,
		async (signal) => {
			if (selectedId) return loadPull(source, selectedId, signal);
			if (!pullReference) throw new Error("Invalid PR address");
			return lookupPull(source, pullReference, signal);
		},
		15000,
	);
	if (query.data && key) {
		const pull = query.data.data;
		const href = pullHref(queryProject(pull.project), pull);
		identity.current = {
			source,
			id: pull.id,
			key,
			pathname: href.split("?")[0] ?? href,
		};
	}
	useEffect(() => {
		if (!isPullsPage || !query.data) return;
		const pull = query.data.data;
		const href = pullHref(queryProject(pull.project), pull, params);
		if (href !== `${location.pathname}${location.search}`)
			navigate(href, { replace: true });
	}, [
		isPullsPage,
		query.data,
		params,
		location.pathname,
		location.search,
		navigate,
	]);
	return {
		...query,
		error: isPullsPage && !route.valid ? "Invalid PR address" : query.error,
		selectedId,
		pullReference,
		hasSelection,
		remember: (id: string, href: string) => {
			identity.current = {
				source,
				id,
				pathname: href.split("?")[0] ?? href,
				key: `pr:${source}:${id}`,
			};
		},
	};
}

function usePullFilters(route: WorkspaceLocation | null) {
	const [params] = useSearchParams();
	const location = useLocation();
	const navigate = useNavigate();
	const isPullsPage = route?.section === "prs";
	const isPullsList =
		isPullsPage && route.valid && !route.project && !params.has("pr");
	const [savedFilters, setSavedFilters] = useState(storedFilters);
	const savedFilter = useMemo(
		() => readPullFilter(new URLSearchParams(savedFilters), true),
		[savedFilters],
	);
	const hasFilterParams = [...Object.values(PULL_FILTER_PARAMS), "author"].some(
		(key) => params.has(key),
	);
	const filter = useMemo(
		() =>
			hasFilterParams || route?.project || (isPullsPage && !isPullsList)
				? readPullFilter(params, true)
				: savedFilter,
		[
			params,
			savedFilter,
			hasFilterParams,
			route?.project,
			isPullsPage,
			isPullsList,
		],
	);
	const listFilter = isPullsList ? filter : savedFilter;
	useEffect(() => {
		// Give restored preferences an explicit history entry so Back uses that
		// entry's filters, rather than the latest localStorage preferences.
		if (location.pathname === "/" || (isPullsList && !hasFilterParams))
			navigate(withQuery("/prs", writePullFilter(filter, params)), {
				replace: true,
			});
	}, [
		location.pathname,
		isPullsList,
		hasFilterParams,
		filter,
		params,
		navigate,
	]);
	const saveFilters = useCallback(
		(value: PullFilter) => {
			const next = writePullFilter(value).toString();
			if (next === savedFilters) return;
			setSavedFilters(next);
			try {
				localStorage.setItem(PULL_FILTER_STORAGE_KEY, next);
			} catch {
				/* URL and session state remain usable. */
			}
		},
		[savedFilters],
	);
	useEffect(() => {
		if (isPullsList) saveFilters(filter);
	}, [isPullsList, filter, saveFilters]);
	return { filter, listFilter, saveFilters, isPullsList };
}

export function useWorkbenchViewModel() {
	const [params, setParams] = useSearchParams();
	const location = useLocation();
	const navigate = useNavigate();
	const route = useMemo(
		() => parseWorkspaceLocation(location.pathname),
		[location.pathname],
	);
	const isPullsPage = route?.section === "prs";
	const { filter, listFilter, saveFilters, isPullsList } =
		usePullFilters(route);
	const requestedPage = Number(params.get("page") ?? 1);
	const page =
		Number.isSafeInteger(requestedPage) && requestedPage > 0
			? requestedPage
			: 1;
	const query = pullQueryParams(filter, page);
	const catalog = useQueryBlock(
		`repos:${filter.source}`,
		(signal) => loadCatalog(filter.source, signal),
		30000,
	);
	const repositoryReference = filter.repository.startsWith("https://")
		? filter.repository
		: null;
	const repositoryResolution = useQueryBlock(
		repositoryReference
			? `repo-reference:${JSON.stringify([filter.source, filter.projectId, repositoryReference])}`
			: null,
		(signal) =>
			loadCatalog(filter.source, signal, {
				repository: filter.repository,
				projectId: filter.projectId,
			}),
		30000,
	);
	const pulls = useQueryBlock(
		isPullsPage ? query : null,
		(signal) => loadPulls(query, signal),
		15000,
	);
	const collector = useQueryBlock(
		`collector:${filter.source}`,
		(signal) => loadCollector(filter.source, signal),
		3000,
	);
	const detail = usePullDetail(filter.source, route);
	const { selectedId, pullReference, hasSelection } = detail;
	const pendingScope = JSON.stringify([
		filter.source,
		filter.organization,
		filter.projectId,
		filter.repository,
		filter.watching,
	]);
	const [pendingPagination, setPendingPagination] = useState({
		key: pendingScope,
		page: 1,
	});
	const pendingPage =
		pendingPagination.key === pendingScope ? pendingPagination.page : 1;
	useEffect(() => {
		setPendingPagination((previous) =>
			previous.key === pendingScope ? previous : { key: pendingScope, page: 1 },
		);
	}, [pendingScope]);
	const pending = useQueryBlock(
		filter.watching === "watching"
			? `pending:${pendingScope}:${pendingPage}`
			: null,
		(signal) => loadPending(filter.source, signal, filter, pendingPage),
		15000,
	);
	const publishedRevision = collector.data?.dataRevision;
	const reloadPulls = pulls.revalidate;
	const reloadDetail = detail.revalidate;
	const reloadPending = pending.revalidate;
	const reloadCatalog = catalog.revalidate;
	const reloadRepositoryResolution = repositoryResolution.revalidate;
	useEffect(() => {
		// Scope the revision by source, even when Live and Sample have equal
		// counters. Reloads coalesce behind in-flight reads and retain visible data.
		if (
			!publishedRevision ||
			collector.data?.source !== publicSource(filter.source)
		)
			return;
		void Promise.allSettled([
			reloadPulls(),
			reloadDetail(),
			reloadPending(),
			reloadCatalog(),
			reloadRepositoryResolution(),
		]);
	}, [
		publishedRevision,
		collector.data?.source,
		filter.source,
		reloadPulls,
		reloadDetail,
		reloadPending,
		reloadCatalog,
		reloadRepositoryResolution,
	]);
	const pendingPageCount = Math.max(
		1,
		Math.ceil((pending.data?.page.total ?? 0) / PAGE_SIZE),
	);
	useEffect(() => {
		if (pending.data && !pending.loading && pendingPage > pendingPageCount)
			setPendingPagination({ key: pendingScope, page: pendingPageCount });
	}, [
		pending.data,
		pending.loading,
		pendingPage,
		pendingPageCount,
		pendingScope,
	]);
	const watchRequests = useRef(new Map<string, boolean>());
	const [optimisticWatches, setOptimisticWatches] = useState(
		new Map<string, boolean>(),
	);
	const withWatchState = useCallback(
		(row: PullRow): PullRow => {
			const optimistic = optimisticWatches.get(rowWatchKey(filter.source, row));
			return {
				...row,
				watching: optimistic ?? Boolean(row.observation?.active),
				watchPending: optimistic !== undefined,
			};
		},
		[filter.source, optimisticWatches],
	);
	const pageRows = useMemo(
		() => pulls.data?.data.map((pull) => withWatchState(queryRow(pull))) ?? [],
		[pulls.data, withWatchState],
	);
	const selected = detail.data
		? withWatchState(queryRow(detail.data.data))
		: (pageRows.find(
				(row) =>
					row.pull.id === selectedId ||
					(Boolean(pullReference) &&
						pullHref(row.project, row.pull).split("?")[0] ===
							location.pathname),
			) ?? null);
	const pendingObservations = (pending.data?.data ?? []).filter(
		(item) => !optimisticWatches.has(pendingWatchKey(filter.source, item)),
	);
	const pendingRemoved =
		(pending.data?.data.length ?? 0) - pendingObservations.length;
	const jobs: CollectionJob[] = useMemo(
		() =>
			collector.data?.jobs.map((job) => ({
				id: job.id,
				projectId: job.projectId,
				revision: job.projectRevision,
				state: job.state === "succeeded" ? "complete" : job.state,
				kind: job.kind === "discover" ? "list" : "details",
				requestedAt: seconds(job.requestedAt),
				startedAt: seconds(job.startedAt),
				updatedAt: seconds(job.updatedAt),
				completedAt: seconds(job.completedAt),
				completedPulls: job.progress.completed,
				totalPulls: job.progress.total,
				message: job.message,
			})) ?? [],
		[collector.data],
	);
	const projects = useMemo(
		() =>
			(catalog.data?.projects ?? []).map((publicProject) => {
				const project = queryProject(publicProject);
				const repositories = (catalog.data?.data ?? [])
					.filter((r) => r.project.id === project.id)
					.map((r) => ({
						key: r.key,
						id: r.repository.id ?? r.repository.url,
						identityResolved: r.identityResolved,
						name: r.repository.name,
						project,
						metrics: { ...emptyMetrics, ...r.counts },
						total:
							r.counts.open +
							r.counts.draft +
							r.counts.merged +
							r.counts.closed,
						url: r.repository.url,
						coverage: r.coverage,
						lastDiscoveredAt: r.lastDiscoveredAt,
					}));
				const metrics = repositories.reduce(
					(acc, repo) => {
						for (const key of Object.keys(acc) as (keyof typeof acc)[])
							acc[key] += repo.metrics[key];
						return acc;
					},
					{ ...emptyMetrics },
				);
				return {
					project,
					repositories,
					metrics,
					total: repositories.reduce((n, r) => n + r.total, 0),
					job:
						jobs
							.filter((j) => j.projectId === project.id)
							.sort((a, b) => b.requestedAt - a.requestedAt)
							.shift() ?? null,
					scans: [],
				};
			}),
		[catalog.data, jobs],
	);
	const organizations = [
		...new Set(
			projects.map(({ project }) => project.organization.toLowerCase()),
		),
	].sort();
	const projectOptions = projects.filter(
		({ project }) =>
			!filter.organization ||
			project.organization.toLowerCase() === filter.organization,
	);
	const repositories = projectOptions
		.filter(
			({ project }) => !filter.projectId || project.id === filter.projectId,
		)
		.flatMap((p) => p.repositories);
	// The cache service resolves retained aliases, including identities no
	// longer present in the visible catalog. Never guess from current names.
	const resolvedRepository = uniqueRepository(
		repositoryResolution.data,
		repositoryResolution.error,
	);
	const selectedRepository =
		repositories.find((r) =>
			repositoryReference
				? matchesResolvedRepository(r, resolvedRepository)
				: matchesRepository(r, filter.repository),
		) ?? null;
	useEffect(() => {
		if (
			repositoryReference &&
			resolvedRepository?.identityResolved &&
			selectedRepository?.identityResolved
		)
			setParams(
				(previous) =>
					writePullFilter(
						{
							...filter,
							organization:
								selectedRepository.project.organization.toLowerCase(),
							projectId: selectedRepository.project.id,
							repository: selectedRepository.id,
						},
						previous,
					),
				{ replace: true },
			);
	}, [
		filter,
		repositoryReference,
		resolvedRepository,
		selectedRepository,
		setParams,
	]);
	const total = pulls.data?.page.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const loading = isPullsPage ? pulls.loading : catalog.loading;
	const data: Workbench | null =
		catalog.data || pulls.data
			? {
					projects: catalog.data?.projects.map(queryProject) ?? [
						...new Map(pageRows.map((r) => [r.project.id, r.project])).values(),
					],
					pullRequests: pageRows.map((r) => r.pull),
					collectionJobs: jobs,
					scans: jobs
						.filter((j) => ["complete", "partial", "failed"].includes(j.state))
						.map((j) => ({
							id: j.id,
							projectId: j.projectId,
							source: filter.source,
							state: j.state as "complete" | "partial" | "failed",
							startedAt: j.startedAt ?? j.requestedAt,
							completedAt: j.completedAt ?? j.updatedAt,
							pullRequestCount: j.completedPulls,
							advancedStages: 0,
							message: j.message,
						})),
					demoMode: collector.data?.sampleCommandsEnabled ?? false,
					fetchedAt:
						seconds(pulls.data?.generatedAt ?? catalog.data?.generatedAt) ??
						Date.now() / 1000,
					truncated: false,
				}
			: null;
	const setParam = (key: string, value: string | null) =>
		setParams((previous) => {
			const next = writePullFilter(filter, previous);
			if (value === null || (key === "page" && value === "1")) next.delete(key);
			else next.set(key, value);
			return next;
		});
	useEffect(() => {
		if (pulls.data && !pulls.loading && page > pageCount)
			setParams(
				(previous) => {
					const next = new URLSearchParams(previous);
					next.set("page", String(pageCount));
					return next;
				},
				{ replace: true },
			);
	}, [pulls.data, pulls.loading, page, pageCount, setParams]);
	const setFilter = (patch: Partial<PullFilter>) => {
		const next = updatePullFilter(
			patch.source !== undefined ? listFilter : filter,
			patch,
		);
		if (patch.source !== undefined) {
			next.organization = patch.organization ?? "";
			next.projectId = patch.projectId ?? "";
			next.repository = patch.repository ?? "";
			next.authors = patch.authors ?? [];
		} else if (patch.organization !== undefined) {
			next.projectId = patch.projectId ?? "";
			next.repository = patch.repository ?? "";
		} else if (patch.projectId !== undefined)
			next.repository = patch.repository ?? "";
		if (patch.projectId)
			next.organization =
				projects
					.find((p) => p.project.id === patch.projectId)
					?.project.organization.toLowerCase() ?? next.organization;
		if (patch.source !== undefined && !isPullsList) saveFilters(next);
		if (
			patch.source !== undefined &&
			(route?.section === "sm" || pullReference)
		) {
			navigate(
				withQuery(
					route?.section === "sm" ? "/sm" : "/prs",
					writePullFilter(next),
				),
			);
			return;
		}
		setParams(
			(previous) => {
				const result = writePullFilter(next, previous);
				result.delete("page");
				if (patch.source !== undefined) result.delete("pr");
				if (
					patch.source !== undefined ||
					patch.organization !== undefined ||
					patch.projectId !== undefined ||
					patch.repository !== undefined
				)
					result.delete("trace");
				return result;
			},
			{ replace: patch.query !== undefined },
		);
	};
	const reload = useCallback(async () => {
		await Promise.allSettled([
			catalog.reload(),
			repositoryResolution.reload(),
			pulls.reload(),
			collector.reload(),
			detail.reload(),
			pending.reload(),
		]);
	}, [
		catalog.reload,
		repositoryResolution.reload,
		pulls.reload,
		collector.reload,
		detail.reload,
		pending.reload,
	]);
	const [busy, setBusy] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<MutationFeedback>({
		source: filter.source,
		kind: "other",
		error: null,
		notice: null,
	});
	const visibleFeedback = feedbackForSource(feedback, filter.source);
	const mutationError = visibleFeedback?.error ?? null;
	const notice = visibleFeedback?.notice ?? null;
	const setMutationError = (error: string | null) =>
		setFeedback((previous) =>
			feedbackForSource(previous, filter.source)
				? { ...previous, error }
				: { source: filter.source, kind: "other", error, notice: null },
		);
	const sourceRef = useRef(filter.source);
	sourceRef.current = filter.source;
	const mutationLock = useRef(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const mutate = async (label: string, operation: () => Promise<string>) => {
		if (mutationLock.current) return false;
		const source = filter.source;
		const kind = label === "refresh-settings" ? "refresh-settings" : "other";
		mutationLock.current = true;
		setBusy(label);
		setFeedback({ source, kind, error: null, notice: null });
		try {
			const result = await operation();
			if (
				mounted.current &&
				(kind === "refresh-settings" || sourceRef.current === source)
			) {
				setFeedback({ source, kind, error: null, notice: result });
				await reload();
			}
			return true;
		} catch (error) {
			if (
				mounted.current &&
				(kind === "refresh-settings" || sourceRef.current === source)
			)
				setFeedback({ source, kind, error: message(error), notice: null });
			return false;
		} finally {
			mutationLock.current = false;
			if (mounted.current) setBusy(null);
		}
	};
	const selectionKey = query;
	const [selection, setSelection] = useState<{
		key: string;
		items: Selection[];
	}>({ key: "", items: [] });
	useEffect(() => {
		setSelection((previous) =>
			previous.key === selectionKey
				? previous
				: { key: selectionKey, items: [] },
		);
	}, [selectionKey]);
	const selectionItems =
		selection.key === selectionKey
			? selection.items.filter((item) =>
					pageRows.some((row) => rowWatchKey(filter.source, row) === item.key),
				)
			: [];
	const selectedIds = new Set(selectionItems.map((item) => item.pullId));
	const selectableRows = pageRows.filter(
		(row) => row.pull.state === "open" || row.observation?.active,
	);
	const toggleSelection = (id: string, checked: boolean) => {
		const row = selectableRows.find((r) => r.pull.id === id);
		if (!row) return;
		setSelection((previous) => ({
			key: selectionKey,
			items: [
				...(previous.key === selectionKey ? previous.items : []).filter(
					(item) => item.pullId !== id,
				),
				...(checked
					? [
							{
								key: rowWatchKey(filter.source, row),
								pullId: id,
								observation: row.observation ?? null,
							},
						]
					: []),
			],
		}));
	};
	const changeWatches = async (adding: boolean, items: Selection[]) => {
		if (mutationLock.current) return false;
		const source = filter.source;
		const applicable = items.filter(
			(item) =>
				!watchRequests.current.has(item.key) &&
				(adding ? !item.observation?.active : item.observation?.active),
		);
		if (!applicable.length)
			return !items.some((item) => watchRequests.current.has(item.key));
		for (const item of applicable) watchRequests.current.set(item.key, adding);
		setOptimisticWatches(new Map(watchRequests.current));
		setFeedback({ source, kind: "watch", error: null, notice: null });
		try {
			const result = adding
				? await addWatches(
						source,
						applicable.map((item) => item.pullId),
					)
				: await removeWatches(
						source,
						applicable.flatMap((item) =>
							item.observation ? [item.observation] : [],
						),
					);
			const succeeded = new Set<string>();
			const observations = new Map<string, PullQueryItem["observation"]>();
			const failures: string[] = [];
			const accepted = adding
				? ["added", "already_observed"]
				: ["removed", "already_stopped"];
			for (const [index, item] of applicable.entries()) {
				const receipt = result.results[index];
				if (
					receipt?.observation?.source === publicSource(source) &&
					watchKey(source, item.pullId, receipt.observation.ref) === item.key
				)
					observations.set(item.key, receipt.observation);
				if (receipt && accepted.includes(receipt.status))
					succeeded.add(item.key);
				else
					failures.push(
						`${item.pullId}: ${receipt ? (receipt.error?.message ?? "Watch generation changed; reload before trying again.") : "Missing command result; reload before trying again."}`,
					);
			}
			if (mounted.current && sourceRef.current === source) {
				const apply = (pull: PullQueryItem): PullQueryItem => {
					const next = observations.get(rowWatchKey(source, queryRow(pull)));
					const current = pull.observation;
					// A cache read may already contain a later CLI edit or retirement.
					if (
						!next ||
						(current?.id === next.id &&
							(current.generation > next.generation ||
								(current.generation === next.generation &&
									!current.active &&
									next.active)))
					)
						return pull;
					return { ...pull, observation: next };
				};
				pulls.update((cache) =>
					cache.source === publicSource(source)
						? { ...cache, data: cache.data.map(apply) }
						: cache,
				);
				detail.update((cache) =>
					cache.source === publicSource(source)
						? { ...cache, data: apply(cache.data) }
						: cache,
				);
				if (!adding) {
					const removed = new Set(
						applicable.flatMap((item) =>
							succeeded.has(item.key) && item.observation
								? [`${item.observation.id}:${item.observation.generation}`]
								: [],
						),
					);
					pending.update((cache) => {
						if (cache.source !== publicSource(source)) return cache;
						const pendingItems = cache.data.filter(
							(item) => !removed.has(`${item.id}:${item.generation}`),
						);
						return {
							...cache,
							data: pendingItems,
							page: {
								...cache.page,
								total:
									cache.page.total - (cache.data.length - pendingItems.length),
							},
						};
					});
				}
				setSelection((previous) =>
					previous.key === selectionKey
						? {
								...previous,
								items: previous.items.filter(
									(item) => !succeeded.has(item.key),
								),
							}
						: previous,
				);
				setFeedback((previous) =>
					previous.kind !== "watch" || previous.source !== source
						? previous
						: {
								source,
								kind: "watch",
								error:
									[
										...(previous.error ? [previous.error] : []),
										...failures,
									].join(" ") || null,
								notice: `${succeeded.size} PR${succeeded.size === 1 ? "" : "s"} ${adding ? "added to" : "removed from"} the shared watch list.`,
							},
				);
				// Reconcile only affected blocks in the background; never hold the
				// row lock or replace the table while a cache read is in progress.
				void Promise.allSettled([
					pulls.reload(),
					detail.reload(),
					collector.reload(),
					pending.reload(),
				]);
			}
			return true;
		} catch (error) {
			if (mounted.current && sourceRef.current === source)
				setFeedback((previous) =>
					previous.kind !== "watch" || previous.source !== source
						? previous
						: {
								source,
								kind: "watch",
								error: message(error),
								notice: null,
							},
				);
			return false;
		} finally {
			for (const item of applicable) watchRequests.current.delete(item.key);
			if (mounted.current) setOptimisticWatches(new Map(watchRequests.current));
		}
	};
	const canScan = (project: Project) =>
		(project.source === "demo"
			? collector.data?.sampleCommandsEnabled === true
			: project.provider === "ado") &&
		!jobs.some(
			(job) =>
				job.projectId === project.id &&
				job.kind === "list" &&
				["queued", "running", "auth_required"].includes(job.state),
		);
	return {
		data,
		projects,
		organizations,
		projectOptions,
		repositories,
		selectedRepository,
		filter,
		setFilter,
		connection: collector.data?.connection ?? {
			state: "offline" as const,
			message: collector.error ?? "Start signoff daemon to collect watched PRs",
		},
		collector: collector.data,
		catalogError: catalog.error ?? repositoryResolution.error,
		coverage: pulls.data?.coverage ?? catalog.data?.coverage,
		rows: pageRows,
		visible: pageRows,
		pageRows,
		total,
		metrics: pulls.data?.metrics ?? emptyMetrics,
		authors: pulls.data?.authors ?? [],
		loading,
		pullsLoaded: pulls.data !== null,
		refreshing: pulls.refreshing || catalog.refreshing,
		error:
			(isPullsPage ? pulls.error : catalog.error) ?? repositoryResolution.error,
		mutationError,
		notice,
		feedbackKind: visibleFeedback?.kind ?? "other",
		busy,
		collectionError: collector.error,
		detailLoading: hasSelection && detail.loading,
		detailRefreshing: detail.refreshing,
		detailError: detail.error,
		reloadDetail: detail.reload,
		selected,
		missingSelection:
			hasSelection &&
			!detail.loading &&
			!selected &&
			detail.errorCode === "CACHE_MISS",
		listCooldownSeconds: collector.data?.listCooldownSeconds ?? 600,
		detailCooldownSeconds: collector.data?.detailCooldownSeconds ?? 300,
		setRefreshCooldown: async (kind: RefreshQueueKind, value: number) =>
			refreshCooldownSchema.safeParse(value).success
				? mutate("refresh-settings", async () => {
						await patchRefreshSettings({
							[kind === "list"
								? "listCooldownSeconds"
								: "detailCooldownSeconds"]: refreshCooldownSchema.parse(value),
						});
						await collector.reload();
						return "Collector cooldown saved.";
					})
				: false,
		reload,
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		pullsHref: withQuery("/prs", writePullFilter(listFilter)),
		setPage: (value: number) => setParam("page", String(value)),
		selectPull: (id: string | null) => {
			const next = writePullFilter(filter, params);
			next.delete("pr");
			if (!id) {
				navigate(withQuery("/prs", next));
				return;
			}
			const row =
				pageRows.find((item) => item.pull.id === id) ??
				(selected?.pull.id === id ? selected : null);
			if (row) {
				const href = pullHref(row.project, row.pull, next);
				detail.remember(id, href);
				navigate(href);
			} else {
				next.set("pr", id);
				navigate(withQuery("/prs", next));
			}
		},
		selectRepository: (key: string) => {
			const repo = repositories.find((r) => r.key === key);
			setFilter(
				repo
					? {
							organization: repo.project.organization.toLowerCase(),
							projectId: repo.project.id,
							repository: repo.id,
						}
					: { repository: "" },
			);
		},
		clearMutationError: () => setMutationError(null),
		selectedIds,
		selectedCount: selectionItems.length,
		selectionItems,
		watchPending: (pullId: string) =>
			pageRows.some((row) => row.pull.id === pullId && row.watchPending),
		selectableCount: selectableRows.length,
		toggleSelection,
		selectPage: (checked: boolean) =>
			setSelection({
				key: selectionKey,
				items: checked
					? selectableRows.map((row) => ({
							key: rowWatchKey(filter.source, row),
							pullId: row.pull.id,
							observation: row.observation ?? null,
						}))
					: [],
			}),
		watchSelected: (adding: boolean) => changeWatches(adding, selectionItems),
		toggleWatch: (pullId?: string) => {
			const row = pullId
				? pageRows.find((item) => item.pull.id === pullId)
				: selected;
			return row && (row.pull.state === "open" || row.observation?.active)
				? changeWatches(!row.observation?.active, [
						{
							key: rowWatchKey(filter.source, row),
							pullId: row.pull.id,
							observation: row.observation ?? null,
						},
					])
				: Promise.resolve(false);
		},
		pendingObservations,
		pendingTotal: (pending.data?.page.total ?? 0) - pendingRemoved,
		pendingError: pending.error,
		pendingLoading: pending.loading,
		pendingLoaded: pending.data !== null,
		pendingRefreshing: pending.refreshing,
		reloadPending: pending.reload,
		pendingPage,
		pendingPageCount,
		setPendingPage: (value: number) =>
			setPendingPagination({ key: pendingScope, page: Math.max(1, value) }),
		removePending: (observation: { id: string; generation: number }) =>
			changeWatches(false, [
				{
					key: pendingWatchKey(filter.source, observation),
					pullId: `observation:${observation.id}:${observation.generation}`,
					observation: { ...observation, active: true },
				},
			]),
		refreshPull: (id?: string) =>
			mutate("checks", async () => {
				const result = await refreshWatches(filter.source, id);
				return result.jobs.length
					? `Queued ${result.jobs.length} watched PR checks.`
					: "The watch list is empty.";
			}),
		save: (draft: ProjectWrite, project: Project | null) =>
			mutate("save", async () => {
				if (project)
					await patchProject(project.id, {
						...draft,
						revision: project.revision,
					});
				else await createProject(draft);
				return project
					? "Project updated."
					: "Project added. Discover its PRs to choose which to watch.";
			}),
		remove: (project: Project) =>
			mutate("delete", async () => {
				await deleteProject(project.id, project.revision);
				return `${project.name} removed.`;
			}),
		canScan,
		scan: (projectId?: string) =>
			mutate(projectId ?? "scan-all", async () => {
				const targets = projectId
					? projects.filter((p) => p.project.id === projectId)
					: projects.filter((p) => canScan(p.project));
				const results = await Promise.allSettled(
					targets.map((p) =>
						discover(filter.source, { projectId: p.project.id }),
					),
				);
				const errors = results.flatMap((r) =>
					r.status === "rejected" ? [message(r.reason)] : [],
				);
				if (errors.length) throw new Error(errors.join(" "));
				return `Queued discovery for ${targets.length} project${targets.length === 1 ? "" : "s"}. Select PRs to watch after discovery completes.`;
			}),
		discoverRepo: () =>
			selectedRepository
				? mutate("discover", async () => {
						await discover(filter.source, {
							repositoryUrl:
								selectedRepository.identityResolved &&
								selectedRepository.project.provider === "ado"
									? repositoryUrl(
											selectedRepository.project,
											selectedRepository.id,
										)
									: selectedRepository.url,
						});
						return "Repository discovery queued. Existing watches are unchanged.";
					})
				: Promise.resolve(false),
	};
}
export type WorkbenchViewModel = ReturnType<typeof useWorkbenchViewModel>;
export function useProjectFormViewModel(
	project: Project | null,
	onSave: (draft: ProjectWrite) => Promise<boolean>,
) {
	const [draft, setDraft] = useState<ProjectWrite>(() => ({
		provider: "ado",
		name: project?.name ?? "",
		organization: project?.organization ?? "",
		projectKey: project?.projectKey ?? "",
		repositories: project?.repositories ?? [],
		description: project?.description ?? "",
		owner: project?.owner ?? "",
		enabled: project?.enabled ?? true,
	}));
	const [repositoryText, setRepositoryText] = useState(
		(project?.repositories ?? []).join(", "),
	);
	const [errors, setErrors] = useState<
		Partial<Record<keyof ProjectWrite, string>>
	>({});
	return {
		draft,
		errors,
		repositoryText,
		setRepositoryText: (value: string) => {
			setRepositoryText(value);
			setErrors((previous) => ({ ...previous, repositories: undefined }));
		},
		setField: <K extends keyof ProjectWrite>(
			key: K,
			value: ProjectWrite[K],
		) => {
			if (key === "repositories")
				setRepositoryText((value as string[] | undefined)?.join(", ") ?? "");
			setDraft((previous) => ({ ...previous, [key]: value }));
			setErrors((previous) => ({ ...previous, [key]: undefined }));
		},
		submit: async () => {
			const parsed = projectWriteSchema.safeParse({
				...draft,
				repositories: repositoryText
					.split(",")
					.map((name) => name.trim())
					.filter(Boolean),
			});
			if (!parsed.success) {
				setErrors(
					Object.fromEntries(
						parsed.error.issues.map((issue) => [issue.path[0], issue.message]),
					),
				);
				return false;
			}
			setErrors({});
			return onSave(parsed.data);
		},
	};
}
