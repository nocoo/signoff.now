import { Badge, Button, Checkbox, LayerCard } from "@nocoo/basalt";
import { repositoryUrl } from "@signoff/domain/workbench";
import {
	ExternalLink,
	History,
	ListOrdered,
	Network,
	ScanSearch,
	Settings2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { loadCatalog, loadPull, lookupPull } from "@/models/monitoringApi";
import {
	loadMachine,
	loadMachineHistory,
	type MachineScope,
} from "@/models/stateMachineApi";
import {
	type MachineSelection,
	machineGraph,
} from "@/models/stateMachineGraph";
import {
	machineHref,
	matchesProject,
	parseWorkspaceLocation,
	policyHref,
	traceReference,
} from "@/models/workspaceLocation";
import { useQueryBlock } from "@/viewmodels/useQueryBlock";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { MachinePullPicker } from "./MachinePullPicker";
import { StateMachineGraph } from "./StateMachineGraph";
import { MachineInspector } from "./StateMachineInspector";

function useMachineScope(
	workbench: ReturnType<typeof useWorkbench>,
	params: URLSearchParams,
	pathname: string,
) {
	const route = useMemo(() => parseWorkspaceLocation(pathname), [pathname]);
	const source = workbench.filter.source;
	const projectScope = route?.project;
	const projects = projectScope
		? workbench.projects.filter(({ project }) =>
				matchesProject(projectScope, project),
			)
		: workbench.projects;
	const projectId = projectScope
		? projects.length === 1
			? (projects[0]?.project.id ?? "")
			: ""
		: params.get("project") || projects[0]?.project.id || "";
	const repositoryReference =
		projectScope && route?.repository
			? repositoryUrl(projectScope, route.repository)
			: null;
	const repositoryQuery = useQueryBlock(
		repositoryReference && projectId
			? `machine-repository:${source}:${projectId}:${repositoryReference}`
			: null,
		(signal) =>
			loadCatalog(source, signal, {
				projectId,
				repository: repositoryReference ?? "",
			}),
		30000,
	);
	const repository =
		repositoryQuery.data?.page.total === 1 &&
		repositoryQuery.data.data.length === 1
			? repositoryQuery.data.data[0]
			: null;
	const repositoryId = projectScope
		? (repository?.repository.id ?? null)
		: params.get("repo") || null;
	const trace = traceReference(route, params.get("pr"));
	const traceQuery = useQueryBlock(
		trace ? `machine-trace:${source}:${JSON.stringify(trace)}` : null,
		async (signal) => (trace ? lookupPull(source, trace, signal) : null),
		15000,
	);
	const pullId = projectScope
		? (traceQuery.data?.data.id ?? params.get("trace"))
		: params.get("trace");
	const requestedTrace = projectScope
		? (params.get("pr") ?? params.get("trace"))
		: params.get("trace");
	const routeError = !route?.valid
		? "Invalid state machine address"
		: projectScope && !workbench.loading && !projectId
			? (workbench.catalogError ??
				"Project address was not found or is ambiguous")
			: repositoryReference &&
					projectId &&
					!repositoryQuery.loading &&
					!repositoryId
				? (repositoryQuery.error ??
					"Repository address is not collected or is ambiguous")
				: params.get("pr") && projectScope && !trace
					? "Invalid PR trace address"
					: traceQuery.error;
	const scopeReady =
		!routeError && (!repositoryReference || Boolean(repositoryId));
	return {
		source,
		projectId,
		repositoryId,
		pullId,
		requestedTrace,
		routeError,
		scopeReady,
		repositoryQuery,
		traceQuery,
	};
}

export default function StateMachinesPage() {
	const workbench = useWorkbench();
	const [params] = useSearchParams();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const scope = useMachineScope(workbench, params, pathname);
	const { source, projectId, repositoryId, scopeReady, routeError } = scope;
	const key = JSON.stringify([source, projectId, repositoryId]);
	if (routeError)
		return <AlertBanner variant="error">{routeError}</AlertBanner>;
	if (!scopeReady || workbench.loading)
		return <LayerCard.Loading label="Loading state machine" />;
	if (!projectId) return <p>No projects in this data source.</p>;
	return (
		<MachineWorkspace
			key={key}
			scope={{ source, projectId, repositoryId }}
			pullId={scope.pullId}
			requestedTrace={Boolean(scope.requestedTrace)}
			onScope={(id, repo) => {
				const project = workbench.projects.find(
					(p) => p.project.id === id,
				)?.project;
				const repository = workbench.projects
					.find((p) => p.project.id === id)
					?.repositories.find((r) => r.id === repo);
				if (project) navigate(machineHref(project, repository));
			}}
		/>
	);
}

function MachineWorkspace({
	scope,
	pullId,
	requestedTrace,
	onScope,
}: {
	scope: MachineScope;
	pullId: string | null;
	requestedTrace: boolean;
	onScope: (id: string, repo: string | null) => void;
}) {
	const workbench = useWorkbench();
	const navigate = useNavigate();
	const location = useLocation();
	const [params, setParams] = useSearchParams();
	const [selection, setSelection] = useState<MachineSelection | null>(null);
	const query = useQueryBlock(
		JSON.stringify(scope),
		(signal) => loadMachine(scope, signal),
		30000,
	);
	const detail = useQueryBlock(
		pullId ? `${scope.source}:${pullId}` : null,
		(signal) => loadPull(scope.source, pullId ?? "", signal),
	);
	const history = useQueryBlock(
		pullId ? `history:${scope.source}:${pullId}` : null,
		(signal) => loadMachineHistory(scope, pullId ?? "", signal),
		30000,
	);
	const page = query.data;
	const candidate = detail.data?.data;
	const pull =
		candidate?.project.id === scope.projectId &&
		(!scope.repositoryId || candidate.repository.id === scope.repositoryId)
			? candidate
			: undefined;
	const mode = params.get("view") === "transitions" ? "observed" : "model";
	const allGates = params.get("gates") !== "pr";
	const tab = params.get("tab");
	const focusId =
		mode === "observed"
			? history.data?.events[0]
				? `lifecycle:${history.data.events[0].to.lifecycle}`
				: null
			: pull
				? `state:${pull.readiness.current?.kind ?? pull.readiness.previous?.kind ?? pull.readiness.kind}`
				: null;
	const graph = useMemo(
		() =>
			page
				? machineGraph(
						page,
						pull,
						history.data ?? { events: [] },
						mode,
						allGates,
					)
				: { nodes: [], edges: [] },
		[page, pull, history.data, mode, allGates],
	);
	function option(key: string, value: string | null) {
		setParams((previous) => {
			const next = new URLSearchParams(previous);
			if (value) next.set(key, value);
			else next.delete(key);
			return next;
		});
	}
	useEffect(() => {
		if (page && pull) {
			const href = machineHref(
				page.project,
				page.repositories.find((r) => r.id === scope.repositoryId),
				pull,
				params,
			);
			if (`${location.pathname}${location.search}` !== href)
				navigate(href, { replace: true });
		}
	}, [
		page,
		pull,
		scope.repositoryId,
		params,
		navigate,
		location.pathname,
		location.search,
	]);
	return (
		<div className="machine-workspace absolute inset-0 flex min-h-0 flex-col overflow-hidden text-xs">
			<h1 className="sr-only">State machines</h1>
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-basalt-border px-3 py-1.5">
				<Network className="h-4 w-4 text-basalt-primary" aria-hidden />
				<SelectControl
					aria-label="State machine project"
					value={scope.projectId}
					onChange={(id) => onScope(id, null)}
					className="h-8 w-0 min-w-24 flex-1 text-xs md:max-w-56"
				>
					{workbench.projects.map((p) => (
						<option key={p.project.id} value={p.project.id}>
							{p.project.name}
						</option>
					))}
				</SelectControl>
				<SelectControl
					aria-label="State machine repository"
					value={scope.repositoryId ?? ""}
					onChange={(id) => onScope(scope.projectId, id || null)}
					className="h-8 w-0 min-w-24 flex-1 text-xs md:max-w-60"
				>
					<option value="">Project default</option>
					{page?.repositories.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
						</option>
					))}
				</SelectControl>
				{!!page && (
					<Button
						asChild
						variant="ghost"
						size="sm"
						className="ml-auto h-8 text-xs"
					>
						<Link
							to={policyHref(
								page.project,
								page.repositories.find((r) => r.id === scope.repositoryId),
							)}
						>
							<ListOrdered size={14} />
							Policy instructions
						</Link>
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					className="h-8 text-xs"
					onClick={() =>
						void Promise.allSettled([
							query.reload(),
							detail.reload(),
							history.reload(),
						])
					}
				>
					Reload
				</Button>
			</div>
			<MachinePullPicker
				scope={scope}
				pullId={pullId}
				selectedPull={
					pull ? { ...pull, watched: Boolean(pull.observation?.active) } : null
				}
				autoSelect={!requestedTrace}
				onChange={(id) => {
					setSelection(null);
					setParams((previous) => {
						const next = new URLSearchParams(previous);
						next.delete("pr");
						next.set("trace", id);
						return next;
					});
				}}
			/>
			{Boolean(query.error || detail.error) && (
				<AlertBanner variant="error">{query.error || detail.error}</AlertBanner>
			)}
			{!!pull && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-basalt-border px-3 py-1.5 text-[11px]">
					<Badge variant="secondary">
						{pull.readiness.previous
							? `Previous: ${pull.readiness.previous.kind}`
							: pull.readiness.label}
					</Badge>
					<span className="text-basalt-muted-foreground">
						{pull.readiness.status} · {pull.state} · Checks{" "}
						{pull.checks.checksPassed}/{pull.checks.checksTotal}
					</span>
					<span className="truncate text-basalt-muted-foreground">
						{pull.readiness.nextAction}
					</span>
					<a
						href={pull.url}
						target="_blank"
						rel="noreferrer"
						className="ml-auto flex shrink-0 items-center gap-1 text-basalt-primary"
					>
						Source PR
						<ExternalLink size={12} />
					</a>
				</div>
			)}
			{!page ? (
				<LayerCard.Loading label="Loading state machine" />
			) : (
				<div className="machine-stage machine-graph-card relative flex min-h-0 flex-1 overflow-hidden">
					<StateMachineGraph
						graph={graph}
						focusId={focusId}
						mode={mode}
						storageKey={`signoff:machine-layout:${scope.source}:${scope.projectId}:${scope.repositoryId ?? "project"}:${mode}`}
						onSelect={(value) => {
							setSelection(value);
							option("tab", mode === "observed" ? "history" : "inspect");
						}}
						toolbar={
							<div className="flex flex-wrap items-center gap-1 rounded-lg border border-basalt-border bg-basalt-card/95 p-1 shadow-sm">
								<Button
									size="sm"
									className="h-7 px-2 text-xs"
									variant={mode === "model" ? "secondary" : "ghost"}
									aria-pressed={mode === "model"}
									onClick={() => option("view", null)}
								>
									<Network size={13} />
									Model
								</Button>
								<Button
									size="sm"
									className="h-7 px-2 text-xs"
									variant={mode === "observed" ? "secondary" : "ghost"}
									aria-pressed={mode === "observed"}
									onClick={() => option("view", "transitions")}
								>
									<History size={13} />
									Transitions
								</Button>
								<label
									htmlFor="machine-all-gates"
									className="flex items-center gap-1 px-1 text-[11px]"
								>
									<Checkbox
										id="machine-all-gates"
										aria-label="All collected gates"
										checked={allGates}
										disabled={mode === "observed"}
										onCheckedChange={(v) =>
											option("gates", v === true ? null : "pr")
										}
									/>
									All gates
								</label>
							</div>
						}
					/>
					{!!tab && (
						<aside
							aria-label="State machine inspector"
							className="machine-inspector-panel z-20 flex w-96 shrink-0 flex-col border-l border-basalt-border bg-basalt-card"
						>
							<div className="flex items-center justify-between border-b border-basalt-border px-3 py-2">
								<h2 className="font-semibold">
									{tab === "history"
										? "Observation history"
										: tab === "rules"
											? "Classification rules"
											: "Evidence inspector"}
								</h2>
								<Button
									size="icon"
									variant="ghost"
									className="h-7 w-7"
									aria-label="Close inspector"
									onClick={() => option("tab", null)}
								>
									<X size={14} />
								</Button>
							</div>
							<div className="min-h-0 flex-1 overflow-auto p-3">
								<MachineInspector
									tab={tab}
									page={page}
									pull={pull}
									selection={selection}
									history={history.data ?? { events: [] }}
									historyError={history.error}
								/>
							</div>
						</aside>
					)}
					<nav
						aria-label="Graph inspectors"
						className="z-30 flex w-11 shrink-0 flex-col items-center gap-2 border-l border-basalt-border bg-basalt-card py-2"
					>
						{[
							["inspect", "Inspect", ScanSearch],
							["rules", "Rules", Settings2],
							["history", "History", History],
						].map(([id, label, Icon]) => (
							<Button
								key={String(id)}
								variant={tab === id ? "secondary" : "ghost"}
								size="icon"
								className="h-8 w-8"
								aria-label={String(label)}
								title={String(label)}
								onClick={() => option("tab", tab === id ? null : String(id))}
							>
								{typeof Icon !== "string" && <Icon size={16} />}
							</Button>
						))}
					</nav>
				</div>
			)}
		</div>
	);
}
