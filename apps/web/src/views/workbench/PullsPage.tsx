import {
	Badge,
	Button,
	Field,
	Input,
	LayerCard,
	SegmentControl,
} from "@nocoo/basalt";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { pullUrl } from "@signoff/domain/workbench";
import {
	ArrowRight,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	GitPullRequest,
	LoaderCircle,
	Search,
	ShieldAlert,
} from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar } from "@/components/EntityAvatar";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import {
	DEFAULT_PULL_FILTER,
	type PullFilter,
	type PullRow,
	relativeTime,
} from "@/models/workbench";
import { useViewportCollection } from "@/viewmodels/useViewportCollection";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { PullDetailSheet } from "./PullDetailSheet";
import { RepositoryFilters } from "./RepositoryFilters";
import {
	ScanControls,
	WorkbenchConnection,
	WorkbenchFeedback,
} from "./WorkbenchControls";
import { ReadinessBadge, StageBar, StageLegend } from "./WorkbenchStatus";

export function PullsPage() {
	const vm = useWorkbench();
	const opener = useRef<HTMLElement | null>(null);
	const table = useRef<HTMLTableElement | null>(null);
	useViewportCollection(
		table,
		vm.pageRows.map(({ pull }) => pull.id),
		vm.collectVisible,
		vm.autoRefresh && vm.filter.source === "cli" && !vm.loading,
		vm.selected?.pull.id,
	);
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
			<div className="flex flex-wrap items-center justify-between gap-2">
				<WorkbenchConnection vm={vm} compact />
				<div className="flex items-center gap-2">
					<ScanControls vm={vm} />
				</div>
			</div>
			<WorkbenchFeedback vm={vm} />
			<RepositoryFilters vm={vm} />
			<section
				className="grid grid-cols-2 gap-2 xl:grid-cols-4"
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
									selected && "bg-basalt-primary/5 hover:bg-basalt-primary/5",
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
			<LayerCard padding="none">
				<LayerCard.Header className="flex-col gap-2 p-3">
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
								{vm.visible.length} results
							</span>
							<SelectControl
								aria-label="Sort pull requests"
								value={vm.filter.sort}
								onChange={(sort) =>
									vm.setFilter({ sort: sort as PullFilter["sort"] })
								}
								className="w-40"
							>
								<option value="attention">Attention first</option>
								<option value="updated">Recently updated</option>
								<option value="oldest">Oldest first</option>
							</SelectControl>
						</div>
					</div>
				</LayerCard.Header>
				{vm.loading ? (
					<LayerCard.Loading label="Loading pull requests" />
				) : !vm.data ? (
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
				) : vm.visible.length === 0 ? (
					<EmptyState
						icon={GitPullRequest}
						title={
							vm.rows.length
								? "No matching pull requests"
								: "Your review queue starts here"
						}
						description={
							vm.rows.length
								? "Try another repository, author, draft setting, or search term."
								: "Add an Azure DevOps project, then scan it to load its PRs."
						}
						action={
							vm.rows.length ? (
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
					<>
						<div className="overflow-x-auto">
							<Table
								ref={table}
								aria-label="Pull requests"
								className="min-w-[960px] table-fixed"
							>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[35%]">Pull request</TableHead>
										<TableHead className="w-[15%]">Readiness</TableHead>
										<TableHead className="w-[18%]">Checks & stages</TableHead>
										<TableHead className="w-[25%]">Next action</TableHead>
										<TableHead className="w-[7%] text-right">Updated</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{vm.pageRows.map(({ pull, project, readiness, progress }) => (
										<TableRow
											key={pull.id}
											data-pull-id={pull.id}
											className="group"
										>
											<TableCell className="py-3.5 align-top">
												<div className="flex items-start gap-1.5">
													<Button
														variant="link"
														className="h-auto min-w-0 justify-start whitespace-normal p-0 text-left text-[13px] font-semibold leading-5 text-basalt-foreground"
														aria-label={`Open PR #${pull.number}: ${pull.title}`}
														onClick={(event) => {
															opener.current = event.currentTarget;
															vm.selectPull(pull.id);
														}}
													>
														{pull.title}
													</Button>
													<PullSourceLink pull={pull} project={project} />
												</div>
												<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-basalt-muted-foreground">
													<span className="font-mono text-basalt-foreground/75">
														#{pull.number}
													</span>
													<span aria-hidden>·</span>
													<span>
														{project.organization} / {project.projectKey}
													</span>
													<span aria-hidden>/</span>
													<span>{pull.repository.name}</span>
												</div>
												<div className="mt-1 text-[11px] text-basalt-muted-foreground">
													{pull.author.name}
													{pull.labels.includes("release blocker") ? (
														<Badge
															variant="error"
															className="ml-2 px-1.5 py-0 text-[9px]"
														>
															release blocker
														</Badge>
													) : null}
												</div>
											</TableCell>
											<TableCell className="py-3.5 align-top">
												<ReadinessBadge readiness={readiness} />
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
														<p className="text-[11px]">
															Loads while visible with Auto collect
														</p>
													</div>
												) : (
													<>
														<div className="mb-2 flex items-baseline justify-between gap-1 text-xs">
															<span className="font-medium tabular-nums">
																{progress.checksPassed}/{progress.checksTotal}{" "}
																required
															</span>
															<span className="text-[11px] text-basalt-muted-foreground">
																{pull.builds.length} builds
															</span>
														</div>
														<StageBar builds={pull.builds} />
														<p className="mt-1.5 text-[11px] text-basalt-muted-foreground">
															{progress.stagesPassed}/{progress.stagesTotal}{" "}
															stages passed
															{progress.optionalFailures
																? ` · ${progress.optionalFailures} advisory`
																: ""}
															{project.source === "cli" ? (
																<span
																	className="ml-2"
																	title={new Date(
																		(pull.checksObservedAt ?? pull.observedAt) *
																			1000,
																	).toLocaleString()}
																>
																	Checked{" "}
																	{relativeTime(
																		pull.checksObservedAt ?? pull.observedAt,
																	)}
																</span>
															) : null}
														</p>
													</>
												)}
											</TableCell>
											<TableCell className="py-3.5 align-top">
												<p className="text-xs leading-5">{readiness.action}</p>
												<p className="mt-1 text-[11px] text-basalt-muted-foreground">
													{readiness.owner}
												</p>
											</TableCell>
											<TableCell className="py-3.5 align-top text-right text-[11px] whitespace-nowrap text-basalt-muted-foreground">
												<time
													dateTime={new Date(
														pull.updatedAt * 1000,
													).toISOString()}
													title={new Date(
														pull.updatedAt * 1000,
													).toLocaleString()}
												>
													{relativeTime(pull.updatedAt)}
												</time>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<LayerCard.Footer className="justify-between">
							<p className="text-xs text-basalt-muted-foreground">
								{(vm.page - 1) * vm.pageSize + 1}–
								{Math.min(vm.page * vm.pageSize, vm.visible.length)} of{" "}
								{vm.visible.length} pull requests
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
									{vm.page} / {vm.pageCount}
								</span>
								<Button
									variant="outline"
									size="icon"
									className="h-7 w-7"
									aria-label="Next page"
									disabled={vm.page >= vm.pageCount}
									onClick={() => vm.setPage(vm.page + 1)}
								>
									<ChevronRight aria-hidden className="h-4 w-4" />
								</Button>
							</div>
						</LayerCard.Footer>
					</>
				)}
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
				onScan={() => void vm.scan(vm.selected?.project.id)}
				canScan={Boolean(vm.selected && vm.canScan(vm.selected.project))}
				busy={Boolean(vm.busy)}
			/>
		</div>
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
