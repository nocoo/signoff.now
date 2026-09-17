import {
	type Project,
	type ProjectWrite,
	projectWriteSchema,
	type Workbench,
} from "@signoff/domain/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
	DEFAULT_PULL_FILTER,
	type PullFilter,
	projectSummaries,
	pullMetrics,
	pullRows,
	readPullFilter,
	repositoryOptions,
	scopePulls,
	visiblePulls,
} from "@/models/workbench";
import {
	createProject,
	deleteProject,
	loadWorkbench,
	patchProject,
	scanProject,
} from "@/models/workbenchApi";

const PAGE_SIZE = 12;
const message = (error: unknown) =>
	error instanceof Error ? error.message : "Request failed";

export function useWorkbenchViewModel() {
	const [data, setData] = useState<Workbench | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const mounted = useRef(false);
	const ticket = useRef(0);
	const mutationLock = useRef(false);
	const [params, setParams] = useSearchParams();
	const filter = useMemo(() => readPullFilter(params), [params]);

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
	useEffect(() => {
		if (!autoRefresh) return;
		const timer = setInterval(() => {
			if (document.visibilityState === "visible" && !mutationLock.current)
				void reload();
		}, 15000);
		return () => clearInterval(timer);
	}, [autoRefresh, reload]);

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
	const projects = useMemo(
		() => (data ? projectSummaries(data, rows) : []),
		[data, rows],
	);
	const repositories = useMemo(
		() => repositoryOptions(rows, filter.projectId),
		[rows, filter.projectId],
	);
	const scoped = useMemo(() => scopePulls(rows, filter), [rows, filter]);
	const visible = useMemo(() => visiblePulls(scoped, filter), [scoped, filter]);
	const metrics = useMemo(() => pullMetrics(scoped), [scoped]);
	const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
	const requestedPage = Number(params.get("page") ?? 1);
	const page = Math.min(
		pageCount,
		Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1),
	);
	const selected = rows.find((row) => row.pull.id === params.get("pr")) ?? null;

	const setFilter = (patch: Partial<PullFilter>) => {
		const next = { ...filter, ...patch };
		if (patch.projectId !== undefined) next.repository = "";
		setParams(
			(previous) => {
				const result = new URLSearchParams(previous);
				for (const [key, param] of [
					["query", "q"],
					["projectId", "project"],
					["repository", "repo"],
					["state", "state"],
					["status", "status"],
					["sort", "sort"],
				] as const) {
					if (next[key] === DEFAULT_PULL_FILTER[key]) result.delete(param);
					else result.set(param, next[key]);
				}
				result.delete("page");
				return result;
			},
			{ replace: true },
		);
	};
	const setParam = (key: string, value: string | null) =>
		setParams(
			(previous) => {
				const next = new URLSearchParams(previous);
				if (value === null) next.delete(key);
				else next.set(key, value);
				return next;
			},
			{ replace: key === "page" },
		);

	return {
		data,
		projects,
		repositories,
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
		autoRefresh,
		setAutoRefresh,
		reload,
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		pageRows: visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
		setPage: (nextPage: number) => setParam("page", String(nextPage)),
		selected,
		selectPull: (id: string | null) => setParam("pr", id),
		missingSelection:
			data !== null && !loading && Boolean(params.get("pr")) && !selected,
		clearMutationError: () => setMutationError(null),
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
					: data?.demoMode
						? "Project added. Scan it to load sample pull requests."
						: "Project added. PR collection is not connected yet.";
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
						p.enabled &&
						p.source === "demo" &&
						(!projectId || p.id === projectId),
				);
				if (!data?.demoMode || !scannableProjects.length)
					throw new Error("No enabled demo projects to scan");
				let count = 0;
				let stages = 0;
				const failures: string[] = [];
				for (const project of scannableProjects) {
					try {
						const result = await scanProject(project.id, project.revision);
						count++;
						stages += result.advancedStages;
					} catch (failure) {
						failures.push(`${project.name}: ${message(failure)}`);
					}
				}
				if (failures.length)
					throw new Error(`${count} project(s) scanned. ${failures.join(" ")}`);
				return `Scanned ${count} project${count === 1 ? "" : "s"} · ${stages} build stages updated.`;
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
		description: project?.description ?? "",
		owner: project?.owner ?? "",
		enabled: project?.enabled ?? true,
	}));
	const [errors, setErrors] = useState<
		Partial<Record<keyof ProjectWrite, string>>
	>({});
	return {
		draft,
		errors,
		setField: <K extends keyof ProjectWrite>(
			key: K,
			value: ProjectWrite[K],
		) => {
			setDraft((previous) => ({ ...previous, [key]: value }));
			setErrors((previous) => ({ ...previous, [key]: undefined }));
		},
		submit: async () => {
			const parsed = projectWriteSchema.safeParse(draft);
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
