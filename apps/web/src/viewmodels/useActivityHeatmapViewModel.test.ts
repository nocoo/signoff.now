import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHeatmap, fetchTimeline } from "@/models/activityApi";
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
		{
			developerId: "d2",
			dayKey: "2026-01-01",
			total: 4,
			activityCount: 1,
		},
	],
};

const timelineSample = {
	pipelineConfigVersion: 1,
	scoresStale: false,
	staleReason: null,
	items: [
		{
			id: "a1",
			type: "pr.merged",
			occurredAt: 100,
			dayKey: "2026-01-01",
			org: "o",
			project: "p",
			repoId: "r1",
			meta: {},
		},
	],
	nextCursor: "c1",
};

describe("useActivityHeatmapViewModel", () => {
	beforeEach(() => {
		vi.mocked(fetchHeatmap).mockReset();
		vi.mocked(fetchTimeline).mockReset();
		vi.mocked(fetchHeatmap).mockResolvedValue(sample);
		vi.mocked(fetchTimeline).mockResolvedValue(timelineSample);
	});

	it("loads heatmap rows and comparison totals", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setDevs("d1,d2");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.data?.rows).toHaveLength(2);
		expect(result.current.levels[0]?.level).toBe(4);
		expect(result.current.comparison).toEqual([
			{ developerId: "d1", total: 10 },
			{ developerId: "d2", total: 4 },
		]);
		expect(result.current.error).toBeNull();
	});

	it("prefills timelineDev for single developer heatmap", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setDevs("only-one");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.timelineDev).toBe("only-one");
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

	it("coerces non-Error heatmap failures", async () => {
		vi.mocked(fetchHeatmap).mockRejectedValueOnce("string-fail");
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setDevs("d1");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.error).toBe("string-fail");
	});

	it("loads timeline and appends on more", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
			result.current.setTimelineDev("d1");
		});
		await act(async () => {
			await result.current.loadTimeline();
		});
		expect(result.current.timelineItems).toHaveLength(1);
		expect(result.current.timeline?.nextCursor).toBe("c1");

		vi.mocked(fetchTimeline).mockResolvedValueOnce({
			...timelineSample,
			items: [
				{
					id: "a2",
					type: "pr.created",
					occurredAt: 90,
					dayKey: "2026-01-01",
					org: "o",
					project: "p",
					repoId: null,
					meta: {},
				},
			],
			nextCursor: null,
		});
		await act(async () => {
			await result.current.loadTimeline({ more: true });
		});
		expect(result.current.timelineItems).toHaveLength(2);
		expect(fetchTimeline).toHaveBeenLastCalledWith({
			dev: "d1",
			from: "2026-01-01",
			to: "2026-01-07",
			cursor: "c1",
		});
	});

	it("timeline validation error when missing fields", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		await act(async () => {
			await result.current.loadTimeline();
		});
		expect(result.current.timelineError).toMatch(/Provide timeline developer/);
	});

	it("surfaces timeline fetch error and clears items", async () => {
		vi.mocked(fetchTimeline).mockRejectedValueOnce(new Error("tl-boom"));
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
			result.current.setTimelineDev("d1");
		});
		await act(async () => {
			await result.current.loadTimeline();
		});
		expect(result.current.timelineError).toBe("tl-boom");
		expect(result.current.timelineItems).toEqual([]);
		expect(result.current.timeline).toBeNull();
	});

	it("keeps prior items when load-more fails", async () => {
		const { result } = renderHook(() => useActivityHeatmapViewModel());
		act(() => {
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-07");
			result.current.setTimelineDev("d1");
		});
		await act(async () => {
			await result.current.loadTimeline();
		});
		expect(result.current.timelineItems).toHaveLength(1);

		vi.mocked(fetchTimeline).mockRejectedValueOnce("more-fail");
		await act(async () => {
			await result.current.loadTimeline({ more: true });
		});
		expect(result.current.timelineError).toBe("more-fail");
		expect(result.current.timelineItems).toHaveLength(1);
	});
});
