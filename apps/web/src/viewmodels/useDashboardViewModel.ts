import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	byTypeShares,
	DEFAULT_PRESET,
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
	const [preset, setPreset] = useState<WindowPreset>(DEFAULT_PRESET);
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
	const presetRef = useRef<WindowPreset>(DEFAULT_PRESET);
	const anchorRef = useRef<string | null>(null);

	const load = useCallback(
		async (opts?: { next?: WindowPreset; reanchor?: boolean }) => {
			const seq = ++requestSeq.current;
			setLoading(true);
			setError(null);
			try {
				const days = opts?.next ?? presetRef.current;
				// A reload re-asks the server what "today" is. Reusing a stored
				// anchor would leave a tab open across midnight showing yesterday
				// as the last day, forever.
				let anchorDay = opts?.reanchor ? null : anchorRef.current;
				let data: StatsSummary | null = null;

				// At most two round trips. The first call of the session cannot
				// send a window — only the server knows what "today" is in the
				// configured timezone — so if a non-default preset was clicked
				// before the anchor existed, ask again rather than light up the
				// 92 button over 28 days of bars.
				for (let attempt = 0; attempt < 2; attempt++) {
					const window = anchorDay ? presetWindow(days, anchorDay) : undefined;
					data = await fetchStatsSummary(window);
					if (seq !== requestSeq.current) {
						return;
					}
					anchorRef.current = data.window.to;
					if (window || days === DEFAULT_PRESET) {
						break;
					}
					anchorDay = data.window.to;
				}
				setSummary(data);
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
		},
		[],
	);

	useEffect(() => {
		void load();
	}, [load]);

	const selectPreset = useCallback(
		(days: WindowPreset) => {
			setPreset(days);
			presetRef.current = days;
			void load({ next: days });
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
		reload: () => void load({ reanchor: true }),
	};
}
