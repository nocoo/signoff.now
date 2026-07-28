import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHeatmap, fetchTimeline } from "@/models/activityApi";
import { listDevelopers } from "@/models/entitiesApi";
import { useActivityHeatmapViewModel } from "./useActivityHeatmapViewModel";

vi.mock("@/models/activityApi", () => ({
	fetchHeatmap: vi.fn(),
	fetchTimeline: vi.fn(),
}));

vi.mock("@/models/entitiesApi", () => ({
	// Default to an empty roster: the tests that predate it assert on scores,
	// not names, and must not have to know this call exists.
	listDevelopers: vi.fn(() => Promise.resolve([])),
}));

const dev = (id: string, name: string, avatarUrl: string | null = null) => ({
	id,
	name,
	alias: name.toLowerCase(),
	avatarUrl,
	teamIds: [],
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
});

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

describe("resolving ids to people", () => {
	beforeEach(() => {
		vi.mocked(fetchHeatmap).mockResolvedValue(sample as never);
	});

	const mountedWithRoster = async () => {
		const hook = renderHook(() => useActivityHeatmapViewModel());
		// Flush the roster effect before asserting on it.
		await act(async () => {
			await Promise.resolve();
		});
		return hook;
	};

	it("names a developer and carries their avatar", async () => {
		vi.mocked(listDevelopers).mockResolvedValue([
			dev("d1", "Ada", "https://x/a.png"),
		]);
		const { result } = await mountedWithRoster();
		expect(result.current.describe("d1")).toEqual({
			developerId: "d1",
			name: "Ada",
			avatarUrl: "https://x/a.png",
			known: true,
		});
	});

	it("falls back to the bare id for an unknown developer", async () => {
		// Scores can name a developer the roster no longer lists. Showing the id
		// is worse than a name but far better than showing nothing.
		vi.mocked(listDevelopers).mockResolvedValue([dev("d1", "Ada")]);
		const { result } = await mountedWithRoster();
		expect(result.current.describe("d9")).toEqual({
			developerId: "d9",
			name: "d9",
			avatarUrl: null,
			known: false,
		});
	});

	it("a failed roster load leaves the scores readable", async () => {
		// The roster is decoration; the heatmap is the point of the page.
		vi.mocked(listDevelopers).mockRejectedValue(new Error("nope"));
		const { result } = await mountedWithRoster();
		expect(result.current.error).toBeNull();
		expect(result.current.describe("d1").name).toBe("d1");
		act(() => {
			result.current.setDevs("d1,d2");
			result.current.setFrom("2026-01-01");
			result.current.setTo("2026-01-31");
		});
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.levels).toHaveLength(2);
	});

	it("includes archived developers so old scores still resolve", async () => {
		// A developer archived last month still owns last month's activity.
		vi.mocked(listDevelopers).mockResolvedValue([dev("d1", "Ada")]);
		await mountedWithRoster();
		expect(vi.mocked(listDevelopers)).toHaveBeenCalledWith(true);
	});
});
