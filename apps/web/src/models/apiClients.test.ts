import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { fetchHeatmap, fetchTimeline } from "./activityApi";
import { DEFAULT_ACTIVITY_WEIGHTS } from "./settings";
import { fetchSettings, putSettings } from "./settingsApi";
import { fetchStatsSummary } from "./statsApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

beforeEach(() => api.mockReset());

describe("thin model API clients", () => {
	it("fetches and parses activity heatmap and timeline with optional cursor", async () => {
		api.mockResolvedValueOnce({
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			rows: [],
		});
		await fetchHeatmap({
			devs: ["d1", "d2"],
			from: "2026-07-01",
			to: "2026-07-02",
		});
		expect(api).toHaveBeenLastCalledWith(
			"/api/activity/heatmap?devs=d1%2Cd2&from=2026-07-01&to=2026-07-02",
		);

		const timeline = {
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			items: [],
			nextCursor: null,
		};
		api.mockResolvedValueOnce(timeline);
		await fetchTimeline({ dev: "d1", from: "2026-07-01", to: "2026-07-02" });
		expect(api).toHaveBeenLastCalledWith(
			"/api/activity/timeline?dev=d1&from=2026-07-01&to=2026-07-02",
		);

		api.mockResolvedValueOnce(timeline);
		await fetchTimeline({
			dev: "d1",
			from: "2026-07-01",
			to: "2026-07-02",
			cursor: "c1",
		});
		expect(api).toHaveBeenLastCalledWith(
			"/api/activity/timeline?dev=d1&from=2026-07-01&to=2026-07-02&cursor=c1",
		);
	});

	it("fetches and updates settings with expectedVersion", async () => {
		const settings = {
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			pipelineConfigVersion: 1,
			scoresStale: false,
			scoresStaleReason: null,
		};
		api.mockResolvedValueOnce(settings);
		expect(await fetchSettings()).toEqual(settings);
		expect(api).toHaveBeenLastCalledWith("/api/settings");

		api.mockResolvedValueOnce({
			settings,
			recomputeRequired: false,
			recomputeKind: "none",
		});
		expect(
			await putSettings(
				{
					timezone: "UTC",
					emailSuffixes: ["example.com"],
					activityWeights: settings.activityWeights,
				},
				1,
			),
		).toEqual({
			settings,
			recomputeRequired: false,
			recomputeKind: "none",
		});
		expect(api).toHaveBeenLastCalledWith("/api/settings", {
			method: "PUT",
			body: JSON.stringify({
				expectedVersion: 1,
				timezone: "UTC",
				emailSuffixes: ["example.com"],
				activityWeights: settings.activityWeights,
			}),
		});
	});

	it("fetches stats summary with or without explicit window", async () => {
		const summary = {
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			window: { from: "2026-07-01", to: "2026-07-02" },
			totals: { activities: 0, score: 0, activeDevelopers: 0 },
			byType: [],
			topDevelopers: [],
			daily: [],
			lastIngestAt: null,
		};
		api.mockResolvedValue(summary);
		await fetchStatsSummary();
		expect(api).toHaveBeenLastCalledWith("/api/stats/summary");
		await fetchStatsSummary({ from: "2026-07-01", to: "2026-07-02" });
		expect(api).toHaveBeenLastCalledWith(
			"/api/stats/summary?from=2026-07-01&to=2026-07-02",
		);
	});
});
