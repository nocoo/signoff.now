import { apiFetch } from "@/lib/api";
import { parseStatsSummary, type StatsSummary } from "./stats";

export async function fetchStatsSummary(opts?: {
	from: string;
	to: string;
}): Promise<StatsSummary> {
	// Omitting the window lets the server pick the default in the configured
	// timezone, which the browser cannot know (08 §3.2).
	const q = opts
		? `?${new URLSearchParams({ from: opts.from, to: opts.to })}`
		: "";
	const raw = await apiFetch<unknown>(`/api/stats/summary${q}`);
	return parseStatsSummary(raw);
}
