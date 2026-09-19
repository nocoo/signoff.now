import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartLegend } from "@nocoo/basalt/charts/legend";
import { chart } from "@nocoo/basalt/charts/palette";
import { StatCard, StatGrid } from "@nocoo/basalt/charts/stat-card";
import { ChartTooltipContent } from "@nocoo/basalt/charts/tooltip";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import type {
	ContributionFilters,
	ContributionSnapshot,
	DirectoryData,
	RepositoryContribution,
} from "@signoff/domain/insights";
import {
	organizationUrl,
	type Project,
	projectUrl,
	repositoryUrl,
} from "@signoff/domain/workbench";
import { ArrowRight, ChevronLeft, ChevronRight, GitBranch } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ContributionFilterBar } from "@/components/ContributionFilterBar";
import { EmptyState } from "@/components/EmptyState";
import { StatisticsModule } from "@/components/StatisticsModule";
import { relativeAge } from "@/models/freshness";
import { DEFAULT_PULL_FILTER, writePullFilter } from "@/models/workbench";
import { useContributionModule } from "@/viewmodels/useContributionModule";
import { useInsightsViewModel } from "@/viewmodels/useInsightsViewModel";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

const SERIES = [
	{ key: "open", label: "Open", color: chart.sky },
	{ key: "merged", label: "Merged", color: chart.green },
	{ key: "closed", label: "Closed", color: chart.gray },
	{ key: "draft", label: "Draft", color: chart.amber },
];
const SOURCE_LINK = {
	target: "_blank",
	rel: "noopener noreferrer",
	className:
		"rounded-sm underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring",
};

export function RepositoriesPage() {
	const source = useWorkbench().filter.source;
	const vm = useInsightsViewModel(source, "repositories");
	const state = useContributionModule("repositories", vm.validFilters);
	const now = useMinuteNow();
	return (
		<div className="space-y-4">
			<PageHeader
				title="Repos"
				description="Compare collected PRs across repositories. Counts reflect known records, not complete repository history."
			/>
			<ContributionFilterBar vm={vm} withDates={false} />
			<StatisticsModule
				title="Repository overview"
				description="Current known PR states across all recorded dates. Calculate or refresh this overview when you need updated counts."
				state={state}
				now={now}
				disabled={!vm.validFilters}
			>
				{(snapshot) => (
					<RepositoryOverview
						snapshot={snapshot}
						projects={vm.directory?.projects ?? []}
						now={now}
					/>
				)}
			</StatisticsModule>
			{vm.directory ? (
				<CollectionCoverage
					directory={vm.directory}
					filters={vm.filters}
					snapshot={state.snapshot}
				/>
			) : null}
		</div>
	);
}

function ProjectLinks({ project }: { project: Project }) {
	return (
		<>
			<a
				{...SOURCE_LINK}
				href={organizationUrl(project)}
				title="Open organization (new tab)"
			>
				{project.organization}
			</a>
			<span aria-hidden> / </span>
			<a
				{...SOURCE_LINK}
				href={projectUrl(project)}
				title="Open project (new tab)"
			>
				{project.projectKey}
			</a>
		</>
	);
}

function CollectedAt({
	timestamp,
	now,
}: {
	timestamp: number | null;
	now: number;
}) {
	if (timestamp === null) return <>Not collected</>;
	return (
		<time
			dateTime={new Date(timestamp * 1000).toISOString()}
			title={`signoff.now data collection: ${new Date(timestamp * 1000).toLocaleString()}`}
		>
			{relativeAge(timestamp, now)}
		</time>
	);
}

