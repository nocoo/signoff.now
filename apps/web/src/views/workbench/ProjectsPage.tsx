import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Badge,
	Button,
	LayerCard,
} from "@nocoo/basalt";
import { SlotBarChart } from "@nocoo/basalt/charts/slot-bar";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { CollectionJob, Project } from "@signoff/domain/workbench";
import {
	ArrowUpRight,
	Boxes,
	Check,
	CircleAlert,
	FolderGit2,
	GitBranch,
	Pause,
	Pencil,
	Play,
	Plus,
	ScanLine,
	Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar } from "@/components/EntityAvatar";
import { heatmapColor } from "@/lib/palette";
import { relativeTime } from "@/models/workbench";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { ProjectDialog } from "./ProjectDialog";
import { WorkbenchConnection, WorkbenchFeedback } from "./WorkbenchControls";

export function ProjectsPage() {
	const vm = useWorkbench();
	const [editing, setEditing] = useState<Project | null | undefined>();
	const [removing, setRemoving] = useState<Project | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const restoreFocus = () =>
		(opener.current?.isConnected
			? opener.current
			: document.querySelector<HTMLElement>("main")
		)?.focus();
	return (
		<div className="space-y-5">
			<PageHeader
				title="Projects"
				description="Configure organizations, projects, and repository scopes."
				actions={
					<>
						<span className="text-xs text-basalt-muted-foreground">
							{vm.projects.filter(({ project }) => project.enabled).length}{" "}
							monitored
						</span>
						<Button
							size="sm"
							disabled={Boolean(vm.busy)}
							onClick={(event) => {
								opener.current = event.currentTarget;
								vm.clearMutationError();
								setEditing(null);
							}}
						>
							<Plus className="h-4 w-4" aria-hidden />
							Add project
						</Button>
					</>
				}
			/>
			<WorkbenchConnection vm={vm} />
			<WorkbenchFeedback vm={vm} />
			{vm.loading ? (
				<LayerCard>
					<LayerCard.Loading label="Loading projects" />
				</LayerCard>
			) : !vm.data ? (
				<LayerCard>
					<EmptyState
						icon={FolderGit2}
						title="Unable to load projects"
						action={
							<Button variant="outline" onClick={() => void vm.reload()}>
								Try again
							</Button>
						}
					/>
				</LayerCard>
			) : vm.projects.length === 0 ? (
				<LayerCard>
					<EmptyState
						icon={FolderGit2}
						title="Add your first project"
						description="Start with an Azure DevOps organization and project. GitHub support is planned."
						action={
							<Button
								onClick={(event) => {
									opener.current = event.currentTarget;
									setEditing(null);
								}}
							>
								Add project
							</Button>
						}
					/>
				</LayerCard>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					{vm.projects.map(({ project, metrics, repositories, total, job }) => {
						const states = [
							{
								count: metrics.attention,
								color: heatmapColor(3, "orange"),
								label: "Need attention",
							},
							{
								count: metrics.running,
								color: heatmapColor(3, "blue"),
								label: "In progress",
							},
							{
								count: metrics.ready,
								color: heatmapColor(3, "green"),
								label: "Ready to merge",
							},
							{
								count: metrics.draft,
								color: "bg-basalt-muted-foreground/20",
								label: "Draft",
							},
						];
						return (
							<LayerCard
								key={project.id}
								padding="none"
								aria-label={`${project.name} project`}
							>
								<LayerCard.Header className="items-center">
									<div className="flex min-w-0 items-center gap-3">
										<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-basalt-md bg-basalt-primary/10 text-basalt-primary">
											<Boxes
												className="h-5 w-5"
												aria-hidden
												strokeWidth={1.5}
											/>
										</span>
										<div className="min-w-0">
											<h2 className="font-semibold text-basalt-foreground">
												<Link
													className="hover:underline"
													to={`/?source=${project.source}&project=${encodeURIComponent(project.id)}`}
												>
													{project.name}
												</Link>
											</h2>
											<p className="mt-1 truncate text-[11px]">
												{project.organization} / {project.projectKey}
											</p>
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<Badge
											variant={
												project.provider === "ado" ? "info" : "secondary"
											}
										>
											{project.provider === "github" ? "GitHub" : "ADO"}
										</Badge>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`Edit ${project.name}`}
											disabled={Boolean(vm.busy) || project.provider !== "ado"}
											onClick={(event) => {
												opener.current = event.currentTarget;
												vm.clearMutationError();
												setEditing(project);
											}}
										>
											<Pencil className="h-3.5 w-3.5" aria-hidden />
										</Button>
									</div>
								</LayerCard.Header>
								<LayerCard.Body className="flex flex-1 flex-col gap-4">
									<p className="text-xs leading-5 text-basalt-muted-foreground">
										{project.description || "No description added."}
									</p>
									<p className="text-[11px] text-basalt-muted-foreground break-words">
										Scope:{" "}
										{project.repositories?.length
											? project.repositories.join(", ")
											: "All repositories"}
									</p>
									<div className="grid grid-cols-4 gap-2">
										{[
											{
												label: "Open",
												count: metrics.open,
												color: "text-basalt-foreground",
											},
											{
												label: "Attention",
												count: metrics.attention,
												color: "text-basalt-warning",
											},
											{
												label: "In progress",
												count: metrics.running,
												color: "text-basalt-primary",
											},
											{
												label: "Ready",
												count: metrics.ready,
												color: "text-basalt-heatmap-green-4",
											},
										].map((metric) => (
											<div key={metric.label}>
												<p
													className={`font-display text-2xl font-semibold tabular-nums ${metric.color}`}
												>
													{metric.count}
												</p>
												<p className="mt-1 text-[10px] text-basalt-muted-foreground">
													{metric.label}
												</p>
											</div>
										))}
									</div>
									<SlotBarChart
										items={states.flatMap((state) =>
											Array.from({ length: state.count }, () => ({
												color: state.color,
												label: state.label,
											})),
										)}
										ariaLabel={`${metrics.open} open PRs: ${metrics.attention} need attention, ${metrics.running} in progress, ${metrics.ready} ready, ${metrics.draft} drafts`}
										heightClass="h-1.5"
										gapClass="gap-0"
									/>
									<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-basalt-muted-foreground">
										<GitBranch className="mr-1 h-3.5 w-3.5" aria-hidden />
										{repositories.length ? (
											repositories.map((repository) => (
												<Button
													key={repository.key}
													variant="outline"
													size="sm"
													className="h-auto px-2 py-1 text-[11px] font-normal"
													asChild
												>
													<Link
														to={`/?${new URLSearchParams({ source: project.source, org: project.organization, project: project.id, repo: repository.id })}`}
													>
														{repository.name}
														{project.lastScannedAt !== null
															? ` · ${repository.metrics.open} open`
															: ""}
													</Link>
												</Button>
											))
										) : (
											<span>Repositories appear after the first scan</span>
										)}
									</div>
									<div className="mt-auto flex flex-wrap items-center justify-between gap-3 text-xs text-basalt-muted-foreground">
										<span className="flex items-center gap-2">
											<EntityAvatar name={project.owner} size="sm" />
											{project.owner}
										</span>
										<span>
											{total} PRs · {metrics.merged} merged
										</span>
									</div>
								</LayerCard.Body>
								<ProjectScanStatus project={project} job={job} />
								<LayerCard.Footer className="justify-between">
									<Button variant="ghost" size="sm" asChild>
										<Link
											to={`/?source=${project.source}&project=${encodeURIComponent(project.id)}`}
										>
											View PRs
											<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
										</Link>
									</Button>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`${project.enabled ? "Pause" : "Resume"} ${project.name}`}
											disabled={Boolean(vm.busy)}
											onClick={() => void vm.toggleMonitoring(project)}
										>
											{project.enabled ? (
												<Pause className="h-3.5 w-3.5" aria-hidden />
											) : (
												<Play className="h-3.5 w-3.5" aria-hidden />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-basalt-muted-foreground hover:text-basalt-destructive"
											aria-label={`Delete ${project.name}`}
											disabled={Boolean(vm.busy)}
											onClick={(event) => {
												opener.current = event.currentTarget;
												vm.clearMutationError();
												setRemoving(project);
											}}
										>
											<Trash2 className="h-3.5 w-3.5" aria-hidden />
										</Button>
										<Button
											variant="outline"
											size="sm"
											aria-label={`Scan ${project.name}`}
											disabled={Boolean(vm.busy) || !vm.canScan(project)}
											onClick={() => void vm.scan(project.id)}
										>
											<ScanLine className="h-3.5 w-3.5" aria-hidden />
											{vm.busy === project.id ? "Updating…" : "Scan"}
										</Button>
									</div>
								</LayerCard.Footer>
							</LayerCard>
						);
					})}
				</div>
			)}
			{vm.data?.scans.length ? (
				<LayerCard padding="none">
					<LayerCard.Header>
						<h2 className="text-sm font-semibold text-basalt-foreground">
							Recent scans
						</h2>
						<span className="text-xs">Latest project snapshots</span>
					</LayerCard.Header>
					<div className="divide-y divide-basalt-border">
						{vm.data.scans
							.filter((scan) => scan.source === vm.filter.source)
							.slice(0, 5)
							.map((scan) => (
								<div
									key={scan.id}
									className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
								>
									<div className="flex min-w-0 items-start gap-3">
										{scan.state === "complete" ? (
											<Check
												className="mt-0.5 h-4 w-4 shrink-0 text-basalt-heatmap-green-4"
												aria-hidden
											/>
										) : (
											<CircleAlert
												className="mt-0.5 h-4 w-4 shrink-0 text-basalt-warning"
												aria-hidden
											/>
										)}
										<div className="min-w-0">
											<p className="text-xs font-medium">
												{vm.data?.projects.find(
													(project) => project.id === scan.projectId,
												)?.name ?? "Removed project"}{" "}
												<span className="ml-1 font-normal text-basalt-muted-foreground">
													· {scan.pullRequestCount} PRs ·{" "}
													{scan.source === "demo" ? "simulated" : "CLI"}
												</span>
											</p>
											<p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
												{scan.message}
											</p>
										</div>
									</div>
									<span className="shrink-0 text-[11px] text-basalt-muted-foreground">
										{relativeTime(scan.completedAt)}
									</span>
								</div>
							))}
					</div>
				</LayerCard>
			) : null}
			<p className="text-xs text-basalt-muted-foreground">
				Live collection supports Azure DevOps. GitHub is available in Sample;
				live GitHub connections are planned.
			</p>
			{editing !== undefined ? (
				<ProjectDialog
					project={editing}
					busy={Boolean(vm.busy)}
					error={vm.mutationError}
					onSave={(draft) => vm.save(draft, editing)}
					onClose={() => setEditing(undefined)}
					restoreFocus={restoreFocus}
				/>
			) : null}
			<AlertDialog
				open={Boolean(removing)}
				onOpenChange={(open) => {
					if (!open && !vm.busy) setRemoving(null);
				}}
			>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						restoreFocus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove project?</AlertDialogTitle>
						<AlertDialogDescription className="break-words">
							Remove {removing?.name} and its saved PR snapshots from SignOff.
							The source project is unaffected.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{vm.mutationError ? (
						<AlertBanner variant="error" className="mt-4">
							{vm.mutationError}
						</AlertBanner>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={Boolean(vm.busy)}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={Boolean(vm.busy)}
							onClick={(event) => {
								event.preventDefault();
								if (removing)
									void vm.remove(removing).then((success) => {
										if (success) setRemoving(null);
									});
							}}
						>
							{vm.busy === "delete" ? "Removing…" : "Remove project"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function ProjectScanStatus({
	project,
	job,
}: {
	project: Project;
	job: CollectionJob | null;
}) {
	const labels = {
		never: "Awaiting first scan",
		complete: "Monitoring enabled",
		partial: "Partial scan",
		failed: "Scan failed",
	};
	const jobLabels = {
		queued: "Queued for collection",
		running: `Collecting ${job?.completedPulls ?? 0}${!job || job.totalPulls === null ? "" : ` / ${job.totalPulls}`} PRs`,
		auth_required: "Azure login required",
		failed: "Collection failed",
		complete: "Monitoring enabled",
		partial: "Partial scan",
	};
	const label = project.enabled
		? job
			? jobLabels[job.state]
			: labels[project.scanState]
		: "Monitoring paused";
	const Icon = !project.enabled
		? Pause
		: project.scanState === "complete"
			? Check
			: CircleAlert;
	return (
		<LayerCard.Well className="py-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-basalt-muted-foreground">
				<span className="inline-flex items-center gap-1.5">
					<Icon className="h-3.5 w-3.5" aria-hidden />
					{label}
				</span>
				<span>
					{project.lastScannedAt === null
						? "Never scanned"
						: `Scanned ${relativeTime(project.lastScannedAt)}`}
				</span>
			</div>
			{job?.message || project.scanMessage ? (
				<p
					className={`mt-2 text-xs leading-5 ${project.scanState === "partial" || job?.state === "failed" || job?.state === "auth_required" ? "text-basalt-warning" : "text-basalt-muted-foreground"}`}
				>
					{job?.message || project.scanMessage}
				</p>
			) : null}
		</LayerCard.Well>
	);
}
