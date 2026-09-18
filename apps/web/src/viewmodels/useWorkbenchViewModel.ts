import {
	canonicalObservationKey,
	makeWatchRef,
	matchesRepositoryReference,
	type Observation,
	parseRepositoryReference,
	publicSource,
	type WatchRef,
} from "@signoff/domain/monitoring";
import type { PullQueryItem } from "@signoff/domain/query";
import {
	type CollectionJob,
	type Project,
	type ProjectWrite,
	projectWriteSchema,
	type ReadinessRule,
	type RefreshQueueKind,
	refreshCooldownSchema,
	type Workbench,
} from "@signoff/domain/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
	addWatches,
	discover,
	loadCatalog,
	loadCollector,
	loadPending,
	loadPull,
	loadPulls,
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
	writePullFilter,
} from "@/models/workbench";
import {
	createProject,
	deleteProject,
	patchProject,
	patchReadiness,
	patchRefreshSettings,
} from "@/models/workbenchApi";
import { useQueryBlock } from "./useQueryBlock";

const PAGE_SIZE = 20;
const emptyMetrics = {
	open: 0,
	attention: 0,
	running: 0,
	ready: 0,
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

type Selection = {
	key: string;
	pullId: string;
	observation: Pick<Observation, "id" | "generation" | "active"> | null;
};
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
export function useWorkbenchViewModel() {
	const [params, setParams] = useSearchParams();
	const location = useLocation();
	const [savedFilters, setSavedFilters] = useState(storedFilters);
	const filter = useMemo(
		() =>
			readPullFilter(
				[...Object.values(PULL_FILTER_PARAMS), "author"].some((key) =>
					params.has(key),
				)
					? params
					: new URLSearchParams(savedFilters),
				true,
			),
		[params, savedFilters],
	);
	useEffect(() => {
		const next = writePullFilter(filter).toString();
		if (next !== savedFilters) {
			setSavedFilters(next);
			try {
				localStorage.setItem(PULL_FILTER_STORAGE_KEY, next);
			} catch {
				/* URL and session state remain usable. */
			}
		}
	}, [filter, savedFilters]);
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
	const pulls = useQueryBlock(
		location.pathname === "/" ? query : null,
		(signal) => loadPulls(query, signal),
		15000,
	);
	const collector = useQueryBlock(
		`collector:${filter.source}`,
		(signal) => loadCollector(filter.source, signal),
		3000,
	);
	const selectedId = params.get("pr");
	const detail = useQueryBlock(
		selectedId ? `pr:${filter.source}:${selectedId}` : null,
		(signal) => loadPull(filter.source, selectedId ?? "", signal),
		15000,
	);
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
		: (pageRows.find((row) => row.pull.id === selectedId) ?? null);
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
							.sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null,
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
	const repositoryReference = useMemo(() => {
		if (!filter.repository.startsWith("https://")) return null;
		try {
			return parseRepositoryReference(filter.repository);
		} catch {
			return null;
		}
	}, [filter.repository]);
	const referenceRepositories = repositoryReference
		? repositories.filter(
				(r) =>
					r.project.provider === repositoryReference.provider &&
					r.project.organization.toLowerCase() ===
						repositoryReference.organization.toLowerCase() &&
					r.project.projectKey.toLowerCase() ===
						repositoryReference.projectKey.toLowerCase(),
			)
		: repositories;
	const repositoryIds = referenceRepositories
		.filter((r) => r.identityResolved)
		.map((r) => r.id);
	const selectedRepository =
		referenceRepositories.find((r) =>
			repositoryReference
				? r.identityResolved
					? matchesRepositoryReference(
							r,
							repositoryReference.repository,
							r.project.provider,
							repositoryIds,
						)
					: r.url === filter.repository
				: matchesRepository(r, filter.repository),
		) ?? null;
	const resolvedRepositoryId = selectedRepository?.id;
	useEffect(() => {
		if (
			filter.repository.startsWith("https://") &&
			resolvedRepositoryId &&
			!resolvedRepositoryId.startsWith("https://")
		)
			setParams(
				(previous) =>
					writePullFilter(
						{ ...filter, repository: resolvedRepositoryId },
						previous,
					),
				{ replace: true },
			);
	}, [filter, resolvedRepositoryId, setParams]);
	const total = pulls.data?.page.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const loading = location.pathname === "/" ? pulls.loading : catalog.loading;
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
		setParams(
			(previous) => {
				const next = writePullFilter(filter, previous);
				if (value === null) next.delete(key);
				else next.set(key, value);
				return next;
			},
			{ replace: key === "page" },
		);
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
		const next = { ...filter, ...patch };
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
		setParams(
			(previous) => {
				const result = writePullFilter(next, previous);
				result.delete("page");
				if (patch.source !== undefined) result.delete("pr");
				return result;
			},
			{ replace: true },
		);
	};
	const reload = useCallback(async () => {
		await Promise.allSettled([
			catalog.reload(),
			pulls.reload(),
			collector.reload(),
			detail.reload(),
			pending.reload(),
		]);
	}, [
		catalog.reload,
		pulls.reload,
		collector.reload,
		detail.reload,
		pending.reload,
	]);
	const [busy, setBusy] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<{
		source: PullFilter["source"];
		kind: "watch" | "other";
		error: string | null;
		notice: string | null;
	}>({ source: filter.source, kind: "other", error: null, notice: null });
	const mutationError =
		feedback.source === filter.source ? feedback.error : null;
	const notice = feedback.source === filter.source ? feedback.notice : null;
	const setMutationError = (error: string | null) =>
		setFeedback((previous) => ({
			source: filter.source,
			kind: previous.source === filter.source ? previous.kind : "other",
			error,
			notice: previous.source === filter.source ? previous.notice : null,
		}));
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
		mutationLock.current = true;
		setBusy(label);
		setFeedback({ source, kind: "other", error: null, notice: null });
		try {
			const result = await operation();
			if (mounted.current && sourceRef.current === source) {
				setFeedback((previous) => ({ ...previous, notice: result }));
				await reload();
			}
			return true;
		} catch (error) {
			if (mounted.current && sourceRef.current === source)
				setMutationError(message(error));
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
				setFeedback((previous) => ({
					source,
					kind: "watch",
					error:
						[
							...(previous.source === source &&
							previous.kind === "watch" &&
							previous.error
								? [previous.error]
								: []),
							...failures,
						].join(" ") || null,
					notice: `${succeeded.size} PR${succeeded.size === 1 ? "" : "s"} ${adding ? "added to" : "removed from"} the shared watch list.`,
				}));
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
				setFeedback({
					source,
					kind: "watch",
					error: message(error),
					notice: null,
				});
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
		catalogError: catalog.error,
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
		error: location.pathname === "/" ? pulls.error : catalog.error,
		mutationError,
		notice,
		feedbackKind: feedback.source === filter.source ? feedback.kind : "other",
		busy,
		collectionError: collector.error,
		detailLoading: Boolean(selectedId) && detail.loading,
		detailRefreshing: detail.refreshing,
		detailError: detail.error,
		reloadDetail: detail.reload,
		selected,
		missingSelection:
			Boolean(selectedId) &&
			!detail.loading &&
			!selected &&
			detail.errorCode === "CACHE_MISS",
		listCooldownSeconds: 0,
		detailCooldownSeconds: collector.data?.detailCooldownSeconds ?? 300,
		setRefreshCooldown: async (kind: RefreshQueueKind, value: number) =>
			kind === "details" && refreshCooldownSchema.safeParse(value).success
				? mutate("refresh-settings", async () => {
						await patchRefreshSettings({
							detailCooldownSeconds: refreshCooldownSchema.parse(value),
						});
						return "Watch refresh cooldown saved.";
					})
				: false,
		reload,
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		setPage: (value: number) => setParam("page", String(value)),
		selectPull: (id: string | null) => setParam("pr", id),
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
		saveReadiness: (project: Project, rules: ReadinessRule[]) =>
			mutate("readiness", async () => {
				await patchReadiness(project.id, project.readinessRevision ?? 1, rules);
				return "Readiness order and colors saved.";
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
							repositoryUrl: selectedRepository.url,
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