function RepositoryComparison({
	repositories,
	projects,
}: {
	repositories: RepositoryContribution[];
	projects: Project[];
}) {
	const leaders = repositories.slice(0, 8).map((repository) => ({
		...repository,
		label: `${repository.name} · ${projects.find((project) => project.id === repository.projectId)?.projectKey ?? repository.projectId}`,
	}));
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-medium">
				Repository comparison · most recorded PRs
			</h3>
			<ChartFrame
				ariaLabel="Recorded PRs by repository and current state"
				size="h-64 w-full"
				summary="Up to eight repositories with the most recorded PRs. Open, merged, closed, and draft are separate categories. Full counts and source links are in the table below."
			>
				<BarChart
					data={leaders}
					layout="vertical"
					margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
				>
					<CartesianGrid
						horizontal={false}
						stroke="hsl(var(--basalt-border))"
						strokeDasharray="3 3"
					/>
					<XAxis
						type="number"
						allowDecimals={false}
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 11, fill: "hsl(var(--basalt-muted-foreground))" }}
					/>
					<YAxis
						type="category"
						dataKey="label"
						width={140}
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 11, fill: "hsl(var(--basalt-muted-foreground))" }}
						tickFormatter={(label: string) =>
							label.length > 21 ? `${label.slice(0, 20)}…` : label
						}
					/>
					<Tooltip
						content={<ChartTooltipContent />}
						cursor={{ fill: "hsl(var(--basalt-muted) / 0.4)" }}
					/>
					{SERIES.map((series) => (
						<Bar
							key={series.key}
							dataKey={series.key}
							name={series.label}
							fill={series.color}
							stackId="states"
							maxBarSize={22}
							isAnimationActive={false}
						/>
					))}
				</BarChart>
			</ChartFrame>
			<ChartLegend items={SERIES} shape="bar" />
		</div>
	);
}

