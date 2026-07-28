import { describe, expect, test } from "vitest";
import {
	byTypeShares,
	DEFAULT_PRESET,
	dailyLevels,
	emptyKind,
	fillDailyGaps,
	isTrustworthy,
	parseStatsSummary,
	presetWindow,
	ratioLevel,
	type StatsSummary,
	WINDOW_PRESETS,
} from "./stats";

const raw = (over: Record<string, unknown> = {}) => ({
	pipelineConfigVersion: 1,
	scoresStale: false,
	staleReason: null,
	window: { from: "2026-07-01", to: "2026-07-03" },
	totals: { activities: 5, score: 40, activeDevelopers: 2 },
	byType: [{ type: "pr.merged", count: 3, score: 30 }],
	topDevelopers: [
		{ developerId: "d1", name: "Ada", score: 30, activityCount: 3 },
	],
	daily: [{ dayKey: "2026-07-01", score: 40, activityCount: 5 }],
	lastIngestAt: 1_784_700_000,
	...over,
});

const summary = (over: Partial<StatsSummary> = {}): StatsSummary => ({
	...parseStatsSummary(raw()),
	...over,
});

describe("parseStatsSummary", () => {
	test("parses a well-formed payload", () => {
		const s = parseStatsSummary(raw());
		expect(s.totals).toEqual({ activities: 5, score: 40, activeDevelopers: 2 });
		expect(s.byType[0]?.type).toBe("pr.merged");
		expect(s.topDevelopers[0]?.name).toBe("Ada");
		expect(s.lastIngestAt).toBe(1_784_700_000);
	});

	test("carries a developer avatar through", () => {
		const s = parseStatsSummary(
			raw({
				topDevelopers: [
					{
						developerId: "d1",
						name: "Ada",
						avatarUrl: "https://x/a.png",
						score: 1,
						activityCount: 1,
					},
				],
			}),
		);
		expect(s.topDevelopers[0]?.avatarUrl).toBe("https://x/a.png");
	});

	test("a missing or non-string avatar is null, not an error", () => {
		// Unlike the numbers, an absent avatar is normal: the developer row may
		// have been deleted after scoring, or the payload may predate the column.
		// Throwing here would blank the whole dashboard over a missing picture.
		expect(parseStatsSummary(raw()).topDevelopers[0]?.avatarUrl).toBeNull();
		expect(
			parseStatsSummary(
				raw({
					topDevelopers: [
						{
							developerId: "d1",
							name: "Ada",
							avatarUrl: 42,
							score: 1,
							activityCount: 1,
						},
					],
				}),
			).topDevelopers[0]?.avatarUrl,
		).toBeNull();
	});

	test("a malformed scoresStale is refused, not read as trustworthy", () => {
		// This flag decides whether numbers get published at all. Every wrong
		// value must fail loudly; silently resolving to `false` shows a manager
		// figures the server explicitly refused to stand behind.
		for (const bad of ["true", 1, 0, null, undefined, "yes", {}]) {
			expect(() => parseStatsSummary(raw({ scoresStale: bad }))).toThrow(
				/scoresStale/,
			);
		}
		expect(parseStatsSummary(raw({ scoresStale: true })).scoresStale).toBe(
			true,
		);
	});

	test("a malformed staleReason or lastIngestAt is refused, but null is fine", () => {
		expect(() => parseStatsSummary(raw({ staleReason: 42 }))).toThrow(
			/staleReason/,
		);
		expect(() => parseStatsSummary(raw({ lastIngestAt: "nan" }))).toThrow(
			/lastIngestAt/,
		);
		expect(
			parseStatsSummary(raw({ staleReason: null })).staleReason,
		).toBeNull();
	});

	test("keeps the stale reason and flag", () => {
		const s = parseStatsSummary(
			raw({ scoresStale: true, staleReason: "weights updated" }),
		);
		expect(s.scoresStale).toBe(true);
		expect(s.staleReason).toBe("weights updated");
		expect(isTrustworthy(s)).toBe(false);
	});

	test("a null lastIngestAt survives", () => {
		expect(
			parseStatsSummary(raw({ lastIngestAt: null })).lastIngestAt,
		).toBeNull();
	});

	test("rejects a non-object payload", () => {
		expect(() => parseStatsSummary(null)).toThrow();
		// An array must be named as a bad summary, not blamed on `window`: the
		// message is what the operator sees when the endpoint returns a list.
		expect(() => parseStatsSummary([])).toThrow(/stats summary/);
		expect(() => parseStatsSummary("nope")).toThrow(/stats summary/);
	});

	test("rejects a malformed number rather than rendering NaN", () => {
		// A NaN next to a person's name is worse than an error banner.
		expect(() =>
			parseStatsSummary(
				raw({ totals: { activities: "x", score: 1, activeDevelopers: 1 } }),
			),
		).toThrow(/totals.activities/);
		expect(() =>
			parseStatsSummary(
				raw({
					totals: { activities: Number.NaN, score: 1, activeDevelopers: 1 },
				}),
			),
		).toThrow();
	});

	test("rejects malformed collections and entries", () => {
		expect(() => parseStatsSummary(raw({ byType: {} }))).toThrow(/byType/);
		expect(() => parseStatsSummary(raw({ daily: [1] }))).toThrow();
		expect(() =>
			parseStatsSummary(
				raw({ topDevelopers: [{ developerId: "d", name: 5 }] }),
			),
		).toThrow();
		expect(() =>
			parseStatsSummary(raw({ window: { from: 1, to: "x" } })),
		).toThrow();
	});
});

