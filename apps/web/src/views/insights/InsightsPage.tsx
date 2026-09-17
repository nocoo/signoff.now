import { Badge, Button } from "@nocoo/basalt";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartLegend } from "@nocoo/basalt/charts/legend";
import { chart, chartAxis } from "@nocoo/basalt/charts/palette";
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
	ContributionSnapshot,
	DirectoryData,
} from "@signoff/domain/insights";
import { ChevronLeft, ChevronRight, GitPullRequest, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ContributionFilterBar } from "@/components/ContributionFilterBar";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar } from "@/components/EntityAvatar";
import { StatCard, StatGrid } from "@/components/StatCard";
import { StatisticsModule } from "@/components/StatisticsModule";
import { relativeAge } from "@/models/freshness";
import { useContributionModule } from "@/viewmodels/useContributionModule";
import { useInsightsViewModel } from "@/viewmodels/useInsightsViewModel";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { RepositoryOverview } from "@/views/workbench/RepositoriesPage";

const SERIES = [
	{ key: "open", label: "Open", color: chart.sky },
	{ key: "merged", label: "Merged", color: chart.green },
	{ key: "closed", label: "Closed", color: chart.gray },
	{ key: "draft", label: "Draft", color: chart.amber },
] as const;
const chartText = "hsl(var(--basalt-muted-foreground))";

export function InsightsPage() {
	const source = useWorkbench().filter.source;
	const vm = useInsightsViewModel(source);
	const [search, setSearch] = useSearchParams();
	const hasLink = ["contributor", "team", "tag"].some((key) => search.has(key));
	const { setFilters } = vm;
	useEffect(() => {
		if (!hasLink) return;
		const requestedSource = search.get("source");
		if (
			(requestedSource === "cli" || requestedSource === "demo") &&
			requestedSource !== source
		)
			return;
		setFilters({
			projectIds: [],
			repositoryKeys: [],
			audience: "all",
			contributorKeys: search.getAll("contributor").filter(Boolean),
			teamIds: search.getAll("team").filter(Boolean),
			tagIds: search.getAll("tag").filter(Boolean),
		});
		setSearch(
			(previous) => {
				const next = new URLSearchParams(previous);
				for (const key of ["contributor", "team", "tag"]) next.delete(key);
				return next;
			},
			{ replace: true },
		);
	}, [hasLink, search, setSearch, setFilters, source]);
	const filters = hasLink ? null : vm.validFilters;
	const overview = useContributionModule("overview", filters);
	const trend = useContributionModule(
		"trend",
		filters?.from && filters.to ? filters : null,
	);
	const members = useContributionModule("members", filters);
	const repositories = useContributionModule("repositories", filters);
	const now = useMinuteNow();
	return (
		<div className="space-y-4">
			<PageHeader
				title="Contributions"
				description="PRs created in the selected UTC dates, grouped by their current state. Each module refreshes only when you request it."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/developers">
							<Users className="h-4 w-4" aria-hidden />
							Manage members
						</Link>
					</Button>
				}
			/>
			<ContributionFilterBar vm={vm} />
			<p className="text-xs leading-relaxed text-basalt-muted-foreground">
				<Badge variant="secondary" className="mr-2">
					{source === "demo" ? "Sample history" : "Collected history"}
				</Badge>
				{source === "cli"
					? "Includes collected open PRs and recent completed PRs; older merged or closed PRs may be missing. "
					: "Sample members and PRs are separate from Live data. "}
				Refresh recalculates stored records. Merged counts refer to PRs created
				in this period that are now merged.
			</p>
			<div className="grid min-w-0 gap-4 xl:grid-cols-2">
				<StatisticsModule
					title="PR overview"
					description="Distinct PRs and authors in this scope."
					state={overview}
					now={now}
					disabled={!filters}
				>
					{(snapshot) => <Overview snapshot={snapshot} now={now} />}
				</StatisticsModule>
				<StatisticsModule
					title="Creation trend"
					description="Daily PR creation, split by current state. UTC calendar days."
					state={trend}
					now={now}
					disabled={!filters?.from || !filters.to}
				>
					{(snapshot) => <Trend snapshot={snapshot} />}
				</StatisticsModule>
			</div>
			<StatisticsModule
				title="Member contributions"
				description="Authored PRs by member or unlinked account. Followed members with no matching PRs remain visible."
				state={members}
				now={now}
				disabled={!filters}
			>
				{(snapshot) => (
					<MemberBreakdown snapshot={snapshot} directory={vm.directory} />
				)}
			</StatisticsModule>
			<StatisticsModule
				title="Repository contributions"
				description="Repositories represented in the selected creation dates and contributor scope."
				state={repositories}
				now={now}
				disabled={!filters}
			>
				{(snapshot) => (
					<RepositoryOverview
						snapshot={snapshot}
						projects={vm.directory?.projects ?? []}
						now={now}
					/>
				)}
			</StatisticsModule>
		</div>
	);
}

