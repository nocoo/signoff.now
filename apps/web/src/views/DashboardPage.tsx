import {
	Activity,
	GitBranch,
	Settings,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, StatGrid } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { fetchSettings } from "@/models/settingsApi";

type Stats = {
	developers: number;
	teams: number;
	tags: number;
	repos: number;
	version: number;
	stale: boolean;
	staleReason: string | null;
	timezone: string;
};

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

export function DashboardPage() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			try {
				const [devs, teams, tags, repos, settings] = await Promise.all([
					listDevelopers(),
					listTeams(),
					listTags(),
					listRepos(),
					fetchSettings(),
				]);
				setStats({
					developers: devs.length,
					teams: teams.length,
					tags: tags.length,
					repos: repos.length,
					version: settings.pipelineConfigVersion,
					stale: settings.scoresStale,
					staleReason: settings.scoresStaleReason,
					timezone: settings.timezone,
				});
				setError(null);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to load");
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	if (loading && !stats) {
		return <DashboardSkeleton />;
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Dashboard"
				description="Manager console for directory entities and scoring settings. Activity and Score are pipeline-only (read-only here)."
			/>

			{error ? (
				<AlertBanner variant="error">
					{error} — is the Worker running on :37042? Try{" "}
					<code className="rounded bg-secondary px-1">bun run dev:all</code>.
				</AlertBanner>
			) : null}

			{stats?.stale ? (
				<AlertBanner variant="warning">
					<strong>Scores may be stale</strong> (config v{stats.version}
					{stats.staleReason ? ` — ${stats.staleReason}` : ""}).{" "}
					<Link to="/settings" className="underline font-medium text-primary">
						Open Settings
					</Link>
				</AlertBanner>
			) : null}

			{stats ? (
				<>
					<StatGrid columns={4}>
						<StatCard
							title="Developers"
							value={stats.developers}
							icon={Users}
							iconClassName="text-ms-blue"
							to="/developers"
							subtitle="Active roster"
						/>
						<StatCard
							title="Teams"
							value={stats.teams}
							icon={UsersRound}
							iconClassName="text-ms-green"
							to="/teams"
							subtitle="Org groups"
						/>
						<StatCard
							title="Tags"
							value={stats.tags}
							icon={Tag}
							iconClassName="text-ms-yellow"
							to="/tags"
							subtitle="Labels"
						/>
						<StatCard
							title="Repos"
							value={stats.repos}
							icon={GitBranch}
							iconClassName="text-ms-red"
							to="/repos"
							subtitle="ADO bindings"
						/>
					</StatGrid>

					<div className="grid gap-3 md:grid-cols-2">
						<div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
							<div className="flex items-center gap-2 text-sm font-medium">
								<Settings className="h-4 w-4 text-primary" strokeWidth={1.5} />
								Pipeline config
							</div>
							<dl className="grid grid-cols-2 gap-3 text-sm">
								<div>
									<dt className="text-muted-foreground text-xs">Version</dt>
									<dd className="font-display text-lg font-semibold">
										{stats.version}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground text-xs">Timezone</dt>
									<dd className="font-medium truncate">{stats.timezone}</dd>
								</div>
								<div>
									<dt className="text-muted-foreground text-xs">Scores</dt>
									<dd>
										{stats.stale ? (
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
						</div>

						<div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
							<div className="flex items-center gap-2 text-sm font-medium">
								<Activity className="h-4 w-4 text-primary" strokeWidth={1.5} />
								Activity & scores
							</div>
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
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
