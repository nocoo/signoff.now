import { refreshSettingsSchema } from "@signoff/domain/collection";
import {
	type Project,
	type ProjectWrite,
	projectWriteSchema,
	type ReadinessRule,
	type RefreshQueueKind,
	refreshCooldownSchema,
	type Workbench,
} from "@signoff/domain/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
	authorOptions,
	canScanProject,
	collectorConnection,
	matchesRepository,
	PULL_FILTER_PARAMS,
	PULL_FILTER_STORAGE_KEY,
	type PullFilter,
	projectSummaries,
	pullAuthorId,
	pullMetrics,
	pullRows,
	REFRESH_SETTINGS_STORAGE_KEY,
	readPullFilter,
	scopePulls,
	visiblePulls,
	writePullFilter,
} from "@/models/workbench";
import {
	createProject,
	deleteProject,
	loadWorkbench,
	patchProject,
	patchReadiness,
	patchRefreshSettings,
	scanProject,
	updateCollectionView,
} from "@/models/workbenchApi";

import type { CollectionPage } from "./usePageCollection";

const PAGE_SIZE = 20;
const message = (error: unknown) =>
	error instanceof Error ? error.message : "Request failed";

function storedFilters(): string {
	try {
		return localStorage.getItem(PULL_FILTER_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

function storedRefreshSettings() {
	const defaults = { listCooldownSeconds: 120, detailCooldownSeconds: 300 };
	try {
		const parsed = refreshSettingsSchema.safeParse(
			JSON.parse(localStorage.getItem(REFRESH_SETTINGS_STORAGE_KEY) ?? "{}"),
		);
		return parsed.success ? { ...defaults, ...parsed.data } : defaults;
	} catch {
		return defaults;
	}
}

export function useWorkbenchViewModel() {
	const [data, setData] = useState<Workbench | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [cachedRefresh] = useState(storedRefreshSettings);
	const listCooldownSeconds =
		data?.refreshQueues?.find((queue) => queue.kind === "list")
			?.cooldownSeconds ?? cachedRefresh.listCooldownSeconds;
	const detailCooldownSeconds =
		data?.refreshQueues?.find((queue) => queue.kind === "details")
			?.cooldownSeconds ?? cachedRefresh.detailCooldownSeconds;
	const [collectionError, setCollectionError] = useState<string | null>(null);
	const [viewId] = useState(() => crypto.randomUUID());
	const viewSequence = useRef(0);
	const mounted = useRef(false);
	const ticket = useRef(0);
	const mutationLock = useRef(false);
	const [params, setParams] = useSearchParams();
	const [savedFilters, setSavedFilters] = useState(storedFilters);
	const hasLiveProjects =
		data?.projects.some((project) => project.source === "cli") ?? false;
	const filter = useMemo(() => {
		const explicit = [...Object.values(PULL_FILTER_PARAMS), "author"].some(
			(key) => params.has(key),
		);
		const parsed = readPullFilter(
			explicit ? params : new URLSearchParams(savedFilters),
			hasLiveProjects,
		);
		const project = data?.projects.find(
			(item) => item.id === parsed.projectId && item.source === parsed.source,
		);
		return {
			...parsed,
			organization:
				parsed.organization || project?.organization.toLowerCase() || "",
		};
	}, [params, hasLiveProjects, data, savedFilters]);

	useEffect(() => {
		if (loading) return;
		const next = writePullFilter(filter).toString();
		if (next === savedFilters) return;
		setSavedFilters(next);
		try {
			localStorage.setItem(PULL_FILTER_STORAGE_KEY, next);
		} catch {
			// Navigation still remembers the filters when browser storage is unavailable.
		}
	}, [filter, loading, savedFilters]);

	useEffect(() => {
		try {
			localStorage.setItem(
				REFRESH_SETTINGS_STORAGE_KEY,
				JSON.stringify({ listCooldownSeconds, detailCooldownSeconds }),
			);
		} catch {
			// The current session still works when browser storage is unavailable.
		}
	}, [listCooldownSeconds, detailCooldownSeconds]);

	const reload = useCallback(async () => {
		if (!mounted.current) return;
		const request = ++ticket.current;
		setRefreshing(true);
		try {
			const next = await loadWorkbench();
			if (request === ticket.current) {
				setData(next);
				setError(null);
			}
		} catch (failure) {
			if (request === ticket.current) setError(message(failure));
		} finally {
			if (request === ticket.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => {
		mounted.current = true;
		void reload();
		return () => {
			mounted.current = false;
			ticket.current++;
		};
	}, [reload]);
	const collecting =
		data?.collectionJobs?.some((job) =>
			["running", "queued", "auth_required"].includes(job.state),
		) ?? false;
	useEffect(() => {
		if (!hasLiveProjects && !collecting) return;
		let pending = false;
		const poll = async () => {
			if (
				pending ||
				document.visibilityState !== "visible" ||
				mutationLock.current
			)
				return;
			pending = true;
			try {
				await reload();
			} finally {
				pending = false;
			}
		};
		const timer = setInterval(() => {
			void poll();
		}, 3000);
		const foreground = () => {
			void poll();
		};
		document.addEventListener("visibilitychange", foreground);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", foreground);
		};
	}, [hasLiveProjects, collecting, reload]);

	const publishCollectionView = useCallback(
		async (view: CollectionPage) => {
			const sequence = ++viewSequence.current;
			try {
				await updateCollectionView({ ...view, viewId, sequence });
				if (mounted.current && sequence === viewSequence.current)
					setCollectionError(null);
				return true;
			} catch (failure) {
				if (mounted.current && sequence === viewSequence.current)
					setCollectionError(message(failure));
				return false;
			}
		},
		[viewId],
	);

	const mutate = useCallback(
		async (label: string, operation: () => Promise<string>) => {
			if (mutationLock.current) return false;
			mutationLock.current = true;
			setBusy(label);
			setMutationError(null);
			setNotice(null);
			let success = false;
			try {
				const resultNotice = await operation();
				if (mounted.current) setNotice(resultNotice);
				success = true;
			} catch (failure) {
				if (mounted.current) setMutationError(message(failure));
			} finally {
				await reload();
				mutationLock.current = false;
				if (mounted.current) setBusy(null);
			}
			return success;
		},
		[reload],
	);

	const rows = useMemo(() => (data ? pullRows(data) : []), [data]);
	const matching = useMemo(
		() =>
			scopePulls(rows, {
				...filter,
				organization: "",
				projectId: "",
				repository: "",
			}),
		[rows, filter],
	);
	const projects = useMemo(
		() =>
			data
				? projectSummaries(data, rows, matching).filter(
						({ project }) => project.source === filter.source,
					)
				: [],
		[data, rows, matching, filter.source],
	);
	const organizations = useMemo(
		() =>
			[
				...new Set(
					projects.map(({ project }) => project.organization.toLowerCase()),
				),
			].sort(),
		[projects],
	);
	const projectOptions = useMemo(
		() =>
			projects
				.filter(
					({ project }) =>
						!filter.organization ||
						project.organization.toLowerCase() === filter.organization,
				)
				.sort(
					(a, b) =>
						a.project.projectKey.localeCompare(b.project.projectKey) ||
						a.project.organization.localeCompare(b.project.organization),
				),
		[projects, filter.organization],
	);
	const repositories = useMemo(
		() =>
			projectOptions
				.filter(
					({ project }) => !filter.projectId || project.id === filter.projectId,
				)
				.flatMap((summary) => summary.repositories)
				.sort(
					(a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
				),
		[projectOptions, filter.projectId],
	);
	const selectedRepository =
		repositories.find((repo) => matchesRepository(repo, filter.repository)) ??
		null;
	const scoped = useMemo(() => scopePulls(rows, filter), [rows, filter]);
	const authors = useMemo(
		() =>
			authorOptions([
				...scopePulls(rows, {
					...filter,
					query: "",
					draft: "include",
					authors: [],
				}),
				...rows.filter(
					(row) =>
						row.project.source === filter.source &&
						filter.authors.includes(pullAuthorId(row)),
				),
			]),
		[rows, filter],
	);
	const visible = useMemo(() => visiblePulls(scoped, filter), [scoped, filter]);
	const metrics = useMemo(() => pullMetrics(scoped), [scoped]);
	const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
	const requestedPage = Number(params.get("page") ?? 1);
	const page = Math.min(
		pageCount,
		Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1),
	);
	const selected =
		rows.find(
			(row) =>
				row.project.source === filter.source &&
				row.pull.id === params.get("pr"),
		) ?? null;
	const pageRows = useMemo(
		() => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
		[visible, page],
	);

	// Only explicit navigation selects an outside-page detail. New data may move an
	// open row off this page without changing the page's collection round.
	const detailNavigation = JSON.stringify([filter, page, params.get("pr")]);
	const detailScope = useRef({ navigation: "", pullId: "" });
	if (data && detailScope.current.navigation !== detailNavigation) {
		detailScope.current = {
			navigation: detailNavigation,
			pullId:
				selected && !pageRows.some((row) => row.pull.id === selected.pull.id)
					? selected.pull.id
					: "",
		};
	}
	const externalDetail =
		selected?.pull.id === detailScope.current.pullId ? selected : null;
	const collectionPullIds = (externalDetail ? [externalDetail] : pageRows)
		.filter(
			({ project }) =>
				project.enabled &&
				project.source === "cli" &&
				project.provider === "ado",
		)
		.map(({ pull }) => pull.id);
	const navigation = JSON.stringify([filter, page, externalDetail?.pull.id]);
	const collectionPage = useMemo(
		() => ({ navigation, key: crypto.randomUUID() }),
		[navigation],
	);

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
		} else if (patch.projectId !== undefined) {
			next.repository = patch.repository ?? "";
		}
		if (patch.projectId) {
			const project = data?.projects.find(
				(item) => item.id === patch.projectId && item.source === next.source,
			);
			if (project) next.organization = project.organization.toLowerCase();
		}
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

	return {
		data,
		connection: collectorConnection(data),
		canScan: (project: Project) =>
			data !== null && canScanProject(project, data),
		projects,
		organizations,
		projectOptions,
		repositories,
		selectedRepository,
		authors,
		selectRepository: (key: string) => {
			const repository = repositories.find((repo) => repo.key === key);
			setFilter(
				repository
					? {
							organization: repository.project.organization.toLowerCase(),
							projectId: repository.project.id,
							repository: repository.id,
						}
					: { repository: "" },
			);
		},
		rows,
		visible,
		metrics,
		filter,
		setFilter,
		loading,
		refreshing,
		error,
		mutationError,
		notice,
		busy,
		listCooldownSeconds,
		detailCooldownSeconds,
		setRefreshCooldown: async (kind: RefreshQueueKind, seconds: number) => {
			const parsed = refreshCooldownSchema.safeParse(seconds);
			if (!parsed.success || !data) return false;
			return mutate("refresh-settings", async () => {
				await patchRefreshSettings(
					kind === "list"
						? { listCooldownSeconds: parsed.data }
						: { detailCooldownSeconds: parsed.data },
				);
				return "";
			});
		},
		publishCollectionView,
		collectionPageKey: collectionPage.key,
		collectionPullIds,
		collectionError,
		reload,
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		pageRows,
		setPage: (nextPage: number) => setParam("page", String(nextPage)),
		selected,
		selectPull: (id: string | null) => setParam("pr", id),
		missingSelection:
			data !== null && !loading && Boolean(params.get("pr")) && !selected,
		clearMutationError: () => setMutationError(null),
		refreshPull: async (id: string) => {
			const row = rows.find((candidate) => candidate.pull.id === id);
			if (
				!row?.project.enabled ||
				(row.project.source === "demo"
					? !data?.demoMode
					: row.project.provider !== "ado")
			)
				return false;
			return mutate("checks", async () => {
				if (row.project.source === "cli") {
					await scanProject(row.project.id, row.project.revision, [id]);
					return `Queued PR #${row.pull.number} checks.`;
				}
				await scanProject(row.project.id, row.project.revision);
				return "Sample PR statuses updated.";
			});
		},
		saveReadiness: (project: Project, rules: ReadinessRule[]) =>
			mutate("readiness", async () => {
				await patchReadiness(project.id, project.readinessRevision ?? 1, rules);
				return "Readiness order and colors saved.";
			}),
		save: (draft: ProjectWrite, project: Project | null) =>
			mutate("save", async () => {
				const saved = project
					? await patchProject(project.id, {
							...draft,
							revision: project.revision,
						})
					: await createProject(draft);
				return project
					? "Project updated."
					: saved.source === "demo"
						? "Project added. Scan it to load sample pull requests."
						: "Project added. Scan it to collect live Azure DevOps pull requests.";
			}),
		remove: (project: Project) =>
			mutate("delete", async () => {
				await deleteProject(project.id, project.revision);
				return `${project.name} removed.`;
			}),
		toggleMonitoring: (project: Project) =>
			mutate(project.id, async () => {
				await patchProject(project.id, {
					revision: project.revision,
					enabled: !project.enabled,
				});
				return `${project.name} monitoring ${project.enabled ? "paused" : "resumed"}.`;
			}),
		scan: (projectId?: string) =>
			mutate(projectId ?? "scan-all", async () => {
				const scannableProjects = (data?.projects ?? []).filter(
					(p) =>
						data &&
						canScanProject(p, data) &&
						(projectId ? p.id === projectId : p.source === filter.source),
				);
				if (!scannableProjects.length)
					throw new Error(
						"No eligible projects to scan. Check monitoring and active scans.",
					);
				let count = 0;
				let stages = 0;
				let queued = 0;
				let authRequired = false;
				const failures: string[] = [];
				for (const project of scannableProjects) {
					try {
						const result =
							project.source === "cli"
								? await scanProject(project.id, project.revision, [])
								: await scanProject(project.id, project.revision);
						if ("advancedStages" in result) {
							count++;
							stages += result.advancedStages;
						} else {
							queued++;
							authRequired ||= result.state === "auth_required";
						}
					} catch (failure) {
						failures.push(`${project.name}: ${message(failure)}`);
					}
				}
				if (failures.length)
					throw new Error(
						`${count} project(s) scanned. ${queued} queued. ${failures.join(" ")}`,
					);
				const notices: string[] = [];
				if (count)
					notices.push(
						`Scanned ${count} project${count === 1 ? "" : "s"} · ${stages} build stages updated.`,
					);
				if (queued)
					notices.push(
						`Queued ${queued} project${queued === 1 ? "" : "s"} for live collection.${authRequired ? " Waiting for Azure login." : ""}`,
					);
				return notices.join(" ");
			}),
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
