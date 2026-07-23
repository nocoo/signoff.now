import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHeatmap } from "@/models/activityApi";
import { useActivityHeatmapViewModel } from "./useActivityHeatmapViewModel";

vi.mock("@/models/activityApi", () => ({
	fetchHeatmap: vi.fn(),
	fetchTimeline: vi.fn(),
}));

const sample = {
	pipelineConfigVersion: 1,
	scoresStale: false,
	staleReason: null,
	rows: [
		{
			developerId: "d1",
			dayKey: "2026-01-01",
			total: 10,
			activityCount: 1,
		},
	],
};

describe("useActivityHeatmapViewModel", () => {
	beforeEach(() => {
		vi.mocked(fetchHeatmap).mockReset();
		vi.mocked(fetchHeatmap).mockResolvedValue(sample);
	});

	it("loads heatmap rows", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setDevs("d1");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.data?.rows).toHaveLength(1);
		expect(result.current.levels[0]?.level).toBe(4);
		expect(result.current.error).toBeNull();
	});

	it("errors when missing inputs", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.error).toMatch(/Provide developer/);
	});

	it("surfaces fetch errors", async () => {
		vi.mocked(fetchHeatmap).mockRejectedValueOnce(new Error("boom"));
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setDevs("d1");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.error).toBe("boom");
		expect(result.current.data).toBeNull();
	});
});
