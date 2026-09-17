import { Badge, Button, DescriptionList, LayerCard } from "@nocoo/basalt";
import { BarChart } from "@nocoo/basalt/charts/bar";
import { Code } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SegmentControl } from "@nocoo/basalt/components/segment-control";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	Activity,
	GitBranch,
	Settings,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { EntityAvatar } from "@/components/EntityAvatar";
import { Skeleton } from "@/components/Skeleton";
import { StatCard, StatGrid } from "@/components/StatCard";
import type { WindowPreset } from "@/models/stats";
import { useDashboardDirectoryViewModel } from "@/viewmodels/useDashboardDirectoryViewModel";
import { useDashboardViewModel } from "@/viewmodels/useDashboardViewModel";

function DashboardSkeleton() {
	return (
		<div className="space-y-6" role="status" aria-label="Loading dashboard">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-80 max-w-full" />
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{["sk-a", "sk-b", "sk-c", "sk-d"].map((slot) => (
					<LayerCard key={slot} className="space-y-3">
						<Skeleton className="h-3 w-20" />
						<Skeleton className="h-7 w-16" />
					</LayerCard>
				))}
			</div>
		</div>
	);
}

const EMPTY_COPY = {
	"never-collected": "No activity has been collected yet.",
	"empty-window": "Nothing happened in this window.",
	"has-data": "",
} as const;