export function RepositoryOverview({
	snapshot,
	projects,
	now,
}: {
	snapshot: ContributionSnapshot;
	projects: Project[];
	now: number;
}) {
	const [requestedPage, setPage] = useState(1);
	const pageCount = Math.max(1, Math.ceil(snapshot.repositories.length / 20));
	const page = Math.min(requestedPage, pageCount);
	const visible = snapshot.repositories.slice((page - 1) * 20, page * 20);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-basalt-muted-foreground">
				<Badge variant="secondary">
					{snapshot.coverage === "sample"
						? "Sample records"
						: "Collected records"}
				</Badge>
				<span>
					{snapshot.filters.includeDraft
						? "Drafts included as a separate category"
						: "Drafts excluded"}
				</span>
				<span>
					Last collected{" "}
					<CollectedAt timestamp={snapshot.totals.lastCollectedAt} now={now} />
				</span>
			</div>
			<StatGrid columns={3}>
				<StatCard title="Recorded PRs" value={snapshot.totals.total} />
				<StatCard
					title="Repositories with records"
					value={snapshot.totals.repositories}
				/>
				<StatCard title="Contributors" value={snapshot.totals.contributors} />
			</StatGrid>
			{snapshot.repositories.length === 0 ? (
				<EmptyState
					compact
					icon={GitBranch}
					title="No recorded PRs match these filters"
					description="Try another project or contributor scope. Counts reflect the PR records collected so far."
				/>
			) : (
				<>
					<RepositoryComparison
						repositories={snapshot.repositories}
						projects={projects}
					/>
					<div className="overflow-x-auto">
						<Table
							aria-label="Repository pull request counts"
							className="min-w-[920px]"
						>
							<TableHeader>
								<TableRow>
									<TableHead>Repository</TableHead>
									{[
										"Total",
										"Open",
										"Merged",
										"Closed",
										"Draft",
										"Contributors",
									].map((label) => (
										<TableHead key={label} className="text-right">
											{label}
										</TableHead>
									))}
									<TableHead className="text-right">Last collected</TableHead>
									<TableHead>
										<span className="sr-only">Pull request list</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{visible.map((repository) => {
									const project = projects.find(
										(candidate) => candidate.id === repository.projectId,
									);
									const queue = writePullFilter({
										...DEFAULT_PULL_FILTER,
										source: snapshot.filters.source,
										projectId: repository.projectId,
										organization: project?.organization ?? "",
										repository: repository.id,
										state: "all",
										draft: snapshot.filters.includeDraft
											? "include"
											: "exclude",
									});
									return (
										<TableRow key={repository.key}>
											<TableCell className="min-w-56 max-w-80">
												<div className="break-words text-[13px] font-medium">
													{project ? (
														<a
															{...SOURCE_LINK}
															href={repositoryUrl(project, repository)}
															title="Open repository (new tab)"
														>
															{repository.name}
														</a>
													) : (
														repository.name
													)}
												</div>
												<div className="mt-1 break-words text-[11px] text-basalt-muted-foreground">
													{project ? (
														<ProjectLinks project={project} />
													) : (
														"Project details unavailable"
													)}
												</div>
											</TableCell>
											{(
												[
													"total",
													"open",
													"merged",
													"closed",
													"draft",
													"contributors",
												] as const
											).map((key) => (
												<TableCell
													key={key}
													className="text-right text-xs tabular-nums"
												>
													{repository[key].toLocaleString()}
												</TableCell>
											))}
											<TableCell className="whitespace-nowrap text-right text-xs text-basalt-muted-foreground">
												<CollectedAt
													timestamp={repository.lastCollectedAt}
													now={now}
												/>
											</TableCell>
											<TableCell className="text-right">
												<Button asChild variant="ghost" size="sm">
													<Link
														to={`/prs?${queue}`}
														aria-label={`View PRs in ${repository.name}`}
													>
														View PRs
														<ArrowRight className="h-3.5 w-3.5" aria-hidden />
													</Link>
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-basalt-muted-foreground">
						<span>
							{(page - 1) * 20 + 1}–
							{Math.min(page * 20, snapshot.repositories.length)} of{" "}
							{snapshot.repositories.length} repositories
						</span>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="icon"
								className="h-7 w-7"
								aria-label="Previous repository page"
								disabled={page <= 1}
								onClick={() => setPage(page - 1)}
							>
								<ChevronLeft className="h-4 w-4" aria-hidden />
							</Button>
							<span className="tabular-nums">
								{page} / {pageCount}
							</span>
							<Button
								variant="outline"
								size="icon"
								className="h-7 w-7"
								aria-label="Next repository page"
								disabled={page >= pageCount}
								onClick={() => setPage(page + 1)}
							>
								<ChevronRight className="h-4 w-4" aria-hidden />
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

function CollectionCoverage({
	directory,
	filters,
	snapshot,
}: {
	directory: DirectoryData;
	filters: ContributionFilters;
	snapshot: ContributionSnapshot | null;
}) {
	const scopedProjects = directory.projects.filter(
		(project) =>
			(!filters.projectIds.length || filters.projectIds.includes(project.id)) &&
			(!filters.repositoryKeys.length ||
				directory.repositories.some(
					(repository) =>
						repository.projectId === project.id &&
						filters.repositoryKeys.includes(repository.key),
				)),
	);
	const withoutRecords = scopedProjects.filter(
		(project) =>
			!(snapshot?.repositories ?? directory.repositories).some(
				(repository) => repository.projectId === project.id,
			),
	);
	if (directory.projects.length === 0)
		return (
			<LayerCard padding="none">
				<EmptyState
					icon={GitBranch}
					title="No projects in this source"
					description="Add a project to begin collecting PR records."
					action={
						<Button asChild variant="outline">
							<Link to="/projects">Manage projects</Link>
						</Button>
					}
				/>
			</LayerCard>
		);
	if (withoutRecords.length === 0) return null;
	return (
		<LayerCard className="space-y-3" aria-label="Collection coverage">
			<h2 className="text-sm font-semibold">
				Projects without matching PR records
			</h2>
			<ul className="divide-y divide-basalt-border/60">
				{withoutRecords.map((project) => (
					<li
						key={project.id}
						className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-xs"
					>
						<span className="break-words">
							<ProjectLinks project={project} />
						</span>
						<span className="text-basalt-muted-foreground">
							{directory.repositories.some(
								(repository) => repository.projectId === project.id,
							)
								? "No matching records in this calculation"
								: project.lastScannedAt === null
									? "Not collected yet"
									: "No PR records collected"}
						</span>
					</li>
				))}
			</ul>
			<p className="text-xs text-basalt-muted-foreground">
				A project with no collected records may still have PRs at its source.
			</p>
		</LayerCard>
	);
}