function Overview({
	snapshot,
	now,
}: {
	snapshot: ContributionSnapshot;
	now: number;
}) {
	const { totals } = snapshot;
	const states = SERIES.map((series) => ({
		...series,
		value: totals[series.key],
	}));
	return (
		<div className="space-y-4">
			<StatGrid columns={3}>
				<StatCard title="Authored PRs" value={totals.total.toLocaleString()} />
				<StatCard
					title="Contributors"
					value={totals.contributors.toLocaleString()}
				/>
				<StatCard
					title="Repositories"
					value={totals.repositories.toLocaleString()}
				/>
			</StatGrid>
			{totals.total ? (
				<div className="grid min-w-0 items-center gap-4 sm:grid-cols-2">
					<ChartFrame
						ariaLabel="PRs by current state"
						size="h-48 w-full"
						summary={`${totals.total} PRs: ${totals.open} open, ${totals.merged} merged, ${totals.closed} closed, ${totals.draft} draft.`}
					>
						<PieChart>
							<Pie
								data={states}
								dataKey="value"
								nameKey="label"
								innerRadius="60%"
								outerRadius="90%"
								paddingAngle={2}
								stroke="none"
								isAnimationActive={false}
							>
								{states.map((series) => (
									<Cell key={series.key} fill={series.color} />
								))}
							</Pie>
							<Tooltip content={<ChartTooltipContent />} />
						</PieChart>
					</ChartFrame>
					<dl className="space-y-3">
						{states.map((series) => (
							<div
								key={series.key}
								className="flex items-center justify-between gap-3 text-xs"
							>
								<dt className="flex items-center gap-2">
									<span
										className="h-2 w-2 rounded-full"
										style={{ backgroundColor: series.color }}
										aria-hidden
									/>
									{series.label}
								</dt>
								<dd className="flex items-center gap-3 tabular-nums">
									<span className="font-semibold">
										{series.value.toLocaleString()}
									</span>
									<span className="w-10 text-right text-basalt-muted-foreground">
										{Math.round((series.value / totals.total) * 100)}%
									</span>
								</dd>
							</div>
						))}
					</dl>
				</div>
			) : (
				<EmptyState
					icon={GitPullRequest}
					title="No matching PRs"
					description="Try another date range or contributor scope."
				/>
			)}
			<p className="text-xs text-basalt-muted-foreground">
				{snapshot.filters.includeDraft
					? "Drafts count separately from open PRs."
					: "Drafts excluded."}{" "}
				Newest collected record:{" "}
				{totals.lastCollectedAt === null ? (
					"none"
				) : (
					<time
						dateTime={new Date(totals.lastCollectedAt * 1000).toISOString()}
						title={new Date(totals.lastCollectedAt * 1000).toLocaleString()}
					>
						{relativeAge(totals.lastCollectedAt, now)}
					</time>
				)}
				.
			</p>
		</div>
	);
}

