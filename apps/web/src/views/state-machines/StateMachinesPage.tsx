import { Badge, Button, Checkbox, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { MachinePage, MachinePreview } from "@signoff/domain/query";
import type { StateMachine } from "@signoff/domain/workbench";
import {
	ArrowRight,
	CheckCheck,
	GitBranch,
	History,
	ListOrdered,
	Network,
	Play,
	Route,
	Save,
	ScanSearch,
	ShieldCheck,
	Undo2,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { type SetURLSearchParams, useSearchParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
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
		setTab(
			next.category === "state"
				? "states"
				: next.category === "mapping"
					? "mappings"
					: "inspect",
		);
	}
	return (
		<div className="space-y-4">
			<PageHeader
				title="State machines"
				description="Follow PR evidence, customize judgments, and see why a state was chosen."
				actions={
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							size="sm"
							disabled={!vm.dirty || Boolean(vm.busy)}
							onClick={vm.discard}
						>
							<Undo2 size={14} aria-hidden />
							Discard
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={!vm.dirty || Boolean(vm.busy) || vm.conflict}
							onClick={() => void vm.previewDraft()}
						>
							<Play size={14} aria-hidden />
							{vm.busy === "preview" ? "Previewing…" : "Preview changes"}
						</Button>
						<Button
							size="sm"
							disabled={!vm.canSave}
							onClick={() => void vm.save()}
						>
							<Save size={14} aria-hidden />
							{vm.busy === "save" ? "Saving…" : "Save rules"}
						</Button>
					</div>
				}
			/>
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
				<>
					<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
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
						/>
					</div>
					{vm.preview ? <PreviewResults preview={vm.preview} /> : null}
					<div className="flex items-start gap-2 text-xs leading-5 text-basalt-muted-foreground">
						<ShieldCheck
							size={15}
							className="mt-0.5 shrink-0 text-emerald-600"
							aria-hidden
						/>
						<p>
							Missing, invalidated or unknown checks cannot become ready through
							a custom mapping. Filters and graph positions are display
							preferences. Saving rules re-evaluates cached facts without
							fetching the provider.
						</p>
					</div>
				</>
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
		<LayerCard className="flex flex-wrap items-center gap-3 p-3">
			<Network className="h-5 w-5 text-basalt-primary" aria-hidden />
			<SelectControl
				aria-label="State machine data source"
				value={source}
				disabled={vm.dirty || Boolean(vm.busy)}
				className="w-28"
				onChange={(value) => onScope(value, "", "")}
			>
				<option value="cli">Live</option>
				<option value="demo">Sample</option>
			</SelectControl>
			<SelectControl
				aria-label="State machine project"
				value={projectId}
				disabled={vm.dirty || Boolean(vm.busy)}
				className="w-56 max-w-full"
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
				className="text-basalt-muted-foreground"
				aria-hidden
			/>
			<SelectControl
				aria-label="State machine repository"
				value={repositoryId ?? ""}
				disabled={vm.dirty || Boolean(vm.busy) || !page}
				className="w-60 max-w-full"
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
				<div className="ml-auto flex items-center gap-2 text-[11px] text-basalt-muted-foreground">
					<Badge variant="secondary">Revision {page.revision}</Badge>
					<span>
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
		</LayerCard>
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

	return (
		<LayerCard padding="none" className="min-w-0 overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-basalt-border p-3">
				<fieldset
					className="flex items-center gap-1 rounded-lg bg-basalt-muted/50 p-1"
					aria-label="Graph mode"
				>
					{(["model", "observed"] as const).map((value) => (
						<Button
							key={value}
							variant={mode === value ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={mode === value}
							className="h-7"
							onClick={() => setMode(value)}
						>
							{value === "model" ? (
								<Network size={13} aria-hidden />
							) : (
								<History size={13} aria-hidden />
							)}
							{value === "model" ? "Rule model" : "Observed transitions"}
						</Button>
					))}
				</fieldset>
				<label
					htmlFor="machine-all-gates"
					className="flex items-center gap-2 text-xs text-basalt-muted-foreground"
				>
					<Checkbox
						id="machine-all-gates"
						checked={allGates}
						disabled={mode === "observed"}
						onCheckedChange={(checked) => setAllGates(checked === true)}
					/>
					All collected gates
				</label>
			</div>
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
			{vm.dirty && !vm.preview ? (
				<p className="border-b border-basalt-border bg-amber-500/5 px-4 py-2 text-xs text-amber-700 basalt-dark:text-amber-300">
					Draft rules. Preview changes to compute PR states and highlight a
					path.
				</p>
			) : selected ? (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-basalt-border px-4 py-2 text-[11px] text-basalt-muted-foreground">
					<ReadinessSwatch color={selected.readiness.color ?? "gray"}>
						{selected.readiness.label}
					</ReadinessSwatch>
					<span>Lifecycle {relativeAge(selected.summaryObservedAt, now)}</span>
					<span>
						Checks{" "}
						{selected.checksObservedAt === null
							? "not collected"
							: relativeAge(selected.checksObservedAt, now)}
					</span>
					{vm.preview ? <span>Preview result</span> : null}
				</div>
			) : null}
			<StateMachineGraph
				config={config}
				evaluations={evaluations}
				selected={selected}
				transitions={page.transitions}
				mode={mode}
				showAllGates={allGates}
				storageKey={`${storageKey}:${mode}`}
				onSelect={onSelect}
			/>
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-basalt-border px-4 py-2.5 text-[11px] text-basalt-muted-foreground">
				<span>
					{mode === "model"
						? "Colored path = selected PR · click a node to inspect"
						: "Edges = retained observations for the selected PR"}
				</span>
				<span>
					{page.evaluatedCount.toLocaleString()} / {page.total.toLocaleString()}{" "}
					cached PRs
					{page.truncated ? " · bounded sample, open first" : ""}
				</span>
			</div>
		</LayerCard>
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
}) {
	return (
		<LayerCard
			padding="none"
			className="flex min-h-0 min-w-0 flex-col overflow-hidden xl:max-h-[860px]"
		>
			<div
				className="flex border-b border-basalt-border p-1.5"
				role="tablist"
				aria-label="State machine inspector"
			>
				{INSPECTOR_TABS.map(({ id, label, icon: Icon }) => (
					<Button
						variant="ghost"
						type="button"
						role="tab"
						aria-selected={tab === id}
						key={id}
						className={cn(
							"h-auto flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px]",
							tab === id
								? "bg-basalt-primary/10 text-basalt-primary"
								: "text-basalt-muted-foreground hover:bg-basalt-muted/50",
						)}
						onClick={() => setTab(id)}
					>
						<Icon size={15} aria-hidden />
						{label}
					</Button>
				))}
			</div>
			<div
				className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
				role="tabpanel"
				aria-label={tab}
			>
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
			<div className="border-t border-basalt-border p-3">
				<Button
					size="sm"
					variant="ghost"
					className="w-full text-xs"
					disabled={Boolean(vm.busy)}
					onClick={() => vm.update(null)}
				>
					<Undo2 size={13} aria-hidden />
					{repositoryId ? "Use project rules" : "Use original defaults"}
				</Button>
			</div>
		</LayerCard>
	);
}
