import { useCallback, useEffect, useState } from "react";
import {
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { fetchSettings } from "@/models/settingsApi";

export type DirectoryCounts = {
	developers: number;
	teams: number;
	tags: number;
	repos: number;
};

export type PipelineConfig = {
	version: number;
	stale: boolean;
	staleReason: string | null;
	timezone: string;
};

/**
 * Directory counts and pipeline config for the Dashboard (03 §4.1).
 *
 * Kept separate from `useDashboardViewModel` on purpose: the two answer
 * different questions and fail independently. A stats endpoint that is down
 * should not blank the entity counts, and vice versa — a single combined
 * loading state would make each outage look like the other.
 */
export function useDashboardDirectoryViewModel() {
	const [counts, setCounts] = useState<DirectoryCounts | null>(null);
	const [config, setConfig] = useState<PipelineConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [devs, teams, tags, repos, settings] = await Promise.all([
				listDevelopers(),
				listTeams(),
				listTags(),
				listRepos(),
				fetchSettings(),
			]);
			setCounts({
				developers: devs.length,
				teams: teams.length,
				tags: tags.length,
				repos: repos.length,
			});
			setConfig({
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
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return {
		counts,
		config,
		loading,
		error,
		reload: () => void load(),
	};
}
