import { useCallback, useEffect, useState } from "react";
import {
	type HeatmapResponse,
	type HeatmapRow,
	heatmapLevel,
	type TimelineItem,
	type TimelineResponse,
} from "@/models/activity";
import { fetchHeatmap, fetchTimeline } from "@/models/activityApi";
import type { Developer } from "@/models/entities";
import { listDevelopers } from "@/models/entitiesApi";

export function useActivityHeatmapViewModel() {
	const [devs, setDevs] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [timelineDev, setTimelineDev] = useState("");
	const [loading, setLoading] = useState(false);
	const [timelineLoading, setTimelineLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [timelineError, setTimelineError] = useState<string | null>(null);
	const [data, setData] = useState<HeatmapResponse | null>(null);
	const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
	const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
	const [roster, setRoster] = useState<Developer[]>([]);
	const [rosterError, setRosterError] = useState<string | null>(null);

	// The heatmap keys on developer ids, but a manager reads names. Loading the
	// roster here rather than in the view keeps the id → person mapping — and
	// the fallback when a score has no matching row — inside the coverage gate.
	const loadRoster = useCallback(async () => {
		try {
			setRoster(await listDevelopers(true));
			setRosterError(null);
		} catch (e) {
			// A missing roster degrades to bare ids; it must not blank the page,
			// which is the only place the scores can be read at all. But it is
			// surfaced rather than swallowed, so "why are these all ULIDs?" has
			// a visible answer and a retry.
			setRosterError(e instanceof Error ? e.message : "Roster unavailable");
		}
	}, []);

	useEffect(() => {
		void loadRoster();
	}, [loadRoster]);

	const load = useCallback(async () => {
		const ids = devs
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (ids.length === 0 || !from || !to) {
			setError("Provide developer ids (comma-separated), from, and to");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await fetchHeatmap({ devs: ids, from, to });
			setData(res);
			// Prefill single-dev timeline when only one id is requested.
			if (ids.length === 1 && !timelineDev) {
				setTimelineDev(ids[0] ?? "");
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [devs, from, to, timelineDev]);

	const loadTimeline = useCallback(
		async (opts?: { more?: boolean }) => {
			const dev = timelineDev.trim();
			if (!dev || !from || !to) {
				setTimelineError("Provide timeline developer, from, and to");
				return;
			}
			setTimelineLoading(true);
			setTimelineError(null);
			try {
				const cursor =
					opts?.more && timeline?.nextCursor ? timeline.nextCursor : null;
				const res = await fetchTimeline({
					dev,
					from,
					to,
					cursor: opts?.more ? cursor : null,
				});
				setTimeline(res);
				setTimelineItems((prev) =>
					opts?.more ? [...prev, ...res.items] : res.items,
				);
			} catch (e) {
				setTimelineError(e instanceof Error ? e.message : String(e));
				if (!opts?.more) {
					setTimeline(null);
					setTimelineItems([]);
				}
			} finally {
				setTimelineLoading(false);
			}
		},
		[timelineDev, from, to, timeline],
	);

	const maxTotal = data?.rows.reduce((m, r) => Math.max(m, r.total), 0) ?? 0;

	const levels = (data?.rows ?? []).map((r: HeatmapRow) => ({
		...r,
		level: heatmapLevel(r.total, maxTotal),
	}));

	/** Totals per developer for simple multi-select comparison (06 §7.2). */
	const comparison = (() => {
		const map = new Map<string, number>();
		for (const r of data?.rows ?? []) {
			map.set(r.developerId, (map.get(r.developerId) ?? 0) + r.total);
		}
		return [...map.entries()]
			.map(([developerId, total]) => ({ developerId, total }))
			.sort((a, b) => b.total - a.total);
	})();

	const byId = new Map(roster.map((d) => [d.id, d]));
	/** Avatar-and-name for an id, or the bare id when nobody matches. */
	const describe = (developerId: string) => {
		const d = byId.get(developerId);
		return {
			developerId,
			name: d?.name ?? developerId,
			avatarUrl: d?.avatarUrl ?? null,
		};
	};

	return {
		rosterError,
		reloadRoster: loadRoster,
		describe,
		devs,
		setDevs,
		from,
		setFrom,
		to,
		setTo,
		timelineDev,
		setTimelineDev,
		loading,
		timelineLoading,
		error,
		timelineError,
		data,
		levels,
		comparison,
		timeline,
		timelineItems,
		load,
		loadTimeline,
	};
}
