import { Badge, Button, Label, LayerCard } from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import type { MachineScope } from "@/models/stateMachineApi";
import {
	machineHref,
	matchesProject,
	parseWorkspaceLocation,
} from "@/models/workspaceLocation";
import { useStateMachineViewModel } from "@/viewmodels/useStateMachineViewModel";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
export default function StateMachinesPage() {
	const workbench = useWorkbench();
	const projects = workbench.data?.projects ?? [];
	const location = useLocation(),
		navigate = useNavigate();
	const route = parseWorkspaceLocation(location.pathname);
	const project = route?.project
		? projects.find((p) => matchesProject(route.project ?? p, p))
		: projects[0];
	const projectId = project?.id ?? "";
	const repositories =
		workbench.projects.find((p) => p.project.id === projectId)?.repositories ??
		[];
	const repository = route?.repository
		? repositories.find(
				(r) =>
					r.id === route.repository ||
					r.name.toLowerCase() === route.repository?.toLowerCase(),
			)
		: null;
	if (
		!workbench.loading &&
		route?.project &&
		(!project || (route.repository && !repository?.identityResolved))
	)
		return (
			<AlertBanner variant="error">
				Repository address is not collected or project is unavailable.
			</AlertBanner>
		);
	const scope = {
		source: workbench.filter.source,
		projectId,
		repositoryId: repository?.id ?? null,
	};
	return (
		<div className="space-y-4">
			<PageHeader
				title="State machines"
				description="Explain project policies and order their priority for Jev. Classification is decided by Jev, not rule mappings."
			/>
			<div className="flex flex-wrap items-center gap-3">
				<Label htmlFor="policy-project">Project</Label>
				<SelectControl
					id="policy-project"
					aria-label="Policy project"
					value={projectId}
					onChange={(v) => {
						const next = projects.find((p) => p.id === v);
						if (next) navigate(machineHref(next));
					}}
					className="w-72"
				>
					{projects.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</SelectControl>
			</div>
			{projectId ? (
				<PolicyEditor
					key={JSON.stringify(scope)}
					scope={scope}
					onRepository={(id) => {
						const next = repositories.find((r) => r.id === id);
						if (project) navigate(machineHref(project, next ?? null));
					}}
				/>
			) : (
				<p className="text-sm text-basalt-muted-foreground">
					No projects in this data source.
				</p>
			)}
		</div>
	);
}
function PolicyEditor({
	scope,
	onRepository,
}: {
	scope: MachineScope;
	onRepository: (id: string | null) => void;
}) {
	const vm = useStateMachineViewModel(scope),
		page = vm.query.data;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<Label htmlFor="policy-repository">Scope</Label>
				<SelectControl
					id="policy-repository"
					aria-label="Policy scope"
					value={scope.repositoryId ?? "project"}
					onChange={(v) => onRepository(v === "project" ? null : v)}
					className="w-72"
				>
					<option value="project">Project default</option>
					{page?.repositories.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
						</option>
					))}
				</SelectControl>
				{Boolean(page?.inherited) && (
					<Badge variant="secondary">Inherited from project</Badge>
				)}
				<Button
					variant="outline"
					onClick={() => {
						vm.discard();
						void vm.query.reload();
					}}
				>
					Reload
				</Button>
			</div>
			{Boolean(vm.error || vm.query.error) && (
				<AlertBanner variant="error">{vm.error || vm.query.error}</AlertBanner>
			)}
			{Boolean(vm.notice) && (
				<p role="status" className="text-sm">
					{vm.notice}
				</p>
			)}
			<p className="text-sm text-basalt-muted-foreground">
				Highest priority first. Describe what each policy means and when a
				person should act, including expected waits or advisory failures. All
				policies and their underlying evaluations remain available to Jev.
			</p>
			<fieldset disabled={vm.busy} className="space-y-3">
				<ol aria-label="Policy priority" className="space-y-3">
					{vm.instructions.map((item, index) => {
						const gate = page?.catalog.find(
							(g) => g.id === item.gateId || g.sourceIds?.includes(item.gateId),
						);
						return (
							<li key={item.gateId}>
								<LayerCard className="space-y-2">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<h2 className="text-sm font-semibold">
												{page?.policyCodes[item.gateId]} ·{" "}
												{gate?.name ?? item.gateId}
											</h2>
											<p className="break-all text-xs text-basalt-muted-foreground">
												{item.gateId}
												{gate?.sourceIds?.length
													? ` · ${gate.sourceIds.length} underlying evaluations`
													: ""}
											</p>
										</div>
										<div className="flex shrink-0">
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Move ${gate?.name ?? item.gateId} up`}
												disabled={index === 0}
												onClick={() => vm.move(index, -1)}
											>
												<ArrowUp className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Move ${gate?.name ?? item.gateId} down`}
												disabled={index === vm.instructions.length - 1}
												onClick={() => vm.move(index, 1)}
											>
												<ArrowDown className="h-4 w-4" />
											</Button>
										</div>
									</div>
									<Label htmlFor={`policy-${index}`} className="text-xs">
										Meaning and human action instructions
									</Label>
									<InputArea
										id={`policy-${index}`}
										value={item.description}
										maxLength={4000}
										rows={2}
										onChange={(e) => vm.describe(item.gateId, e.target.value)}
										placeholder="Explain expected behavior and when a person should act."
									/>
								</LayerCard>
							</li>
						);
					})}
				</ol>
				<div className="flex flex-wrap gap-2">
					<Button disabled={!vm.dirty} onClick={() => void vm.save()}>
						{vm.busy ? "Saving…" : "Save policy instructions"}
					</Button>
					<Button variant="outline" disabled={!vm.dirty} onClick={vm.discard}>
						Discard
					</Button>
					{scope.repositoryId && !page?.inherited && (
						<Button variant="ghost" onClick={() => void vm.save(true)}>
							Use project instructions
						</Button>
					)}
				</div>
			</fieldset>
		</div>
	);
}
