import { Badge, Button, Checkbox, LayerCard } from "@nocoo/basalt";
import type { MachinePage, MachinePreview } from "@signoff/domain/query";
import type { StateMachine } from "@signoff/domain/workbench";
import {
	ArrowRight,
	CheckCheck,
	GitBranch,
	History,
	Layers3,
	ListOrdered,
	Network,
	PanelRightClose,
	Play,
	Route,
	Save,
	ScanSearch,
	Undo2,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { type SetURLSearchParams, useSearchParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { HeaderTooltip } from "@/components/layout/header-links";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { relativeAge } from "@/models/freshness";
import type { MachineSelection } from "@/models/stateMachineGraph";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import {
	type StateMachineViewModel,
	useStateMachineViewModel,
} from "@/viewmodels/useStateMachineViewModel";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { ReadinessSwatch } from "@/views/workbench/WorkbenchStatus";
import { MachinePullPicker } from "./MachinePullPicker";
import {
	GatesEditor,
	MappingsEditor,
	StatesEditor,
} from "./StateMachineEditors";
import { StateMachineGraph } from "./StateMachineGraph";
import {
	EvidenceInspector,
	MachineHistory,
	MappingTrace,
} from "./StateMachineInspector";

const INSPECTOR_TABS = [
	{ id: "inspect", label: "Inspect", icon: ScanSearch },
	{ id: "priority", label: "Priority", icon: ListOrdered },
	{ id: "states", label: "States", icon: CheckCheck },
	{ id: "mappings", label: "Mappings", icon: Route },
	{ id: "history", label: "History", icon: History },
] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];
export default function StateMachinesPage() {
	const workbench = useWorkbench();
	const [params, setParams] = useSearchParams();
	const source = workbench.filter.source;
	const projectId =
		params.get("project") || workbench.projectOptions[0]?.project.id || "";
	const repositoryId = params.get("repo") || null;
	const pullId = params.get("trace");
	const vm = useStateMachineViewModel(
		{ source, projectId, repositoryId },
		pullId,
	);
	const [tab, setTab] = useState<InspectorTab>(
		() =>
			INSPECTOR_TABS.find((item) => item.id === params.get("tab"))?.id ??
			"inspect",
	);
	const [selection, setSelection] = useState<MachineSelection | null>(null);
	const [inspectorOpen, setInspectorOpen] = useState(() =>
		INSPECTOR_TABS.some((item) => item.id === params.get("tab")),
	);
	const page = vm.data;
	const config = vm.config;
	const evaluations = vm.dirty
		? (vm.preview?.evaluations ?? [])
		: (page?.evaluations ?? []);
	const selected = evaluations.find((pr) => pr.id === pullId);
	function scope(
		nextSource: string,
		nextProject: string,
		nextRepository: string,
	) {
		setSelection(null);
		setParams({
			source: nextSource,
			...(nextProject ? { project: nextProject } : {}),
			...(nextRepository ? { repo: nextRepository } : {}),
		});
	}
	function selectNode(next: MachineSelection) {
		setSelection(next);
		setInspectorOpen(true);
		setTab(
			next.category === "state"
				? "states"
				: next.category === "mapping"
					? "mappings"
					: "inspect",
		);
	}
	function closeInspector() {
		setInspectorOpen(false);
		document.getElementById(`machine-tab-${tab}`)?.focus();
	}
	return (
		<div className="machine-workspace absolute inset-0 flex min-h-0 flex-col overflow-hidden">
			<h1 className="sr-only">State machines</h1>
			<ScopeBar
				vm={vm}
				source={source}
				projectId={projectId}
				repositoryId={repositoryId}
				projects={workbench.projectOptions}
				onScope={scope}
			/>
			{vm.error ? (
				<AlertBanner variant="error">
					{vm.error}
					<Button size="sm" variant="ghost" onClick={() => void vm.reload()}>
						Reload
					</Button>
				</AlertBanner>
			) : null}
			{vm.notice ? <AlertBanner>{vm.notice}</AlertBanner> : null}
			{vm.conflict ? (
				<AlertBanner variant="warning">
					Rules changed while you were editing. Your draft is retained.
					<Button variant="outline" size="sm" onClick={vm.rebase}>
						Rebase draft on latest revision
					</Button>
				</AlertBanner>
			) : null}
			{!projectId ? (
				<LayerCard padding="none">
					<EmptyState
						icon={Network}
						title="No projects in this source"
						description="Add a project and discover its PRs to inspect collected states."
					/>
				</LayerCard>
			) : !page || !config ? (
				<LayerCard>
					<LayerCard.Loading label="Loading state machine" />
				</LayerCard>
			) : (
				<div className="machine-stage relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
					<CanvasCard
						page={page}
						config={config}
						vm={vm}
						evaluations={evaluations}
						selected={selected}
						pullId={pullId}
						storageKey={`signoff:machine-layout:${source}:${projectId}:${repositoryId ?? "project"}`}
						onSelect={selectNode}
						setParams={setParams}
					/>
					<InspectorCard
						vm={vm}
						page={page}
						config={config}
						selected={selected}
						repositoryId={repositoryId}
						selection={selection}
						setSelection={setSelection}
						tab={tab}
						setTab={setTab}
						open={inspectorOpen}
						onOpen={() => setInspectorOpen(true)}
						onClose={closeInspector}
					/>
				</div>
			)}
		</div>
	);
}
function PreviewResults({ preview }: { preview: MachinePreview }) {
	return (
		<LayerCard padding="none">
			<LayerCard.Header>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="flex items-center gap-2">
						<Play size={15} className="text-basalt-primary" aria-hidden />
						Preview · {preview.changed} changed PRs
					</span>
					<span className="text-xs font-normal text-basalt-muted-foreground">
						{preview.evaluatedCount.toLocaleString()} of{" "}
						{preview.total.toLocaleString()} cached PRs
						{preview.truncated ? " · sampled" : ""}
					</span>
				</div>
			</LayerCard.Header>
			<LayerCard.Body className="max-h-72 space-y-2 overflow-y-auto">
				{preview.changes.length ? (
					preview.changes.map((change) => (
						<div
							key={change.id}
							className="flex flex-wrap items-center gap-3 rounded-lg border border-basalt-border px-3 py-2 text-xs"
						>
							<span className="min-w-0 flex-1 truncate">
								#{change.number} {change.title}
							</span>
							<ReadinessSwatch color={change.before.color ?? "gray"}>
								{change.before.label}
							</ReadinessSwatch>
							<ArrowRight size={13} aria-hidden />
							<ReadinessSwatch color={change.after.color ?? "gray"}>
								{change.after.label}
							</ReadinessSwatch>
						</div>
					))
				) : (
					<p className="text-sm text-basalt-muted-foreground">
						No PR classifications change in this preview.
					</p>
				)}
			</LayerCard.Body>
		</LayerCard>
	);
}

function ScopeBar({
	vm,
	source,
	projectId,
	repositoryId,
	projects,
	onScope,
}: {
	vm: StateMachineViewModel;
	source: string;
	projectId: string;
	repositoryId: string | null;
	projects: ReturnType<typeof useWorkbench>["projectOptions"];
	onScope: (source: string, project: string, repo: string) => void;
}) {
	const page = vm.data;
	return (
		<div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-basalt-border px-3 py-1.5">
			<SelectControl
				aria-label="State machine data source"
				value={source}
				disabled={vm.dirty || Boolean(vm.busy)}
				className="h-8 w-20 shrink-0 px-2 text-xs"
				onChange={(value) => onScope(value, "", "")}
			>
				<option value="cli">Live</option>
				<option value="demo">Sample</option>
			</SelectControl>
			<SelectControl
				aria-label="State machine project"
				value={projectId}
				disabled={vm.dirty || Boolean(vm.busy)}
				className="h-8 w-0 min-w-0 flex-1 px-2 text-xs md:max-w-56"
				onChange={(value) => onScope(source, value, "")}
			>
				{projects.map(({ project }) => (
					<option key={project.id} value={project.id}>
						{project.organization} / {project.name}
					</option>
				))}
			</SelectControl>
			<GitBranch
				size={15}
				className="hidden shrink-0 text-basalt-primary sm:block"
				aria-hidden
			/>
			<SelectControl
				aria-label="State machine repository"
				value={repositoryId ?? ""}
				disabled={vm.dirty || Boolean(vm.busy) || !page}
				className="h-8 w-0 min-w-0 flex-1 px-2 text-xs md:max-w-60"
				onChange={(value) => onScope(source, projectId, value)}
			>
				<option value="">Project default · all repositories</option>
				{(page?.repositories ?? []).map((repo) => (
					<option key={repo.id} value={repo.id}>
						{repo.name}
					</option>
				))}
			</SelectControl>
			{page ? (
				<div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-basalt-muted-foreground">
					<HeaderTooltip
						label={`Revision ${page.revision}${vm.dirty ? " · Unsaved draft" : ""}`}
					>
						<Badge
							variant="secondary"
							className={vm.dirty ? "text-amber-600" : ""}
						>
							{vm.dirty ? "Draft" : `r${page.revision}`}
						</Badge>
					</HeaderTooltip>
					<span className="hidden lg:inline">
						{vm.dirty
							? "Unsaved draft"
							: repositoryId
								? page.inherited
									? "Inherits project rules"
									: "Repository override"
								: page.configured
									? "Project rules"
									: "Original project rules"}
					</span>
				</div>
			) : null}
		</div>
	);
}

type Evaluation = MachinePage["evaluations"][number];
function CanvasCard({
	page,
	config,
	vm,
	evaluations,
	selected,
	pullId,
	storageKey,
	onSelect,
	setParams,
}: {
	page: MachinePage;
	config: StateMachine;
	vm: StateMachineViewModel;
	evaluations: Evaluation[];
	selected?: Evaluation;
	pullId: string | null;
	storageKey: string;
	onSelect: (selection: MachineSelection) => void;
	setParams: SetURLSearchParams;
}) {
	const [mode, setMode] = useState<"model" | "observed">("model");
	const [allGates, setAllGates] = useState(true);
	const now = useMinuteNow();
	const toolbar = (
		<div className="flex items-center gap-2">
			<fieldset
				className="flex items-center gap-0.5 rounded-lg border border-basalt-border bg-basalt-card/95 p-0.5 shadow-sm"
				aria-label="Graph mode"
			>
				{(["model", "observed"] as const).map((value) => (
					<Button
						key={value}
						variant={mode === value ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={mode === value}
						aria-label={
							value === "model" ? "Rule model" : "Observed transitions"
						}
						className="h-7 px-2 text-xs"
						onClick={() => setMode(value)}
					>
						{value === "model" ? (
							<Network size={13} className="text-sky-500" aria-hidden />
						) : (
							<History size={13} className="text-violet-500" aria-hidden />
						)}
						{value === "model" ? "Model" : "Transitions"}
					</Button>
				))}
			</fieldset>
			<HeaderTooltip label="Show all collected gates, including gates without evidence on this PR">
				<label
					htmlFor="machine-all-gates"
					className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-basalt-border bg-basalt-card/95 px-2 text-xs text-basalt-muted-foreground shadow-sm"
				>
					<Checkbox
						id="machine-all-gates"
						aria-label="All collected gates"
						checked={allGates}
						disabled={mode === "observed"}
						onCheckedChange={(checked) => setAllGates(checked === true)}
					/>
					<Layers3 size={13} className="text-teal-500" aria-hidden />
					<span className="machine-gates-label">All gates</span>
				</label>
			</HeaderTooltip>
		</div>
	);
	return (
		<div className="machine-graph-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<MachinePullPicker
				scope={{
					source: page.project.source,
					projectId: page.project.id,
					repositoryId: page.repositoryId,
				}}
				pullId={pullId}
				selectedPull={page.selectedPull}
				onChange={(value) =>
					setParams(
						(previous) => {
							const next = new URLSearchParams(previous);
							next.set("project", page.project.id);
							next.set("trace", value);
							return next;
						},
						{ replace: true },
					)
				}
			/>
			<StateMachineGraph
				config={config}
				evaluations={evaluations}
				selected={selected}
				transitions={page.transitions}
				mode={mode}
				showAllGates={allGates}
				storageKey={`${storageKey}:${mode}`}
				onSelect={onSelect}
				toolbar={toolbar}
			/>
			<div className="flex min-w-0 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-basalt-border px-3 py-1 text-[10px] text-basalt-muted-foreground">
				{vm.dirty && !vm.preview ? (
					<span className="text-amber-600 basalt-dark:text-amber-400">
						Draft · preview to update the PR trace
					</span>
				) : selected ? (
					<>
						<ReadinessSwatch color={selected.readiness.color ?? "gray"}>
							{selected.readiness.label}
						</ReadinessSwatch>
						<span>
							Lifecycle {relativeAge(selected.summaryObservedAt, now)}
						</span>
						<span>
							Checks{" "}
							{selected.checksObservedAt === null
								? "not collected"
								: relativeAge(selected.checksObservedAt, now)}
						</span>
						{vm.preview ? <span>Preview result</span> : null}
					</>
				) : (
					<span>Select a PR to follow its path</span>
				)}
				<span className="ml-auto">
					{page.evaluatedCount.toLocaleString()} / {page.total.toLocaleString()}{" "}
					cached PRs
					{page.truncated ? " · sampled" : ""}
				</span>
			</div>
		</div>
	);
}

function InspectorCard({
	vm,
	page,
	config,
	selected,
	repositoryId,
	selection,
	setSelection,
	tab,
	setTab,
	open,
	onOpen,
	onClose,
}: {
	vm: StateMachineViewModel;
	page: MachinePage;
	config: StateMachine;
	selected?: Evaluation;
	repositoryId: string | null;
	selection: MachineSelection | null;
	setSelection: Dispatch<SetStateAction<MachineSelection | null>>;
	tab: InspectorTab;
	setTab: Dispatch<SetStateAction<InspectorTab>>;
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
}) {
	return (
		<aside
			className="machine-inspector flex min-h-0 shrink-0"
			aria-label="State machine inspector"
		>
			<div
				className="relative z-20 order-2 flex w-11 shrink-0 flex-col items-center gap-1 border-l border-basalt-border bg-basalt-card py-2"
				role="tablist"
				aria-label="State machine inspector"
				aria-orientation="vertical"
			>
				{INSPECTOR_TABS.map(({ id, label, icon: Icon }, index) => (
					<HeaderTooltip key={id} label={label}>
						<Button
							variant="ghost"
							type="button"
							role="tab"
							id={`machine-tab-${id}`}
							aria-label={label}
							aria-selected={open && tab === id}
							tabIndex={tab === id ? 0 : -1}
							aria-controls={
								open && tab === id ? "machine-inspector-panel" : undefined
							}
							className={cn(
								"h-8 w-8 rounded-lg p-0",
								open && tab === id
									? "bg-basalt-primary/10 text-basalt-primary"
									: "text-basalt-muted-foreground hover:bg-basalt-muted/50",
							)}
							onClick={() => {
								setTab(id);
								onOpen();
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									onClose();
									return;
								}
								const next =
									event.key === "ArrowDown"
										? index + 1
										: event.key === "ArrowUp"
											? index - 1
											: event.key === "Home"
												? 0
												: event.key === "End"
													? INSPECTOR_TABS.length - 1
													: null;
								if (next === null) return;
								event.preventDefault();
								const nextTab =
									INSPECTOR_TABS[
										(next + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
									] ?? INSPECTOR_TABS[0];
								setTab(nextTab.id);
								onOpen();
								document.getElementById(`machine-tab-${nextTab.id}`)?.focus();
							}}
						>
							<Icon size={15} aria-hidden />
						</Button>
					</HeaderTooltip>
				))}
			</div>
			{open ? (
				<div
					className="machine-inspector-panel z-20 flex min-h-0 w-80 flex-col border-l border-basalt-border bg-basalt-card"
					id="machine-inspector-panel"
					role="tabpanel"
					aria-labelledby={`machine-tab-${tab}`}
					onKeyDown={(event) => {
						if (
							event.key === "Escape" &&
							!(event.target as HTMLElement).closest('[role="listbox"]')
						) {
							event.stopPropagation();
							onClose();
						}
					}}
				>
					<div className="flex h-11 shrink-0 items-center gap-2 border-b border-basalt-border px-3">
						<h2 className="flex-1 text-xs font-semibold">
							{INSPECTOR_TABS.find((item) => item.id === tab)?.label}
						</h2>
						<HeaderTooltip
							label={
								repositoryId ? "Use project rules" : "Use original defaults"
							}
						>
							<Button
								size="icon"
								variant="ghost"
								className="h-7 w-7"
								aria-label={
									repositoryId ? "Use project rules" : "Use original defaults"
								}
								disabled={Boolean(vm.busy)}
								onClick={() => vm.update(null)}
							>
								<Undo2 size={13} aria-hidden />
							</Button>
						</HeaderTooltip>
						<HeaderTooltip label="Hide inspector (Esc)">
							<Button
								size="icon"
								variant="ghost"
								className="h-7 w-7"
								aria-label="Hide inspector"
								onClick={onClose}
							>
								<PanelRightClose size={15} aria-hidden />
							</Button>
						</HeaderTooltip>
					</div>
					<div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
						{vm.preview ? <PreviewResults preview={vm.preview} /> : null}
						{tab === "inspect" ? (
							<>
								<EvidenceInspector
									page={page}
									evaluation={selected}
									selection={selection}
									onSelectGate={(id) => setSelection({ category: "gate", id })}
								/>
								<MappingTrace config={config} evaluation={selected} />
							</>
						) : null}
						<fieldset
							disabled={Boolean(vm.busy)}
							className="min-w-0 disabled:opacity-60"
						>
							{tab === "priority" ? (
								<GatesEditor
									config={config}
									onChange={vm.update}
									selectedId={selection?.id}
								/>
							) : tab === "states" ? (
								<StatesEditor
									config={config}
									onChange={vm.update}
									selectedId={selection?.id}
								/>
							) : tab === "mappings" ? (
								<MappingsEditor
									config={config}
									onChange={vm.update}
									selectedId={selection?.id}
								/>
							) : null}
						</fieldset>
						{tab === "history" ? (
							<MachineHistory
								page={page}
								busy={Boolean(vm.busy)}
								onRestore={(revision) => void vm.restore(revision)}
							/>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-2 border-t border-basalt-border p-2">
						<HeaderTooltip label="Discard changes">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 shrink-0"
								aria-label="Discard"
								disabled={!vm.dirty || Boolean(vm.busy)}
								onClick={vm.discard}
							>
								<Undo2 size={14} aria-hidden />
							</Button>
						</HeaderTooltip>
						<Button
							variant="outline"
							size="sm"
							className="flex-1 text-xs"
							aria-label="Preview changes"
							disabled={!vm.dirty || Boolean(vm.busy) || vm.conflict}
							onClick={() => void vm.previewDraft()}
						>
							<Play size={14} aria-hidden />
							{vm.busy === "preview" ? "Previewing…" : "Preview"}
						</Button>
						<Button
							size="sm"
							className="flex-1 text-xs"
							disabled={!vm.canSave}
							onClick={() => void vm.save()}
						>
							<Save size={14} aria-hidden />
							{vm.busy === "save" ? "Saving…" : "Save rules"}
						</Button>
					</div>
				</div>
			) : null}
		</aside>
	);
}