describe("fillDailyGaps", () => {
	test("inserts every missing day as zero", () => {
		// Without this a bar chart skips idle days and reads as continuous work.
		const filled = fillDailyGaps(
			[{ dayKey: "2026-07-02", score: 10, activityCount: 1 }],
			{ from: "2026-07-01", to: "2026-07-04" },
		);
		expect(filled.map((d) => d.dayKey)).toEqual([
			"2026-07-01",
			"2026-07-02",
			"2026-07-03",
			"2026-07-04",
		]);
		expect(filled[0]).toEqual({
			dayKey: "2026-07-01",
			score: 0,
			activityCount: 0,
		});
		expect(filled[1]?.score).toBe(10);
	});

	test("a single-day window yields one day", () => {
		expect(
			fillDailyGaps([], { from: "2026-07-01", to: "2026-07-01" }),
		).toHaveLength(1);
	});

	test("an inverted or malformed window passes the input through", () => {
		const input = [{ dayKey: "2026-07-02", score: 1, activityCount: 1 }];
		expect(
			fillDailyGaps(input, { from: "2026-07-04", to: "2026-07-01" }),
		).toEqual(input);
		expect(fillDailyGaps(input, { from: "nope", to: "2026-07-01" })).toEqual(
			input,
		);
	});

	test("spans a month boundary", () => {
		expect(
			fillDailyGaps([], { from: "2026-06-29", to: "2026-07-02" }).map(
				(d) => d.dayKey,
			),
		).toEqual(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]);
	});
});

describe("dailyLevels", () => {
	test("scales against the busiest day", () => {
		const levels = dailyLevels([
			{ dayKey: "a", score: 10, activityCount: 1 },
			{ dayKey: "b", score: 5, activityCount: 1 },
			{ dayKey: "c", score: 0, activityCount: 0 },
		]);
		expect(levels.map((l) => l.ratio)).toEqual([1, 0.5, 0]);
		expect(levels.map((l) => l.level)).toEqual([4, 2, 0]);
	});

	test("an all-zero window has no bars rather than full ones", () => {
		const levels = dailyLevels([
			{ dayKey: "a", score: 0, activityCount: 0 },
			{ dayKey: "b", score: 0, activityCount: 0 },
		]);
		expect(levels.every((l) => l.ratio === 0)).toBe(true);
		// Every day at level 0 — not every day at full shade.
		expect(levels.every((l) => l.level === 0)).toBe(true);
	});

	test("an empty series is empty", () => {
		expect(dailyLevels([])).toEqual([]);
	});
});

describe("ratioLevel", () => {
	test("an empty and a maximal ratio sit at the ends of the scale", () => {
		expect(ratioLevel(0)).toBe(0);
		expect(ratioLevel(1)).toBe(4);
	});

	test("boundaries belong to the lower bucket", () => {
		// Off-by-one here shifts the whole chart one shade; pin the edges.
		expect(ratioLevel(0.25)).toBe(1);
		expect(ratioLevel(0.2501)).toBe(2);
		expect(ratioLevel(0.5)).toBe(2);
		expect(ratioLevel(0.75)).toBe(3);
		expect(ratioLevel(0.7501)).toBe(4);
	});

	test("the smallest positive score is still visible", () => {
		// Level 0 means "nothing happened". A day with one event must not
		// render identically to an empty one.
		expect(ratioLevel(0.001)).toBe(1);
	});
});

describe("byTypeShares", () => {
	test("shares sum to one", () => {
		const shares = byTypeShares([
			{ type: "pr.merged", count: 3, score: 30 },
			{ type: "pr.vote", count: 4, score: 10 },
		]);
		expect(shares[0]?.share).toBe(0.75);
		expect(shares.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1);
	});

	test("an all-zero-score window does not divide by zero", () => {
		// Reachable with an all-zero weight configuration.
		const shares = byTypeShares([{ type: "pr.merged", count: 3, score: 0 }]);
		expect(shares[0]?.share).toBe(0);
	});
});

describe("emptyKind", () => {
	test("data present", () => {
		expect(emptyKind(summary())).toBe("has-data");
	});

	test("never collected is distinct from a quiet window", () => {
		// They need different words: one is a setup step, the other is not.
		const never = summary({
			totals: { activities: 0, score: 0, activeDevelopers: 0 },
			lastIngestAt: null,
		});
		const quiet = summary({
			totals: { activities: 0, score: 0, activeDevelopers: 0 },
			lastIngestAt: 1_784_700_000,
		});
		expect(emptyKind(never)).toBe("never-collected");
		expect(emptyKind(quiet)).toBe("empty-window");
	});

	test("activity with zero score still counts as data", () => {
		expect(
			emptyKind(
				summary({ totals: { activities: 3, score: 0, activeDevelopers: 1 } }),
			),
		).toBe("has-data");
	});
});

describe("DEFAULT_PRESET", () => {
	test("matches the server's own default span", () => {
		// packages/worker/src/routes/stats.ts DEFAULT_SPAN_DAYS. If these drift,
		// the first render and the "28 days" button silently show different
		// windows while both look correct.
		expect(DEFAULT_PRESET).toBe(28);
		expect(WINDOW_PRESETS).toContain(DEFAULT_PRESET);
	});
});

describe("presetWindow", () => {
	test("counts back inclusively from today", () => {
		expect(presetWindow(7, "2026-07-26")).toEqual({
			from: "2026-07-20",
			to: "2026-07-26",
		});
		expect(presetWindow(28, "2026-07-26")).toEqual({
			from: "2026-06-29",
			to: "2026-07-26",
		});
	});

	test("the widest preset stays within the server's 92-day cap", () => {
		const w = presetWindow(92, "2026-07-26");
		const days =
			(Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) /
				86_400_000 +
			1;
		expect(days).toBe(92);
	});
});
