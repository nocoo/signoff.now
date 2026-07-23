import { useCallback, useState } from "react";
import {
	type HeatmapResponse,
	type HeatmapRow,
	heatmapLevel,
} from "@/models/activity";
import { fetchHeatmap } from "@/models/activityApi";

export function useActivityHeatmapViewModel() {
	const [devs, setDevs] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<HeatmapResponse | null>(null);

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
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [devs, from, to]);

	const maxTotal = data?.rows.reduce((m, r) => Math.max(m, r.total), 0) ?? 0;

	const levels = (data?.rows ?? []).map((r: HeatmapRow) => ({
		...r,
		level: heatmapLevel(r.total, maxTotal),
	}));

	return {
		devs,
		setDevs,
		from,
		setFrom,
		to,
		setTo,
		loading,
		error,
		data,
		levels,
		load,
	};
}
