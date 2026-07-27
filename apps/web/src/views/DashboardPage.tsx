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
import { PageHeader } from "@/components/PageHeader";
import { StatCard, StatGrid } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { heatmapColor } from "@/lib/palette";
import { useDashboardDirectoryViewModel } from "@/viewmodels/useDashboardDirectoryViewModel";
import { useDashboardViewModel } from "@/viewmodels/useDashboardViewModel";

function DashboardSkeleton() {
	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-80 max-w-full" />
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{["sk-a", "sk-b", "sk-c", "sk-d"].map((slot) => (
					<div
						key={slot}
						className="rounded-[var(--radius-card)] bg-secondary p-5 space-y-3"
					>
						<Skeleton className="h-3 w-20" />
						<Skeleton className="h-7 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}

function Panel({
	title,
	icon: Icon,
	children,
}: {
	title: string;
	icon: typeof Activity;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<Icon className="h-4 w-4 text-primary" strokeWidth={1.5} />
				{title}
			</div>
			{children}
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
					<code className="rounded bg-secondary px-1">bun run dev:all</code>.
				</AlertBanner>
			) : null}

			{dir.config?.stale ? (
				<AlertBanner variant="warning">
					<strong>Scores may be stale</strong> (config v{dir.config.version}
					{dir.config.staleReason ? ` — ${dir.config.staleReason}` : ""}).{" "}
					<Link to="/settings" className="underline font-medium text-primary">
						Open Settings
					</Link>
				</AlertBanner>
			) : null}

			{dir.counts ? (
				<StatGrid columns={4}>
					<StatCard
						title="Developers"
						value={dir.counts.developers}
						icon={Users}
						iconClassName="text-ms-blue"
						to="/developers"
						subtitle="Active roster"
					/>
					<StatCard
						title="Teams"
						value={dir.counts.teams}
						icon={UsersRound}
						iconClassName="text-ms-green"
						to="/teams"
						subtitle="Org groups"
					/>
					<StatCard
						title="Tags"
						value={dir.counts.tags}
						icon={Tag}
						iconClassName="text-ms-yellow"
						to="/tags"
						subtitle="Labels"
					/>
					<StatCard
						title="Repos"
						value={dir.counts.repos}
						icon={GitBranch}
						iconClassName="text-ms-red"
						to="/repos"
						subtitle="ADO bindings"
					/>
				</StatGrid>
			) : null}

			<Panel title="Team activity" icon={Activity}>
				<div className="flex flex-wrap items-center gap-2">
					{stats.presets.map((days) => (
						<button
							key={days}
							type="button"
							onClick={() => stats.selectPreset(days)}
							className={`rounded-[var(--radius-control)] px-3 py-1 text-sm ${
								stats.preset === days
									? "bg-primary text-primary-foreground font-medium"
									: "bg-background hover:bg-muted"
							}`}
						>
							Last {days} days
						</button>
					))}
					{stats.summary ? (
						<span className="text-xs text-muted-foreground">
							{stats.summary.window.from} → {stats.summary.window.to}
						</span>
					) : null}
				</div>

				{stats.error ? (
					<AlertBanner variant="error">
						{stats.error}{" "}
						<button
							type="button"
							onClick={stats.reload}
							className="underline font-medium"
						>
							Retry
						</button>
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
				) : stats.empty !== "has-data" ? (
					<p className="text-sm text-muted-foreground">
						{EMPTY_COPY[stats.empty]}
						{stats.empty === "never-collected" ? (
							<>
								{" "}
								Run{" "}
								<code className="rounded bg-background px-1">
									signoff collect
								</code>{" "}
								to get started.
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
								iconClassName="text-ms-blue"
								subtitle="Raw events"
							/>
							<StatCard
								title="Score"
								value={stats.totals.score}
								icon={Activity}
								iconClassName="text-ms-green"
								subtitle="After folding"
							/>
							<StatCard
								title="Active developers"
								value={stats.totals.activeDevelopers}
								icon={Users}
								iconClassName="text-ms-yellow"
								subtitle="With events"
							/>
						</StatGrid>

						<div className="flex items-end gap-[2px] h-24">
							{stats.daily.map((d) => (
								<div
									key={d.dayKey}
									title={`${d.dayKey}: ${d.score} (${d.activityCount} events)`}
									className="flex-1 rounded-sm min-h-[2px]"
									style={{
										height: `${Math.max(d.ratio * 100, 2)}%`,
										backgroundColor: heatmapColor(d.level),
									}}
								/>
							))}
						</div>

						<dl className="space-y-1 text-sm">
							{stats.byType.map((t) => (
								<div key={t.type} className="flex items-center gap-3">
									<dt className="w-24 shrink-0 font-mono text-xs">{t.type}</dt>
									<dd className="flex-1 flex items-center gap-2">
										<div
											className="h-2 rounded-sm bg-primary"
											style={{ width: `${t.share * 100}%` }}
										/>
										<span className="text-xs text-muted-foreground shrink-0">
											{t.count} · {t.score}
										</span>
									</dd>
								</div>
							))}
						</dl>

						<ol className="space-y-1 text-sm">
							{stats.topDevelopers.map((d) => (
								<li key={d.developerId} className="flex justify-between gap-3">
									<Link
										to={`/activity?dev=${d.developerId}`}
										className="text-primary hover:underline truncate"
									>
										{d.name}
									</Link>
									<span className="text-muted-foreground shrink-0">
										{d.score} · {d.activityCount}
									</span>
								</li>
							))}
						</ol>
					</>
				)}
			</Panel>

			{dir.config ? (
				<div className="grid gap-3 md:grid-cols-2">
					<Panel title="Pipeline config" icon={Settings}>
						<dl className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<dt className="text-muted-foreground text-xs">Version</dt>
								<dd className="font-display text-lg font-semibold">
									{dir.config.version}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs">Timezone</dt>
								<dd className="font-medium truncate">{dir.config.timezone}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs">Scores</dt>
								<dd>
									{dir.config.stale ? (
										<span className="text-warning font-medium">Stale</span>
									) : (
										<span className="text-success font-medium">Fresh</span>
									)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs">App</dt>
								<dd className="font-mono text-xs">v{__APP_VERSION__}</dd>
							</div>
						</dl>
						<Link
							to="/settings"
							className="inline-flex text-sm text-primary hover:underline"
						>
							Manage settings →
						</Link>
					</Panel>

					<Panel title="Activity & scores" icon={Activity}>
						<p className="text-sm text-muted-foreground">
							Heatmaps and daily scores are written only by the local pipeline
							(CLI / scripts). Web cannot invent activity events.
						</p>
						<Link
							to="/activity"
							className="inline-flex text-sm text-primary hover:underline"
						>
							View activity →
						</Link>
					</Panel>
				</div>
			) : null}
		</div>
	);
}