export function DashboardPage() {
	const dir = useDashboardDirectoryViewModel();
	const stats = useDashboardViewModel();

	if (dir.loading && !dir.counts) {
		return <DashboardSkeleton />;
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Dashboard"
				description="Manager console for directory entities and scoring settings. Activity and Score are pipeline-only (read-only here)."
			/>

			{dir.error ? (
				<AlertBanner variant="error">
					{dir.error} — is the Worker running on :37042? Try{" "}
					<Code>bun run dev:all</Code>.
				</AlertBanner>
			) : null}

			{dir.config?.stale ? (
				<AlertBanner variant="warning">
					<strong>Scores may be stale</strong> (config v{dir.config.version}
					{dir.config.staleReason ? ` — ${dir.config.staleReason}` : ""}).{" "}
					<Button asChild variant="link" className="h-auto p-0">
						<Link to="/settings">Open Settings</Link>
					</Button>
				</AlertBanner>
			) : null}

			{dir.counts ? (
				<StatGrid columns={4}>
					<StatCard
						title="Developers"
						value={dir.counts.developers}
						icon={Users}
						iconClassName="text-basalt-chart-1"
						to="/developers"
						subtitle="Active roster"
					/>
					<StatCard
						title="Teams"
						value={dir.counts.teams}
						icon={UsersRound}
						iconClassName="text-basalt-chart-3"
						to="/teams"
						subtitle="Org groups"
					/>
					<StatCard
						title="Tags"
						value={dir.counts.tags}
						icon={Tag}
						iconClassName="text-basalt-chart-4"
						to="/tags"
						subtitle="Labels"
					/>
					<StatCard
						title="Repos"
						value={dir.counts.repos}
						icon={GitBranch}
						iconClassName="text-basalt-chart-2"
						to="/repos"
						subtitle="ADO bindings"
					/>
				</StatGrid>
			) : null}

			<LayerCard padding="none">
				<LayerCard.Header>
					<h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
						<Activity
							className="h-4 w-4 text-basalt-primary"
							strokeWidth={1.5}
							aria-hidden
						/>
						Team activity
					</h2>
				</LayerCard.Header>
				<LayerCard.Well className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<SegmentControl
							legend="Period"
							value={String(stats.preset)}
							onValueChange={(value) =>
								stats.selectPreset(Number(value) as WindowPreset)
							}
							options={stats.presets.map((days) => ({
								value: String(days),
								label: `Last ${days} days`,
							}))}
						/>
						{stats.summary ? (
							<span className="text-xs text-basalt-muted-foreground">
								{stats.summary.window.from} → {stats.summary.window.to}
							</span>
						) : null}
					</div>

					{stats.error ? (
						<AlertBanner variant="error">
							{stats.error}{" "}
							<Button
								variant="link"
								className="h-auto p-0"
								onClick={stats.reload}
							>
								Retry
							</Button>
						</AlertBanner>
					) : null}

					{stats.stale ? (
						<AlertBanner variant="warning">
							<strong>Numbers withheld</strong>
							{stats.staleReason ? ` — ${stats.staleReason}` : ""}
						</AlertBanner>
					) : null}

					{stats.loading ? (
						<Skeleton className="h-24 w-full" />
					) : stats.stale || !stats.summary ? null : stats.empty !==
						"has-data" ? (
						<p className="text-sm text-basalt-muted-foreground">
							{EMPTY_COPY[stats.empty]}
							{stats.empty === "never-collected" ? (
								<>
									{" "}
									Run <Code>signoff collect</Code> to get started.
								</>
							) : null}
						</p>
					) : (
						<>
							<StatGrid columns={3}>
								<StatCard
									title="Activities"
									value={stats.totals.activities}
									icon={Activity}
									iconClassName="text-basalt-chart-1"
									subtitle="Raw events"
								/>
								<StatCard
									title="Score"
									value={stats.totals.score}
									icon={Activity}
									iconClassName="text-basalt-chart-3"
									subtitle="After folding"
								/>
								<StatCard
									title="Active developers"
									value={stats.totals.activeDevelopers}
									icon={Users}
									iconClassName="text-basalt-chart-4"
									subtitle="With events"
								/>
							</StatGrid>

							<BarChart
								ariaLabel="Daily activity"
								className="h-56 w-full"
								data={stats.daily.map((day) => ({
									x: day.dayKey,
									score: day.score,
									events: day.activityCount,
								}))}
								series={[
									{ key: "score", label: "Score" },
									{ key: "events", label: "Events" },
								]}
								showAxes
								showLegend
								xValueFormatter={(day) => String(day).slice(5)}
								summary="Daily scores and event counts, including days without activity. Use arrow keys to explore each date."
							/>
							<BarChart
								ariaLabel="Activity by type"
								className="h-56 w-full"
								data={stats.byType.map((type) => ({
									x: type.type,
									score: type.score,
									events: type.count,
								}))}
								series={[
									{ key: "score", label: "Score" },
									{ key: "events", label: "Events" },
								]}
								showAxes
								showLegend
								summary="Score and event count by activity type."
							/>
							<div className="overflow-x-auto">
								<Table aria-label="Top developers">
									<TableHeader>
										<TableRow>
											<TableHead>Developer</TableHead>
											<TableHead className="text-right">Score</TableHead>
											<TableHead className="text-right">Events</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{stats.topDevelopers.map((developer) => (
											<TableRow key={developer.developerId}>
												<TableCell>
													<Button
														asChild
														variant="link"
														className="h-auto max-w-full justify-start p-0"
													>
														<Link
															to={`/activity?dev=${encodeURIComponent(developer.developerId)}`}
														>
															<EntityAvatar
																name={developer.name}
																avatarUrl={developer.avatarUrl}
																size="sm"
															/>
															<span className="truncate">{developer.name}</span>
														</Link>
													</Button>
												</TableCell>
												<TableCell className="text-right">
													{developer.score}
												</TableCell>
												<TableCell className="text-right">
													{developer.activityCount}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</>
					)}
				</LayerCard.Well>
			</LayerCard>

			{dir.config ? (
				<div className="grid gap-3 md:grid-cols-2">
					<LayerCard padding="none">
						<LayerCard.Header>
							<h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
								<Settings
									className="h-4 w-4 text-basalt-primary"
									strokeWidth={1.5}
									aria-hidden
								/>
								Pipeline config
							</h2>
						</LayerCard.Header>
						<LayerCard.Well className="space-y-4">
							<DescriptionList>
								<DescriptionList.Item term="Version">
									{dir.config.version}
								</DescriptionList.Item>
								<DescriptionList.Item term="Timezone">
									{dir.config.timezone}
								</DescriptionList.Item>
								<DescriptionList.Item term="Scores">
									<Badge variant={dir.config.stale ? "warning" : "success"}>
										{dir.config.stale ? "Stale" : "Fresh"}
									</Badge>
								</DescriptionList.Item>
								<DescriptionList.Item term="App">
									v{__APP_VERSION__}
								</DescriptionList.Item>
							</DescriptionList>
							<Button asChild variant="link" className="h-auto p-0">
								<Link to="/settings">Manage settings →</Link>
							</Button>
						</LayerCard.Well>
					</LayerCard>

					<LayerCard padding="none">
						<LayerCard.Header>
							<h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
								<Activity
									className="h-4 w-4 text-basalt-primary"
									strokeWidth={1.5}
									aria-hidden
								/>
								Activity &amp; scores
							</h2>
						</LayerCard.Header>
						<LayerCard.Well className="space-y-4">
							<p className="text-sm text-basalt-muted-foreground">
								Heatmaps and daily scores are written only by the local pipeline
								(CLI / scripts). Web cannot invent activity events.
							</p>
							<Button asChild variant="link" className="h-auto p-0">
								<Link to="/activity">View activity →</Link>
							</Button>
						</LayerCard.Well>
					</LayerCard>
				</div>
			) : null}
		</div>
	);
}
