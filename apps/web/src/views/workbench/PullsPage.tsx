import { Button, Checkbox, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	ArrowRight,
	ChevronLeft,
	ChevronRight,
	Eye,
	EyeOff,
	GitPullRequest,
	ListOrdered,
	ScanLine,
} from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { SERVICE_UNAVAILABLE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DEFAULT_PULL_FILTER, nextPullSort } from "@/models/workbench";
import { machineHref } from "@/models/workspaceLocation";
import { useAiScheduleViewModel } from "@/viewmodels/useAiScheduleViewModel";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PrCollectionMembershipProvider } from "../collections/PrCollectionMemberships";
import { PullDetailSheet } from "./PullDetailSheet";
import { PullFilters } from "./PullFilters";
import { PullList, PullListPagination } from "./PullList";
import { RepositoryFilters, RepositoryScopeLinks } from "./RepositoryFilters";
import { WorkbenchFeedback } from "./WorkbenchControls";
import { StageLegend } from "./WorkbenchStatus";

export function PullsPage() {
	const vm = useWorkbench();
	const aiSchedule = useAiScheduleViewModel(vm.filter.source);
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
		<PrCollectionMembershipProvider
			key={vm.filter.source}
			source={vm.filter.source}
			ids={vm.rows.map((row) => row.pull.id)}
		>
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
													id: repository.identityResolved
														? repository.id
														: null,
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
						{vm.catalogError && vm.catalogError !== SERVICE_UNAVAILABLE ? (
							<p role="alert" className="text-xs text-basalt-warning">
								Repository filters could not refresh. PR results remain
								available.
							</p>
						) : null}
						<PullFilters vm={vm} />
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
						{!vm.loading && (!vm.pullsLoaded || vm.total === 0) ? (
							<PullsEmptyState vm={vm} />
						) : (
							<PullList
								rows={vm.pageRows}
								loading={vm.loading}
								busy={Boolean(vm.busy)}
								sort={vm.filter}
								onSort={(column) =>
									vm.setFilter(nextPullSort(vm.filter, column))
								}
								aiSchedule={aiSchedule.error ? null : aiSchedule.data}
								onToggleWatch={(row) => void vm.toggleWatch(row.pull.id)}
								selection={{
									ids: vm.selectedIds,
									header: <PageSelectionCheckbox vm={vm} />,
									onToggle: vm.toggleSelection,
								}}
								onOpen={(row, element) => {
									opener.current = element;
									vm.selectPull(row.pull.id);
								}}
							/>
						)}
						<PullListPagination
							page={vm.page}
							pageSize={vm.pageSize}
							total={vm.total}
							loaded={vm.pullsLoaded}
							loading={vm.loading}
							onPage={vm.setPage}
						/>
					</LayerCard>
				</SectionRule>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<StageLegend />
					<p className="text-xs text-basalt-muted-foreground">
						Jev Readiness indicates whether a watched PR needs human
						intervention. Running is not permission to merge.
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
		</PrCollectionMembershipProvider>
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

function PendingWatchList({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	if (
		vm.filter.watching !== "watching" ||
		(vm.pendingError === SERVICE_UNAVAILABLE &&
			!vm.pendingObservations.length) ||
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
				{vm.pendingError && vm.pendingError !== SERVICE_UNAVAILABLE ? (
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
						key={item.watch.id}
						className="flex items-center justify-between gap-3 text-xs"
					>
						<a
							href={item.pr.url}
							target="_blank"
							rel="noopener noreferrer"
							className="break-all hover:underline"
						>
							{item.pr.organization} / {item.pr.project.name} /{" "}
							{item.pr.repository.name} #{item.pr.number}
						</a>
						<Button
							size="sm"
							variant="ghost"
							disabled={Boolean(vm.busy)}
							onClick={() => void vm.removePending(item.watch)}
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

function PullsEmptyState({ vm }: { vm: ReturnType<typeof useWorkbench> }) {
	if (vm.serviceUnavailable && !vm.pullsLoaded) return null;
	if (!vm.pullsLoaded)
		return (
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
		);
	return (
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
	);
}
