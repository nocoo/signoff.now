import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsSummary } from "@/models/stats";
import { fetchStatsSummary } from "@/models/statsApi";
import { useDashboardViewModel } from "./useDashboardViewModel";

vi.mock("@/models/statsApi", () => ({
	fetchStatsSummary: vi.fn(),
}));

const summary = (over: Partial<StatsSummary> = {}): StatsSummary => ({
	pipelineConfigVersion: 1,
	scoresStale: false,
	staleReason: null,
	window: { from: "2026-06-29", to: "2026-07-26" },
	totals: { activities: 5, score: 40, activeDevelopers: 2 },
	byType: [
		{ type: "pr.merged", count: 3, score: 30 },
		{ type: "pr.vote", count: 2, score: 10 },
	],
	topDevelopers: [
		{ developerId: "d1", name: "Ada", score: 30, activityCount: 3 },
	],
	daily: [{ dayKey: "2026-07-26", score: 40, activityCount: 5 }],
	lastIngestAt: 1_784_700_000,
	...over,
});

const mounted = async () => {
	const hook = renderHook(() => useDashboardViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("useDashboardViewModel", () => {
	beforeEach(() => {
		vi.mocked(fetchStatsSummary).mockReset();
		vi.mocked(fetchStatsSummary).mockResolvedValue(summary());
	});

	it("loads on mount without a window so the server applies its timezone", async () => {
		const { result } = await mounted();
		expect(fetchStatsSummary).toHaveBeenCalledWith(undefined);
		expect(result.current.summary?.totals.score).toBe(40);
		expect(result.current.error).toBeNull();
		expect(result.current.preset).toBe(28);
	});

	it("zero-fills the daily series before deriving bar heights", async () => {
		// The server returns one day; the window is 28. Without the fill the
		// chart would show a single full bar and read as constant activity.
		const { result } = await mounted();
		expect(result.current.daily).toHaveLength(28);
		expect(result.current.daily[27]).toMatchObject({
			dayKey: "2026-07-26",
			ratio: 1,
		});
		expect(result.current.daily[0]).toMatchObject({
			dayKey: "2026-06-29",
			score: 0,
			ratio: 0,
		});
	});

	it("derives type shares and passes through developers and totals", async () => {
		const { result } = await mounted();
		expect(result.current.byType.map((t) => t.share)).toEqual([0.75, 0.25]);
		expect(result.current.topDevelopers[0]?.name).toBe("Ada");
		expect(result.current.totals.activeDevelopers).toBe(2);
		expect(result.current.presets).toEqual([7, 28, 92]);
	});

	it("anchors a preset on the day the server called today", async () => {
		// Not the browser's today: the two differ across a timezone boundary,
		// and the bars would then shift under the manager for no reason.
		const { result } = await mounted();
		await act(async () => {
			result.current.selectPreset(7);
		});
		expect(fetchStatsSummary).toHaveBeenLastCalledWith({
			from: "2026-07-20",
			to: "2026-07-26",
		});
		expect(result.current.preset).toBe(7);
	});

	it("re-requests the default preset with an explicit window once anchored", async () => {
		const { result } = await mounted();
		await act(async () => {
			result.current.selectPreset(28);
		});
		expect(fetchStatsSummary).toHaveBeenLastCalledWith({
			from: "2026-06-29",
			to: "2026-07-26",
		});
	});

	it("reload repeats the current preset", async () => {
		const { result } = await mounted();
		await act(async () => {
			result.current.reload();
		});
		expect(fetchStatsSummary).toHaveBeenCalledTimes(2);
		expect(fetchStatsSummary).toHaveBeenLastCalledWith({
			from: "2026-06-29",
			to: "2026-07-26",
		});
	});

	it("ignores a stale response that lands after a newer one", async () => {
		// Click 7 then 92; if 7 resolves last the 92 button would sit lit above
		// seven days of bars.
		let settleFirst: ((s: StatsSummary) => void) | undefined;
		vi.mocked(fetchStatsSummary).mockImplementationOnce(
			() =>
				new Promise<StatsSummary>((resolve) => {
					settleFirst = resolve;
				}),
		);
		const { result } = renderHook(() => useDashboardViewModel());

		vi.mocked(fetchStatsSummary).mockResolvedValue(
			summary({ totals: { activities: 9, score: 99, activeDevelopers: 3 } }),
		);
		await act(async () => {
			result.current.selectPreset(92);
		});
		expect(result.current.summary?.totals.score).toBe(99);

		await act(async () => {
			settleFirst?.(
				summary({ totals: { activities: 1, score: 1, activeDevelopers: 1 } }),
			);
			await Promise.resolve();
		});
		expect(result.current.summary?.totals.score).toBe(99);
		expect(result.current.loading).toBe(false);
	});

	it("a stale rejection does not raise an error banner over fresh data", async () => {
		let rejectFirst: ((e: unknown) => void) | undefined;
		vi.mocked(fetchStatsSummary).mockImplementationOnce(
			() =>
				new Promise<StatsSummary>((_resolve, reject) => {
					rejectFirst = reject;
				}),
		);
		const { result } = renderHook(() => useDashboardViewModel());

		vi.mocked(fetchStatsSummary).mockResolvedValue(summary());
		await act(async () => {
			result.current.selectPreset(7);
		});

		await act(async () => {
			rejectFirst?.(new Error("stale"));
			await Promise.resolve();
		});
		expect(result.current.error).toBeNull();
		expect(result.current.summary).not.toBeNull();
	});

	it("a settling stale request does not clear the spinner for the live one", async () => {
		// Otherwise the skeleton disappears while the newest window is still in
		// flight, and the manager reads the old window's bars as the answer.
		let settleFirst: ((s: StatsSummary) => void) | undefined;
		let settleSecond: ((s: StatsSummary) => void) | undefined;
		vi.mocked(fetchStatsSummary)
			.mockImplementationOnce(
				() => new Promise<StatsSummary>((resolve) => (settleFirst = resolve)),
			)
			.mockImplementationOnce(
				() => new Promise<StatsSummary>((resolve) => (settleSecond = resolve)),
			);
		const { result } = renderHook(() => useDashboardViewModel());

		await act(async () => {
			result.current.selectPreset(92);
		});
		expect(result.current.loading).toBe(true);

		await act(async () => {
			settleFirst?.(summary());
			await Promise.resolve();
		});
		expect(result.current.loading).toBe(true);

		await act(async () => {
			settleSecond?.(summary());
			await Promise.resolve();
		});
		expect(result.current.loading).toBe(false);
	});

	it("surfaces a fetch error and drops the previous numbers", async () => {
		vi.mocked(fetchStatsSummary).mockRejectedValueOnce(new Error("boom"));
		const { result } = await mounted();
		expect(result.current.error).toBe("boom");
		expect(result.current.summary).toBeNull();
		expect(result.current.daily).toEqual([]);
		expect(result.current.byType).toEqual([]);
		expect(result.current.totals).toEqual({
			activities: 0,
			score: 0,
			activeDevelopers: 0,
		});
		expect(result.current.topDevelopers).toEqual([]);
		expect(result.current.lastIngestAt).toBeNull();
		expect(result.current.empty).toBe("has-data");
	});

	it("coerces a non-Error rejection into a readable message", async () => {
		vi.mocked(fetchStatsSummary).mockRejectedValueOnce("weird");
		const { result } = await mounted();
		expect(result.current.error).toBe("Failed to load statistics");
	});

	it("exposes staleness so the View can say the numbers are mid-rebuild", async () => {
		vi.mocked(fetchStatsSummary).mockResolvedValueOnce(
			summary({ scoresStale: true, staleReason: "weights updated" }),
		);
		const { result } = await mounted();
		expect(result.current.stale).toBe(true);
		expect(result.current.staleReason).toBe("weights updated");
	});

	it("tells never-collected apart from a quiet window", async () => {
		vi.mocked(fetchStatsSummary).mockResolvedValueOnce(
			summary({
				totals: { activities: 0, score: 0, activeDevelopers: 0 },
				daily: [],
				lastIngestAt: null,
			}),
		);
		const never = await mounted();
		expect(never.result.current.empty).toBe("never-collected");

		vi.mocked(fetchStatsSummary).mockResolvedValueOnce(
			summary({
				totals: { activities: 0, score: 0, activeDevelopers: 0 },
				daily: [],
			}),
		);
		const quiet = await mounted();
		expect(quiet.result.current.empty).toBe("empty-window");
	});
});
