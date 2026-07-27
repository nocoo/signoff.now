import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	byTypeShares,
	dailyLevels,
	emptyKind,
	fillDailyGaps,
	presetWindow,
	type StatsSummary,
	WINDOW_PRESETS,
	type WindowPreset,
} from "@/models/stats";
import { fetchStatsSummary } from "@/models/statsApi";

/**
 * Dashboard state and derivation (08 §3.4).
 *
 * The View renders what this returns and decides nothing. That is 03 §4.1, but
 * it also has a practical edge: Views are excluded from the coverage gate, so
 * logic left there is logic nobody tests.
 */
export function useDashboardViewModel() {
	const [preset, setPreset] = useState<WindowPreset>(28);
	const [summary, setSummary] = useState<StatsSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	/**
	 * Only the newest request may write state. Clicking 7 then 92 quickly and
	 * having 7 land second would leave the 92 button lit above 7 days of bars.
	 */
	const requestSeq = useRef(0);
	/**
	 * `preset` and `anchorDay` are read at call time, not closed over, so `load`
	 * keeps a stable identity — otherwise the mount effect would depend on a
	 * function that changes with every fetch and re-fire in a loop.
	 */
	const presetRef = useRef<WindowPreset>(28);
	const anchorRef = useRef<string | null>(null);

	const load = useCallback(async (next?: WindowPreset) => {
		const seq = ++requestSeq.current;
		setLoading(true);
		setError(null);
		try {
			// The first call omits the window so the server applies the
			// configured timezone; later calls derive from the window it
			// returned, so a preset means the same days as the default did.
			const days = next ?? presetRef.current;
			const anchorDay = anchorRef.current;
			const window = anchorDay ? presetWindow(days, anchorDay) : undefined;
			const data = await fetchStatsSummary(window);
			if (seq !== requestSeq.current) {
				return;
			}
			setSummary(data);
			anchorRef.current = data.window.to;
		} catch (e) {
			if (seq !== requestSeq.current) {
				return;
			}
			setError(e instanceof Error ? e.message : "Failed to load statistics");
			setSummary(null);
		} finally {
			if (seq === requestSeq.current) {
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const selectPreset = useCallback(
		(days: WindowPreset) => {
			setPreset(days);
			presetRef.current = days;
			void load(days);
		},
		[load],
	);

	const daily = useMemo(() => {
		if (!summary) {
			return [];
		}
		// Zero-fill before computing heights, or idle days vanish and the chart
		// reads as uninterrupted activity (08 §3.3).
		return dailyLevels(fillDailyGaps(summary.daily, summary.window));
	}, [summary]);

	const byType = useMemo(
		() => (summary ? byTypeShares(summary.byType) : []),
		[summary],
	);

	const empty = summary ? emptyKind(summary) : "has-data";

	return {
		presets: WINDOW_PRESETS,
		preset,
		selectPreset,
		loading,
		error,
		summary,
		daily,
		byType,
		topDevelopers: summary?.topDevelopers ?? [],
		totals: summary?.totals ?? {
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		},
		stale: summary?.scoresStale ?? false,
		staleReason: summary?.staleReason ?? null,
		lastIngestAt: summary?.lastIngestAt ?? null,
		empty,
		reload: () => void load(),
	};
}
