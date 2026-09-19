import {
	Badge,
	Button,
	Checkbox,
	Field,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { pullUrl, repositoryBranchUrl } from "@signoff/domain/workbench";
import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Eye,
	EyeOff,
	GitBranch,
	GitPullRequest,
	ListOrdered,
	ScanLine,
	Search,
} from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { SelectControl } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { relativeAge } from "@/models/freshness";
import {
	DEFAULT_PULL_FILTER,
	nextPullSort,
	type PullFilter,
	type PullRow,
} from "@/models/workbench";
import { machineHref } from "@/models/workspaceLocation";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullDetailSheet } from "./PullDetailSheet";
import { PullQuickFilters } from "./PullQuickFilters";
import { RepositoryFilters, RepositoryScopeLinks } from "./RepositoryFilters";
import { WorkbenchFeedback } from "./WorkbenchControls";
import { ReadinessBadge, StageBar, StageLegend } from "./WorkbenchStatus";

export function PullsPage() {
	const vm = useWorkbench();
	const now = useMinuteNow();
	const opener = useRef<HTMLElement | null>(null);

	const scopedProject = vm.projectOptions.find(
		({ project }) => project.id === vm.filter.projectId,
	)?.project;
	const repository = vm.selectedRepository;
	const scopeProject =
		repository?.project ??
		scopedProject ??
		(vm.filter.organization ? vm.projectOptions[0]?.project : undefined);

	return (
		<div className="space-y-2">
			<PageHeader
				title="Pull requests"
				description="Track review progress, checks, and merge blockers."
			/>
			<WorkbenchFeedback vm={vm} />
			<SectionRule
				title="Filters"
				className="space-y-2"
				actions={
					<span className="max-w-full truncate text-xs text-basalt-muted-foreground">
						{scopeProject ? (
							<RepositoryScopeLinks
								project={scopeProject}
								repository={
									repository
										? {
												id: repository.identityResolved ? repository.id : null,
												name: repository.name,
											}
										: undefined
								}
								organizationOnly={!scopedProject && !repository}
							/>
						) : (
							`${vm.repositories.length} repositories`
						)}
					</span>
				}
			>
				<LayerCard
					padding="sm"
					role="region"
					aria-label="PR filters"
					className="space-y-2.5"
				>
					<RepositoryFilters vm={vm} />
					{vm.catalogError ? (
						<p role="alert" className="text-xs text-basalt-warning">
							Repository filters could not refresh. PR results remain available.
						</p>
					) : null}
					<search
						aria-label="Filter pull requests"
						className="grid w-full grid-cols-2 items-start gap-3 xl:grid-cols-[minmax(180px,1.4fr)_170px_1.2fr]"
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
					<PullQuickFilters vm={vm} />
				</LayerCard>
			</SectionRule>
			<SectionRule
				title={
					<span aria-live="polite" className="tabular-nums">
						{vm.pullsLoaded
							? `${vm.total} results`
							: vm.loading
								? "Loading…"
								: "Results unavailable"}
					</span>
				}
				className="space-y-2"
				actions={
					<>
						<Button asChild variant="ghost" size="sm">
							<Link
								to={
									scopeProject
										? machineHref(
												scopeProject,
												repository?.identityResolved ? repository : null,
												null,
												new URLSearchParams({ tab: "priority" }),
											)
										: `/sm?source=${vm.filter.source === "demo" ? "sample" : "live"}&tab=priority`
								}
							>
								<ListOrdered className="h-3.5 w-3.5" aria-hidden />
								Readiness order
							</Link>
						</Button>
						<CollectionActions vm={vm} />
					</>
				}
			>
				<PendingWatchList vm={vm} />
				<LayerCard padding="none" role="region" aria-label="PR results">
					<LayerCard.Header className="px-3 py-0.5">
						<WatchToolbar vm={vm} />
						{vm.loading ? (
							<span role="status" className="sr-only">
								Loading pull requests
							</span>
						) : null}
					</LayerCard.Header>
					{!vm.loading && !vm.pullsLoaded ? (
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
					) : !vm.loading && vm.total === 0 ? (
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
								aria-busy={vm.loading}
								className="min-w-[1100px] table-fixed"
							>
								<TableHeader>
									<TableRow>
										<TableHead className="w-10 px-2 text-center">
											<div className="flex items-center justify-center">
												<PageSelectionCheckbox vm={vm} />
											</div>
										</TableHead>
										<TableHead className="w-12 px-1 text-center">
											<span className="sr-only">Watch list</span>
											<Eye aria-hidden className="mx-auto h-3.5 w-3.5" />
										</TableHead>
										<SortableHead
											sort="title"
											label="Pull request"
											className="w-[clamp(240px,20vw,400px)]"
											filter={vm.filter}
											disabled={vm.loading}
											onSort={() =>
												vm.setFilter(nextPullSort(vm.filter, "title"))
											}
										/>
										<TableHead className="w-32">Target branch</TableHead>
										{(
											[
												["readiness", "Readiness", "w-40"],
												["progress", "Checks & stages", ""],
												["action", "Next action", ""],
												["updated", "PR updated", "w-28 text-right"],
											] as const
										).map(([sort, label, className]) => (
											<SortableHead
												key={sort}
												sort={sort}
												label={label}
												className={className}
												filter={vm.filter}
												disabled={vm.loading}
												onSort={() =>
													vm.setFilter(nextPullSort(vm.filter, sort))
												}
											/>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{vm.loading ? (
										<PullTableSkeleton />
									) : (
										vm.pageRows.map((row) => (
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
										))
									)}
								</TableBody>
							</Table>
						</div>
					)}
					<PullPagination vm={vm} />
				</LayerCard>
			</SectionRule>
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
				canScan={
					Boolean(vm.selected?.observation?.active) &&
					!vm.selected?.watchPending
				}
				onToggleWatch={() => void vm.toggleWatch()}
				loading={vm.detailLoading}
				error={vm.detailError}
				onRetry={() => void vm.reloadDetail()}
				refreshing={vm.detailRefreshing}
				busy={Boolean(vm.busy)}
			/>
		</div>
	);
}

function PullTableSkeleton() {
	return [1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
		<TableRow key={row} aria-hidden="true" className="pointer-events-none">
			<TableCell className="px-2 py-3.5 align-middle">
				<Skeleton className="mx-auto h-4 w-4" />
			</TableCell>
			<TableCell className="px-1 py-3.5 align-middle">
				<Skeleton className="mx-auto h-5 w-5" />
			</TableCell>
			<TableCell className="py-3.5">
				<div className="space-y-2">
					<Skeleton
						className={cn("h-4", row % 3 === 0 ? "w-3/5" : "w-11/12")}
					/>
					<Skeleton className="h-2.5 w-3/4" />
					<div className="flex items-center gap-1.5">
						<Skeleton className="h-4 w-4 overflow-hidden rounded-full" />
						<Skeleton className="h-2.5 w-20" />
					</div>
				</div>
			</TableCell>
			<TableCell className="align-middle">
				<Skeleton className="h-3 w-20" />
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<Skeleton className="h-5 w-24" />
				<Skeleton className="mt-2 h-2.5 w-16" />
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<Skeleton className="mb-3 h-3 w-20" />
				<div className="grid grid-cols-6 gap-1">
					{[1, 2, 3, 4, 5, 6].map((stage) => (
						<Skeleton key={stage} className="h-1.5" />
					))}
				</div>
				<Skeleton className="mt-2 h-2.5 w-24" />
			</TableCell>
			<TableCell className="py-3.5 align-top">
				<Skeleton className="h-3 w-full" />
				<Skeleton className="mt-2 h-3 w-2/3" />
				<Skeleton className="mt-2 h-2.5 w-20" />
			</TableCell>
			<TableCell className="space-y-2 py-3.5 align-top">
				<Skeleton className="ml-auto h-2.5 w-12" />
				<Skeleton className="ml-auto h-2.5 w-16" />
				<Skeleton className="ml-auto h-2.5 w-20" />
			</TableCell>
		</TableRow>
	));
}

function SortableHead({
	sort,
	label,
	className,
	filter,
	disabled,
	onSort,
}: {
	sort: PullFilter["sort"];
	label: string;
	className: string;
	filter: PullFilter;
	disabled: boolean;
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
				disabled={disabled}
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

function CollectionActions({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	return (
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
	);
}

function WatchToolbar({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	return (
		<div className="flex min-h-6 w-full flex-wrap items-center gap-2">
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				<span className="text-xs tabular-nums text-basalt-muted-foreground">
					{vm.selectedCount
						? `${vm.selectedCount} selected`
						: "Select PRs to watch"}
				</span>
				{vm.selectedCount > 0 ? (
					<>
						<Button
							size="sm"
							className="h-6 px-2 text-[11px]"
							disabled={
								Boolean(vm.busy) ||
								!vm.selectionItems.some(
									(item) =>
										!item.observation?.active && !vm.watchPending(item.pullId),
								)
							}
							onClick={() => void vm.watchSelected(true)}
						>
							<Eye aria-hidden className="h-3.5 w-3.5" />
							Add to watch list
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="h-6 px-2 text-[11px]"
							disabled={
								Boolean(vm.busy) ||
								!vm.selectionItems.some(
									(item) =>
										item.observation?.active && !vm.watchPending(item.pullId),
								)
							}
							onClick={() => void vm.watchSelected(false)}
						>
							<EyeOff aria-hidden className="h-3.5 w-3.5" />
							Remove from watch list
						</Button>
					</>
				) : null}
				<span
					role="status"
					aria-label="Watch list updates"
					className={cn(
						"min-h-4 min-w-0 flex-1 truncate text-xs",
						vm.mutationError
							? "text-basalt-destructive"
							: "text-basalt-muted-foreground",
					)}
					title={
						vm.feedbackKind === "watch"
							? [vm.mutationError, vm.notice].filter(Boolean).join(" ")
							: undefined
					}
				>
					{vm.feedbackKind === "watch"
						? [vm.mutationError, vm.notice].filter(Boolean).join(" ")
						: null}
				</span>
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
	const watching = row.watching ?? Boolean(observation?.active);
	const stateAt = pull.summaryObservedAt ?? pull.observedAt;
	const checksAt =
		pull.checksObservedAt === null
			? null
			: (pull.checksObservedAt ?? pull.observedAt);
	return (
		<TableRow
			data-pull-id={pull.id}
			className={cn(
				"group",
				vm.selectedIds.has(pull.id) && "bg-basalt-primary/4",
			)}
		>
			<TableCell className="w-10 px-2 py-3.5 align-middle">
				<div className="flex items-center justify-center">
					<Checkbox
						aria-label={`Select PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
						checked={vm.selectedIds.has(pull.id)}
						disabled={
							(pull.state !== "open" && !observation?.active) ||
							Boolean(vm.busy)
						}
						onCheckedChange={(checked) =>
							vm.toggleSelection(pull.id, checked === true)
						}
					/>
				</div>
			</TableCell>
			<TableCell className="w-12 px-1 py-3.5 align-middle">
				<div className="flex items-center justify-center">
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"h-8 w-8",
							watching
								? "bg-basalt-primary/10 text-basalt-primary hover:bg-basalt-primary/15 hover:text-basalt-primary"
								: "text-basalt-muted-foreground hover:bg-basalt-muted hover:text-basalt-foreground",
						)}
						aria-label={`Watch PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
						aria-pressed={watching}
						aria-busy={Boolean(row.watchPending)}
						title={
							row.watchPending
								? "Saving watch list change…"
								: watching
									? "In watch list · Click to remove"
									: pull.state === "open"
										? "Not in watch list · Click to watch"
										: "Completed PRs are no longer watched"
						}
						disabled={
							Boolean(vm.busy) ||
							row.watchPending ||
							(pull.state !== "open" && !observation?.active)
						}
						onClick={() => void vm.toggleWatch(pull.id)}
					>
						{watching ? (
							<Eye aria-hidden className="h-4 w-4" />
						) : (
							<EyeOff aria-hidden className="h-4 w-4" />
						)}
					</Button>
				</div>
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
							repository={pull.repository}
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
			<TableCell className="py-3.5 align-middle">
				<a
					href={repositoryBranchUrl(
						project,
						pull.repository,
						pull.targetBranch,
					)}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Open target branch ${pull.targetBranch} in ${project.projectKey}/${pull.repository.name} (new tab)`}
					title={`Target branch: ${pull.targetBranch} · Open in a new tab`}
					className="flex min-w-0 items-center gap-1.5 rounded-sm font-mono text-[11px] text-basalt-muted-foreground underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring"
				>
					<GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
					<span className="truncate">{pull.targetBranch}</span>
				</a>
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
					State{" "}
					<time
						dateTime={new Date(stateAt * 1000).toISOString()}
						title={`PR state checked: ${new Date(stateAt * 1000).toLocaleString()}`}
					>
						{relativeAge(stateAt, now)}
					</time>
				</p>
				<p
					className="mt-0.5"
					title="Policies, builds and stages have an independent refresh interval."
				>
					Checks{" "}
					{checksAt === null ? (
						<abbr
							title="Checks have not been collected"
							className="no-underline"
						>
							—
						</abbr>
					) : (
						<time
							dateTime={new Date(checksAt * 1000).toISOString()}
							title={`Checks collected: ${new Date(checksAt * 1000).toLocaleString()}${pull.checksInvalidated ? " · PR changed; checks need refreshing" : ""}`}
						>
							{pull.checksInvalidated ? "outdated" : relativeAge(checksAt, now)}
						</time>
					)}
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
			disabled={vm.loading || !vm.selectableCount || Boolean(vm.busy)}
			onCheckedChange={(checked) => vm.selectPage(checked === true)}
		/>
	);
}
