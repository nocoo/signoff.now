import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { fetchSettings } from "@/models/settingsApi";

export function DashboardPage() {
	const [stats, setStats] = useState({
		developers: 0,
		teams: 0,
		tags: 0,
		repos: 0,
		version: 0,
		stale: false,
	});
	const [error, setError] = useState<string | null>(null);

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
				});
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to load");
			}
		})();
	}, []);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="font-display text-xl font-semibold">Overview</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Manager console for developers, repos, and scoring settings. Activity
					data is pipeline-only (read-only here).
				</p>
			</div>

			{error ? (
				<p className="text-sm text-destructive">
					{error} — is the Worker running on :37042?
				</p>
			) : null}

			{stats.stale ? (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
					Scores are stale (config v{stats.version}).{" "}
					<Link to="/settings" className="underline">
						Open Settings
					</Link>
				</div>
			) : null}

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{[
					{ label: "Developers", n: stats.developers, to: "/developers" },
					{ label: "Teams", n: stats.teams, to: "/teams" },
					{ label: "Tags", n: stats.tags, to: "/tags" },
					{ label: "Repos", n: stats.repos, to: "/repos" },
				].map((c) => (
					<Link key={c.to} to={c.to}>
						<Card className="transition-colors hover:bg-secondary/40">
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium text-muted-foreground">
									{c.label}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="font-display text-3xl font-semibold">{c.n}</p>
							</CardContent>
						</Card>
					</Link>
				))}
			</div>

			<p className="text-xs text-muted-foreground">
				Pipeline config version: {stats.version || "—"} · v{__APP_VERSION__}
			</p>
		</div>
	);
}