function Trend({ snapshot }: { snapshot: ContributionSnapshot }) {
	return (
		<div className="space-y-3">
			<ChartFrame
				ariaLabel="Daily PR creation by current state"
				size="h-72 w-full"
				summary={`${snapshot.totals.total} PRs created between ${snapshot.filters.from} and ${snapshot.filters.to}. Days without matching PRs are shown as zero.`}
				dataAlternative={
					<details className="text-xs">
						<summary className="cursor-pointer text-basalt-muted-foreground">
							View daily counts
						</summary>
						<div className="mt-2 max-h-56 overflow-auto">
							<Table aria-label="Daily contribution counts">
								<TableHeader>
									<TableRow>
										<TableHead>Created (UTC)</TableHead>
										{SERIES.map((series) => (
											<TableHead key={series.key} className="text-right">
												{series.label}
											</TableHead>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{snapshot.trend.map((day) => (
										<TableRow key={day.day}>
											<TableCell>{day.day}</TableCell>
											{SERIES.map((series) => (
												<TableCell
													key={series.key}
													className="text-right tabular-nums"
												>
													{day[series.key]}
												</TableCell>
											))}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</details>
				}
			>
				<BarChart
					data={snapshot.trend}
					margin={{ top: 12, right: 8, bottom: 0, left: -24 }}
				>
					<CartesianGrid
						vertical={false}
						stroke={chartAxis}
						strokeDasharray="3 3"
					/>
					<XAxis
						dataKey="day"
						tickFormatter={(day: string) => day.slice(5)}
						minTickGap={24}
						tick={{ fontSize: 11, fill: chartText }}
						tickLine={false}
						axisLine={false}
					/>
					<YAxis
						allowDecimals={false}
						tick={{ fontSize: 11, fill: chartText }}
						tickLine={false}
						axisLine={false}
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
							maxBarSize={28}
							isAnimationActive={false}
						/>
					))}
				</BarChart>
			</ChartFrame>
			<ChartLegend items={[...SERIES]} shape="bar" />
		</div>
	);
}

function MemberBreakdown({
	snapshot,
	directory,
}: {
	snapshot: ContributionSnapshot;
	directory: DirectoryData | null;
}) {
	const [requestedPage, setPage] = useState(1);
	const pages = Math.max(1, Math.ceil(snapshot.members.length / 20));
	const page = Math.min(requestedPage, pages);
	const visible = snapshot.members.slice((page - 1) * 20, page * 20);
	if (!snapshot.members.length)
		return (
			<EmptyState
				icon={Users}
				title="No matching contributors"
				description="Follow authors in Members, or change your filters to include other contributors."
			/>
		);
	return (
		<div className="space-y-4">
			<ChartFrame
				ariaLabel="Top contributors by authored PRs"
				size="h-64 w-full"
				summary="Up to eight contributors with the most authored PRs. Full counts and membership are in the table below."
			>
				<BarChart
					data={snapshot.members.slice(0, 8)}
					layout="vertical"
					margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
				>
					<CartesianGrid
						horizontal={false}
						stroke={chartAxis}
						strokeDasharray="3 3"
					/>
					<XAxis
						type="number"
						allowDecimals={false}
						tick={{ fontSize: 11, fill: chartText }}
						tickLine={false}
						axisLine={false}
					/>
					<YAxis
						type="category"
						dataKey="name"
						width={116}
						tick={{ fontSize: 11, fill: chartText }}
						tickLine={false}
						axisLine={false}
						tickFormatter={(name: string) =>
							name.length > 17 ? `${name.slice(0, 16)}…` : name
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
			<ChartLegend items={[...SERIES]} shape="bar" />
			<div className="overflow-x-auto">
				<Table
					aria-label="Member contribution counts"
					className="min-w-[640px]"
				>
					<TableHeader>
						<TableRow>
							<TableHead>Member / author</TableHead>
							<TableHead>Teams</TableHead>
							<TableHead className="text-right">Total</TableHead>
							{SERIES.map((series) => (
								<TableHead key={series.key} className="text-right">
									{series.label}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{visible.map((member) => {
							const identity =
								member.memberId === null
									? directory?.identities.find(
											(entry) => `identity:${entry.key}` === member.key,
										)
									: null;
							return (
								<TableRow key={member.key}>
									<TableCell>
										<div className="flex items-center gap-2">
											<EntityAvatar
												name={member.name}
												avatarUrl={member.avatarUrl}
												size="sm"
											/>
											<div className="min-w-0">
												<div className="text-xs font-medium">{member.name}</div>
												<div className="mt-0.5 text-[11px] text-basalt-muted-foreground">
													{member.memberId
														? "Followed member"
														: identity
															? `${identity.organization} · ${identity.handle ?? identity.actorId}`
															: "Unlinked author"}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex max-w-72 flex-wrap gap-1">
											{member.teamIds.length ? (
												member.teamIds.map((id) => (
													<Badge
														key={id}
														variant="secondary"
														className="text-[10px] font-normal"
													>
														{directory?.teams.find((team) => team.id === id)
															?.name ?? "Unavailable team"}
													</Badge>
												))
											) : (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											)}
										</div>
									</TableCell>
									<TableCell className="text-right text-xs font-semibold tabular-nums">
										{member.total.toLocaleString()}
									</TableCell>
									{SERIES.map((series) => (
										<TableCell
											key={series.key}
											className="text-right text-xs tabular-nums"
										>
											{member[series.key].toLocaleString()}
										</TableCell>
									))}
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-basalt-muted-foreground">
				<span>
					{(page - 1) * 20 + 1}–{Math.min(page * 20, snapshot.members.length)}{" "}
					of {snapshot.members.length} contributors
				</span>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						className="h-7 w-7"
						aria-label="Previous member page"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
					>
						<ChevronLeft className="h-4 w-4" aria-hidden />
					</Button>
					<span className="tabular-nums">
						{page} / {pages}
					</span>
					<Button
						variant="outline"
						size="icon"
						className="h-7 w-7"
						aria-label="Next member page"
						disabled={page >= pages}
						onClick={() => setPage(page + 1)}
					>
						<ChevronRight className="h-4 w-4" aria-hidden />
					</Button>
				</div>
			</div>
		</div>
	);
}
