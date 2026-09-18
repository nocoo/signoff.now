import {
	Badge,
	Button,
	Checkbox,
	Field,
	Input,
	LayerCard,
	SegmentControl,
} from "@nocoo/basalt";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { type Project, pullUrl } from "@signoff/domain/workbench";
import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Eye,
	EyeOff,
	GitPullRequest,
	ListOrdered,
	LoaderCircle,
	ScanLine,
	Search,
	ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import { relativeAge } from "@/models/freshness";
import {
	DEFAULT_PULL_FILTER,
	nextPullSort,
	type PullFilter,
	type PullRow,
} from "@/models/workbench";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullDetailSheet } from "./PullDetailSheet";
import { ReadinessDialog } from "./ReadinessDialog";
import { RepositoryFilters, RepositoryScopeLinks } from "./RepositoryFilters";
import { WorkbenchConnection, WorkbenchFeedback } from "./WorkbenchControls";
import { ReadinessBadge, StageBar, StageLegend } from "./WorkbenchStatus";

export function PullsPage() {
	const vm = useWorkbench();
	const now = useMinuteNow();
	const opener = useRef<HTMLElement | null>(null);
	const [readinessProject, setReadinessProject] = useState<Project | null>(
		null,
	);

	const scopedProject = vm.projectOptions.find(
		({ project }) => project.id === vm.filter.projectId,
	)?.project;
	const repository = vm.selectedRepository;
	const scopeProject =
		repository?.project ??
		scopedProject ??
		(vm.filter.organization ? vm.projectOptions[0]?.project : undefined);
	const metrics = [
		{
			key: "all",
			label: "Open PRs",
			value: vm.metrics.open,
			detail:
				vm.filter.draft === "exclude"
					? "Drafts excluded"
					: vm.filter.draft === "only"
						? "Drafts only"
						: `${vm.metrics.draft} drafts included`,
			Icon: GitPullRequest,
			color: "text-basalt-primary",
		},
		{
			key: "attention",
			label: "Need attention",
			value: vm.metrics.attention,
			detail: "Blockers, approvals & reviews",
			Icon: ShieldAlert,
			color: "text-basalt-warning",
		},
		{
			key: "running",
			label: "In progress",
			value: vm.metrics.running,
			detail: "Builds running or queued",
			Icon: LoaderCircle,
			color: "text-basalt-primary",
		},
		{
			key: "ready",
			label: "Ready to merge",
			value: vm.metrics.ready,
			detail: "Required gates are clear",
			Icon: CheckCheck,
			color: "text-basalt-heatmap-green-4",
		},
	] as const;
	return (
		<div className="space-y-2">
			<PageHeader
				title="Pull requests"
				description={
					<span className="break-words">
						{scopeProject ? (
							<RepositoryScopeLinks
								project={scopeProject}
								repository={repository?.name}
								organizationOnly={!scopedProject && !repository}
							/>
						) : (
							vm.filter.organization ||
							`Across ${vm.repositories.length} repositories · Checks, blockers, and next steps`
						)}
					</span>
				}
				actions={<WorkbenchConnection vm={vm} compact />}
			/>
			<WorkbenchFeedback vm={vm} />
			<RepositoryFilters vm={vm} />
			{vm.catalogError ? (
				<p role="alert" className="px-1 text-xs text-basalt-warning">
					Repository filters could not refresh. PR results remain available.
				</p>
			) : null}
			<PendingWatchList vm={vm} />

			<LayerCard padding="none">
				<LayerCard.Header className="flex-col gap-2 p-3">
					<section
						className="grid w-full grid-cols-2 gap-2 xl:grid-cols-4"
						aria-label="Pull request overview"
					>
						{metrics.map(({ key, label, value, detail, Icon, color }) => {
							const selected =
								vm.filter.state === "open" && vm.filter.status === key;
							return (
								<LayerCard
									padding="none"
									key={key}
									className={cn(
										"border border-transparent transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-basalt-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-basalt-card",
										selected && "border-basalt-primary/40",
									)}
								>
									<Button
										variant="ghost"
										aria-pressed={selected}
										className={cn(
											"h-full w-full flex-col items-start justify-start gap-1 whitespace-normal rounded-none px-3 py-2 text-left text-basalt-foreground hover:bg-basalt-primary/3 hover:text-basalt-foreground focus-visible:ring-0 focus-visible:ring-offset-0",
											selected &&
												"bg-basalt-primary/5 hover:bg-basalt-primary/5",
										)}
										onClick={() => vm.setFilter({ state: "open", status: key })}
									>
										<span className="flex w-full items-center gap-2 text-xs font-medium text-basalt-muted-foreground">
											<Icon
												className={cn("h-4 w-4 shrink-0", color)}
												aria-hidden
												strokeWidth={1.6}
											/>
											{label}
											<span className="ml-auto text-xl font-semibold tabular-nums leading-none tracking-tight text-basalt-foreground">
												{vm.loading ? "—" : value.toLocaleString()}
											</span>
										</span>
										<span className="text-[11px] font-normal text-basalt-muted-foreground">
											{detail}
										</span>
									</Button>
								</LayerCard>
							);
						})}
					</section>
					<search
						aria-label="Filter pull requests"
						className="grid w-full grid-cols-2 items-start gap-3 xl:grid-cols-[minmax(180px,1.4fr)_1fr_170px_1.2fr]"
					>
						<Field label="Search PRs">
							<div className="relative">
								<Search
									className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2"
									aria-hidden
								/>
								<Input
									aria-label="Search PRs"
									className="pl-9"
									placeholder="Title, #number, author…"
									value={vm.filter.query}
									onChange={(event) =>
										vm.setFilter({ query: event.target.value })
									}
								/>
							</div>
						</Field>
						<Field label="Readiness">
							<SelectControl
								value={vm.filter.status}
								onChange={(status) =>
									vm.setFilter({ status: status as PullFilter["status"] })
								}
							>
								<option value="all">All readiness</option>
								<option value="attention">Need attention</option>
								<option value="blocked">Blocked</option>
								<option value="approval">Awaiting approval</option>
								<option value="review">Review needed</option>
								<option value="running">In progress</option>
								<option value="unknown">Unknown / incomplete</option>
								<option value="ready">Ready to merge</option>
								<option value="merged">Merged</option>
								<option value="closed">Closed</option>
							</SelectControl>
						</Field>
						<Field label="Draft">
							<SelectControl
								value={vm.filter.draft}
								onChange={(draft) =>
									vm.setFilter({ draft: draft as PullFilter["draft"] })
								}
							>
								<option value="exclude">Exclude drafts</option>
								<option value="include">Include drafts</option>
								<option value="only">Drafts only</option>
							</SelectControl>
						</Field>
						<div className="relative">
							<Field label="Authors">
								<MultiSelect
									label="Authors"
									placeholder="All authors"
									showChips={false}
									searchPlaceholder="Find authors…"
									value={vm.filter.authors}
									onValueChange={(authors) => vm.setFilter({ authors })}
									options={vm.authors.map((author) => ({
										value: author.id,
										label: author.name,
										description: vm.authors.some(
											(other) =>
												other.id !== author.id && other.name === author.name,
										)
											? author.id
											: undefined,
										leading: (
											<span aria-hidden>
												<EntityAvatar name={author.name} size="sm" />
											</span>
										),
									}))}
								/>
							</Field>
							{vm.filter.authors.length ? (
								<Button
									variant="link"
									size="sm"
									className="absolute top-0 right-0 h-5 p-0 text-[11px]"
									aria-label="Clear author filter"
									onClick={() => vm.setFilter({ authors: [] })}
								>
									Clear
								</Button>
							) : null}
						</div>
					</search>
					<WatchToolbar vm={vm} />
					<div className="flex w-full flex-wrap items-end justify-between gap-3">
						<SegmentControl
							legend="PR state"
							className="[&>legend]:sr-only [&_[data-slot=segment-control-viewport]]:pb-0"
							value={vm.filter.state}
							onValueChange={(state) =>
								vm.setFilter({
									state: state as PullFilter["state"],
									status: "all",
								})
							}
							options={[
								{ value: "open", label: `Open ${vm.metrics.open}` },
								{ value: "merged", label: `Merged ${vm.metrics.merged}` },
								{ value: "closed", label: `Closed ${vm.metrics.closed}` },
								{ value: "all", label: "All" },
							]}
						/>
						<div className="flex items-center gap-3 text-xs">
							<span aria-live="polite" className="tabular-nums">
								{vm.pullsLoaded
									? `${vm.total} results`
									: vm.loading
										? "Loading…"
										: "Results unavailable"}
							</span>
							{scopedProject ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={(event) => {
										opener.current = event.currentTarget;
										vm.clearMutationError();
										setReadinessProject(scopedProject);
									}}
								>
									<ListOrdered className="h-3.5 w-3.5" aria-hidden />
									Readiness order
								</Button>
							) : (
								<Button asChild variant="ghost" size="sm">
									<Link to="/projects">
										<ListOrdered className="h-3.5 w-3.5" aria-hidden />
										Readiness order
									</Link>
								</Button>
							)}
						</div>
					</div>
				</LayerCard.Header>
				{vm.loading ? (
					<LayerCard.Loading label="Loading pull requests" />
				) : !vm.pullsLoaded ? (
					<EmptyState
						icon={GitPullRequest}
						title="Unable to load pull requests"
						description="Your project data could not be loaded."
						action={
							<Button variant="outline" onClick={() => void vm.reload()}>
								Try again
							</Button>
						}
					/>
				) : vm.total === 0 ? (
					<EmptyState
						icon={GitPullRequest}
						title={
							vm.projects.length
								? "No matching pull requests"
								: "Your review queue starts here"
						}
						description={
							vm.projects.length
								? "Change your filters, or use Discover PRs to load candidates. Select the PRs you want to watch."
								: "Add an Azure DevOps project, then use Discover PRs to load candidates."
						}
						action={
							vm.projects.length ? (
								<Button
									variant="outline"
									onClick={() =>
										vm.setFilter({
											...DEFAULT_PULL_FILTER,
											source: vm.filter.source,
										})
									}
								>
									Clear filters
								</Button>
							) : (
								<Button asChild>
									<Link to="/projects">
										Manage projects
										<ArrowRight className="h-4 w-4" aria-hidden />
									</Link>
								</Button>
							)
						}
					/>
				) : (
					<div className="overflow-x-auto">
						<Table
							aria-label="Pull requests"
							className="min-w-[960px] table-fixed"
						>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10">
										<PageSelectionCheckbox vm={vm} />
									</TableHead>
									<TableHead className="w-12 px-1 text-center">
										<span className="sr-only">Watch list</span>
										<Eye aria-hidden className="mx-auto h-3.5 w-3.5" />
									</TableHead>
									{(
										[
											["title", "Pull request", "w-[32%]"],
											["readiness", "Readiness", "w-[15%]"],
											["progress", "Checks & stages", "w-[18%]"],
											["action", "Next action", "w-[21%]"],
											["updated", "PR updated", "w-[14%] text-right"],
										] as const
									).map(([sort, label, className]) => (
										<SortableHead
											key={sort}
											sort={sort}
											label={label}
											className={className}
											filter={vm.filter}
											onSort={() => vm.setFilter(nextPullSort(vm.filter, sort))}
										/>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{vm.pageRows.map((row) => (
									<PullTableRow
										key={row.pull.id}
										row={row}
										vm={vm}
										now={now}
										onOpen={(element) => {
											opener.current = element;
											vm.selectPull(row.pull.id);
										}}
									/>
								))}
							</TableBody>
						</Table>
					</div>
				)}
				<PullPagination vm={vm} />
			</LayerCard>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<StageLegend />
				<p className="text-xs text-basalt-muted-foreground">
					Readiness includes required checks, reviews, and merge conflicts.
				</p>
			</div>
			<PullDetailSheet
				row={vm.selected}
				missing={vm.missingSelection}
				onClose={() => vm.selectPull(null)}
				returnFocus={opener}
				onScan={() => {
					if (vm.selected) void vm.refreshPull(vm.selected.pull.id);
				}}
				canScan={Boolean(vm.selected?.observation?.active)}
				onToggleWatch={() => void vm.toggleWatch()}
				loading={vm.detailLoading}
				error={vm.detailError}
				onRetry={() => void vm.reloadDetail()}
				refreshing={vm.detailRefreshing}
				busy={Boolean(vm.busy)}
			/>
			{readinessProject ? (
				<ReadinessDialog
					project={readinessProject}
					pulls={vm.data?.pullRequests ?? []}
					busy={vm.busy}
					error={vm.mutationError}
					onSave={(rules) => vm.saveReadiness(readinessProject, rules)}
					onClose={() => setReadinessProject(null)}
					restoreFocus={() => opener.current?.focus()}
				/>
			) : null}
		</div>
	);
}

function SortableHead({
	sort,
	label,
	className,
	filter,
	onSort,
}: {
	sort: PullFilter["sort"];
	label: string;
	className: string;
	filter: PullFilter;
	onSort: () => void;
}) {
	const active = filter.sort === sort;
	const Icon = active
		? filter.sortDirection === "asc"
			? ArrowUp
			: ArrowDown
		: ArrowUpDown;
	return (
		<TableHead
			className={className}
			aria-sort={
				active
					? filter.sortDirection === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Sort by ${label}`}
				onClick={onSort}
				className={cn(
					"h-8 gap-1 px-0 text-xs hover:bg-transparent",
					active && "text-basalt-foreground",
				)}
			>
				{label}
				<Icon className="h-3 w-3 shrink-0" aria-hidden />
			</Button>
		</TableHead>
	);
}

function PullSourceLink({ pull, project }: Pick<PullRow, "pull" | "project">) {
	if (project.source !== "cli") return null;
	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className="h-5 w-5 shrink-0 text-basalt-muted-foreground"
		>
			<a
				href={pullUrl(project, pull)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open PR #${pull.number} in ${project.provider === "ado" ? "Azure DevOps" : "GitHub"} (new tab)`}
				title="Open source PR in a new tab"
			>
				<ExternalLink className="h-3.5 w-3.5" aria-hidden />
			</a>
		</Button>
	);
}

function WatchToolbar({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	return (
		<div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-basalt-border/60 pt-2">
			<div className="flex flex-wrap items-center gap-2">
				<SelectControl
					aria-label="Watch list filter"
					value={vm.filter.watching}
					onChange={(watching) =>
						vm.setFilter({ watching: watching as PullFilter["watching"] })
					}
					className="h-8 w-40 text-xs"
				>
					<option value="all">All candidates</option>
					<option value="watching">
						Watching ({vm.collector?.watching ?? 0})
					</option>
					<option value="unwatched">Not watching</option>
				</SelectControl>
				<span className="text-xs tabular-nums text-basalt-muted-foreground">
					{vm.selectedCount
						? `${vm.selectedCount} selected`
						: "Select PRs to watch"}
				</span>
				{vm.selectedCount > 0 ? (
					<>
						<Button
							size="sm"
							disabled={
								Boolean(vm.busy) ||
								!vm.selectionItems.some((item) => !item.observation?.active)
							}
							onClick={() => void vm.watchSelected(true)}
						>
							<Eye aria-hidden className="h-3.5 w-3.5" />
							Add to watch list
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={
								Boolean(vm.busy) ||
								!vm.selectionItems.some((item) => item.observation?.active)
							}
							onClick={() => void vm.watchSelected(false)}
						>
							<EyeOff aria-hidden className="h-3.5 w-3.5" />
							Remove from watch list
						</Button>
					</>
				) : null}
			</div>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					disabled={Boolean(vm.busy) || !vm.collector?.watching}
					onClick={() => void vm.refreshPull()}
				>
					Refresh watched
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={Boolean(vm.busy) || !vm.projects.length}
					onClick={() =>
						void (vm.selectedRepository
							? vm.discoverRepo()
							: vm.scan(vm.filter.projectId || undefined))
					}
				>
					<ScanLine aria-hidden className="h-3.5 w-3.5" />
					Discover PRs
				</Button>
			</div>
		</div>
	);
}

function PullTableRow({
	row,
	vm,
	now,
	onOpen,
}: {
	row: PullRow;
	vm: ReturnType<typeof useWorkbench>;
	now: number;
	onOpen: (element: HTMLButtonElement) => void;
}) {
	const { pull, project, readiness, progress, observation } = row;
	return (
		<TableRow
			data-pull-id={pull.id}
			className={cn(
				"group",
				vm.selectedIds.has(pull.id) && "bg-basalt-primary/4",
			)}
		>
			<TableCell className="w-10 py-4 align-top">
				<Checkbox
					aria-label={`Select PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
					checked={vm.selectedIds.has(pull.id)}
					disabled={
						(pull.state !== "open" && !observation?.active) || Boolean(vm.busy)
					}
					onCheckedChange={(checked) =>
						vm.toggleSelection(pull.id, checked === true)
					}
				/>
			</TableCell>
			<TableCell className="w-12 px-1 py-3 align-top text-center">
				<Button
					variant="ghost"
					size="icon"
					className={cn(
						"h-8 w-8",
						observation?.active
							? "bg-basalt-primary/10 text-basalt-primary hover:bg-basalt-primary/15 hover:text-basalt-primary"
							: "text-basalt-muted-foreground hover:bg-basalt-muted hover:text-basalt-foreground",
					)}
					aria-label={`Watch PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
					aria-pressed={Boolean(observation?.active)}
					title={
						observation?.active
							? "In watch list · Click to remove"
							: pull.state === "open"
								? "Not in watch list · Click to watch"
								: "Completed PRs are no longer watched"
					}
					disabled={
						Boolean(vm.busy) || (pull.state !== "open" && !observation?.active)
					}
					onClick={() => void vm.toggleWatch(pull.id)}
				>
					{observation?.active ? (
						<Eye aria-hidden className="h-4 w-4" />
					) : (
						<EyeOff aria-hidden className="h-4 w-4" />
					)}
				</Button>
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<div className="flex items-start gap-1.5">
					<Button
						variant="link"
						className="h-auto min-w-0 justify-start whitespace-normal p-0 text-left text-[13px] font-semibold leading-5 text-basalt-foreground"
						aria-label={`Open PR #${pull.number}: ${pull.title}`}
						onClick={(event) => {
							onOpen(event.currentTarget);
						}}
					>
						{pull.title}
					</Button>
					<PullSourceLink pull={pull} project={project} />
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-basalt-muted-foreground">
					<a
						href={pullUrl(project, pull)}
						target="_blank"
						rel="noopener noreferrer"
						title={`Open PR #${pull.number} in ${project.provider === "ado" ? "Azure DevOps" : "GitHub"} (new tab)`}
						className="rounded-sm font-mono text-basalt-foreground/75 underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring"
					>
						#{pull.number}
					</a>
					<span aria-hidden>·</span>
					<span>
						<RepositoryScopeLinks
							project={project}
							repository={pull.repository.name}
						/>
					</span>
				</div>
				<div className="mt-1 flex items-center text-[11px] text-basalt-muted-foreground">
					<EntityLabel
						name={pull.author.name}
						avatarUrl={pull.author.avatarUrl}
						size="xs"
					/>
					{pull.labels.includes("release blocker") ? (
						<Badge variant="error" className="ml-2 px-1.5 py-0 text-[9px]">
							release blocker
						</Badge>
					) : null}
				</div>
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<ReadinessBadge readiness={readiness} project={project} />
				{readiness.issues.length > 1 ? (
					<p className="mt-1.5 text-[11px] text-basalt-muted-foreground">
						+{readiness.issues.length - 1} pending item
						{readiness.issues.length > 2 ? "s" : ""}
					</p>
				) : null}
			</TableCell>
			<TableCell className="py-3.5 align-top">
				{pull.checksObservedAt === null ? (
					<div className="space-y-1 text-xs text-basalt-muted-foreground">
						<p>Checks not collected</p>
						<p className="text-[11px]">Add to watch list to collect checks</p>
					</div>
				) : (
					<>
						<div className="mb-2 flex items-baseline justify-between gap-1 text-xs">
							<span className="font-medium tabular-nums">
								{progress.checksPassed}/{progress.checksTotal} required
							</span>
							<span className="text-[11px] text-basalt-muted-foreground">
								{pull.builds.length} builds
							</span>
						</div>
						<StageBar builds={pull.builds} />
						<p className="mt-1.5 text-[11px] text-basalt-muted-foreground">
							{progress.stagesPassed}/{progress.stagesTotal} stages passed
							{progress.optionalFailures
								? ` · ${progress.optionalFailures} advisory`
								: ""}
						</p>
						{typeof pull.checksObservedAt === "number" ? (
							<p className="mt-1 text-[11px] text-basalt-muted-foreground">
								Checks synced{" "}
								<time
									dateTime={new Date(
										pull.checksObservedAt * 1000,
									).toISOString()}
									title={`SignOff collected checks: ${new Date(pull.checksObservedAt * 1000).toLocaleString()}`}
								>
									{relativeAge(pull.checksObservedAt, now)}
								</time>
							</p>
						) : null}
					</>
				)}
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<p className="text-xs leading-5">{readiness.action}</p>
				<EntityLabel
					name={readiness.owner}
					size="xs"
					className="mt-1 text-[11px] text-basalt-muted-foreground"
				/>
			</TableCell>
			<TableCell className="py-3.5 align-top text-right text-[11px] whitespace-nowrap text-basalt-muted-foreground">
				<time
					dateTime={new Date(pull.updatedAt * 1000).toISOString()}
					title={new Date(pull.updatedAt * 1000).toLocaleString()}
				>
					{relativeAge(pull.updatedAt, now)}
				</time>
				<p className="mt-1.5">
					Synced{" "}
					<time
						dateTime={new Date(pull.observedAt * 1000).toISOString()}
						title={`SignOff collected PR data: ${new Date(pull.observedAt * 1000).toLocaleString()}`}
					>
						{relativeAge(pull.observedAt, now)}
					</time>
				</p>
			</TableCell>
		</TableRow>
	);
}

function PullPagination({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	if (vm.total === 0 && vm.page <= 1) return null;
	return (
		<LayerCard.Footer className="justify-between">
			<p className="text-xs text-basalt-muted-foreground">
				{vm.pullsLoaded
					? `${(vm.page - 1) * vm.pageSize + 1}–${Math.min(vm.page * vm.pageSize, vm.total)} of ${vm.total} pull requests`
					: vm.loading
						? "Loading pull requests…"
						: "Result count unavailable"}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					className="h-7 w-7"
					aria-label="Previous page"
					disabled={vm.page <= 1}
					onClick={() => vm.setPage(vm.page - 1)}
				>
					<ChevronLeft aria-hidden className="h-4 w-4" />
				</Button>
				<span className="text-xs tabular-nums">
					{vm.pullsLoaded ? `${vm.page} / ${vm.pageCount}` : `Page ${vm.page}`}
				</span>
				<Button
					variant="outline"
					size="icon"
					className="h-7 w-7"
					aria-label="Next page"
					disabled={!vm.pullsLoaded || vm.page >= vm.pageCount}
					onClick={() => vm.setPage(vm.page + 1)}
				>
					<ChevronRight aria-hidden className="h-4 w-4" />
				</Button>
			</div>
		</LayerCard.Footer>
	);
}

function PendingWatchList({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	if (
		vm.filter.watching !== "watching" ||
		(!vm.pendingLoading && !vm.pendingError && vm.pendingTotal === 0)
	)
		return null;
	return (
		<LayerCard padding="none" role="region" aria-label="Pending watches">
			<LayerCard.Header className="justify-between gap-3">
				<span className="text-sm font-medium">
					{vm.pendingTotal
						? `${vm.pendingTotal} watched PRs awaiting their first result`
						: "Watched PRs awaiting their first result"}
				</span>
				<Button
					variant="ghost"
					size="sm"
					disabled={vm.pendingRefreshing}
					aria-label="Retry pending watches"
					onClick={() => void vm.reloadPending()}
				>
					{vm.pendingError ? "Retry" : "Refresh"}
				</Button>
			</LayerCard.Header>
			<LayerCard.Body className="space-y-2">
				{vm.pendingError ? (
					<AlertBanner variant="error">
						{vm.pendingError}
						{vm.pendingObservations.length
							? " Showing the last available watch list."
							: ""}
					</AlertBanner>
				) : null}
				{vm.pendingLoading ? (
					<LayerCard.Loading label="Loading pending watches" />
				) : null}
				{vm.pendingObservations.map((item) => (
					<div
						key={item.id}
						className="flex items-center justify-between gap-3 text-xs"
					>
						<a
							href={item.ref.url}
							target="_blank"
							rel="noopener noreferrer"
							className="break-all hover:underline"
						>
							{item.ref.organization} / {item.ref.projectKey} /{" "}
							{item.ref.repository.name} #{item.ref.number}
						</a>
						<Button
							size="sm"
							variant="ghost"
							disabled={Boolean(vm.busy)}
							onClick={() => void vm.removePending(item)}
						>
							Remove
						</Button>
					</div>
				))}
			</LayerCard.Body>
			{vm.pendingPageCount > 1 || vm.pendingPage > 1 ? (
				<LayerCard.Footer className="justify-between gap-3">
					<p className="text-xs text-basalt-muted-foreground">
						{vm.pendingLoaded
							? `${vm.pendingTotal} pending watches`
							: vm.pendingLoading
								? "Loading pending watches…"
								: "Pending count unavailable"}
					</p>
					<div className="flex items-center gap-2">
						<Button
							size="icon"
							variant="outline"
							className="h-7 w-7"
							aria-label="Previous pending page"
							disabled={vm.pendingPage <= 1}
							onClick={() => vm.setPendingPage(vm.pendingPage - 1)}
						>
							<ChevronLeft className="h-4 w-4" aria-hidden />
						</Button>
						<span className="text-xs tabular-nums">
							{vm.pendingLoaded
								? `${vm.pendingPage} / ${vm.pendingPageCount}`
								: `Page ${vm.pendingPage}`}
						</span>
						<Button
							size="icon"
							variant="outline"
							className="h-7 w-7"
							aria-label="Next pending page"
							disabled={
								!vm.pendingLoaded ||
								vm.pendingPage >= vm.pendingPageCount ||
								vm.pendingRefreshing
							}
							onClick={() => vm.setPendingPage(vm.pendingPage + 1)}
						>
							<ChevronRight className="h-4 w-4" aria-hidden />
						</Button>
					</div>
				</LayerCard.Footer>
			) : null}
		</LayerCard>
	);
}

function PageSelectionCheckbox({
	vm,
}: {
	vm: ReturnType<typeof useWorkbench>;
}) {
	return (
		<Checkbox
			aria-label="Select all eligible PRs on this page"
			checked={
				vm.selectedCount > 0 && vm.selectedCount === vm.selectableCount
					? true
					: vm.selectedCount > 0
						? "indeterminate"
						: false
			}
			disabled={!vm.selectableCount || Boolean(vm.busy)}
			onCheckedChange={(checked) => vm.selectPage(checked === true)}
		/>
	);
}
