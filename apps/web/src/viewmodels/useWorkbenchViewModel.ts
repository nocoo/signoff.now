import {
	type Project,
	type ProjectWrite,
	projectWriteSchema,
	type Workbench,
} from "@signoff/domain/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
	canScanProject,
	collectorConnection,
	DEFAULT_PULL_FILTER,
	matchesRepository,
	type PullFilter,
	projectSummaries,
	pullMetrics,
	pullRows,
	readPullFilter,
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
	const hasLiveProjects =
		data?.projects.some((project) => project.source === "cli") ?? false;
	const filter = useMemo(() => {
		const parsed = readPullFilter(params, hasLiveProjects);
		const project = data?.projects.find(
			(item) => item.id === parsed.projectId && item.source === parsed.source,
		);
		return {
			...parsed,
			organization:
				parsed.organization || project?.organization.toLowerCase() || "",
		};
	}, [params, hasLiveProjects, data]);

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
		() =>
			data
				? projectSummaries(data, rows).filter(
						({ project }) => project.source === filter.source,
					)
				: [],
		[data, rows, filter.source],
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
		if (patch.source !== undefined) {
			next.organization = patch.organization ?? "";
			next.projectId = patch.projectId ?? "";
			next.repository = patch.repository ?? "";
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
				const result = new URLSearchParams(previous);
				result.set("source", next.source);
				for (const [key, param] of [
					["query", "q"],
					["organization", "org"],
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
		connection: collectorConnection(data),
		canScan: (project: Project) =>
			data !== null && canScanProject(project, data),
		projects,
		organizations,
		projectOptions,
		repositories,
		selectedRepository,
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
						const result = await scanProject(project.id, project.revision);
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
