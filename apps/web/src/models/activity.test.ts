import { describe, expect, it } from "vitest";
import {
	heatmapLevel,
	parseHeatmapResponse,
	parseHeatmapRow,
	parseTimelineItem,
	parseTimelineResponse,
} from "./activity";

describe("heatmapLevel", () => {
	it("zero when empty", () => {
		expect(heatmapLevel(0, 10)).toBe(0);
		expect(heatmapLevel(5, 0)).toBe(0);
	});

	it("buckets by ratio", () => {
		expect(heatmapLevel(1, 100)).toBe(1);
		expect(heatmapLevel(30, 100)).toBe(2);
		expect(heatmapLevel(60, 100)).toBe(3);
		expect(heatmapLevel(90, 100)).toBe(4);
	});
});

describe("parseHeatmapResponse", () => {
	it("parses rows and stale flags", () => {
		const res = parseHeatmapResponse({
			pipelineConfigVersion: 2,
			scoresStale: false,
			staleReason: null,
			rows: [
				{
					developerId: "d1",
					dayKey: "2026-07-01",
					total: 12,
					activityCount: 3,
				},
			],
		});
		expect(res.pipelineConfigVersion).toBe(2);
		expect(res.scoresStale).toBe(false);
		expect(res.rows).toEqual([
			{
				developerId: "d1",
				dayKey: "2026-07-01",
				total: 12,
				activityCount: 3,
			},
		]);
	});

	it("rejects non-object", () => {
		expect(() => parseHeatmapResponse(null)).toThrow(/Invalid heatmap/);
		expect(() => parseHeatmapResponse("x")).toThrow(/Invalid heatmap/);
	});

	it("rejects coerced types (no silent Boolean/Number)", () => {
		expect(() =>
			parseHeatmapResponse({
				pipelineConfigVersion: 1,
				scoresStale: "false",
				staleReason: null,
				rows: [],
			}),
		).toThrow(/scoresStale/);
		expect(() =>
			parseHeatmapResponse({
				pipelineConfigVersion: "1",
				scoresStale: false,
				staleReason: null,
				rows: [],
			}),
		).toThrow(/pipelineConfigVersion/);
	});

	it("rejects missing rows array", () => {
		expect(() =>
			parseHeatmapResponse({
				pipelineConfigVersion: 1,
				scoresStale: true,
				staleReason: "weights",
			}),
		).toThrow(/rows/);
	});

	it("accepts empty rows with stale string reason", () => {
		const res = parseHeatmapResponse({
			pipelineConfigVersion: 1,
			scoresStale: true,
			staleReason: "weights",
			rows: [],
		});
		expect(res.rows).toEqual([]);
		expect(res.staleReason).toBe("weights");
	});

	it("rejects incomplete heatmap row", () => {
		expect(() => parseHeatmapRow({})).toThrow(/developerId/);
	});
});

describe("parseTimelineResponse", () => {
	it("parses items and cursor", () => {
		const res = parseTimelineResponse({
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			items: [
				{
					id: "a1",
					type: "pr.merged",
					occurredAt: 100,
					dayKey: "2026-07-23",
					org: "o",
					project: "p",
					repoId: "r1",
					meta: { title: "t" },
				},
			],
			nextCursor: "abc",
		});
		expect(res.items).toHaveLength(1);
		expect(res.items[0]?.type).toBe("pr.merged");
		expect(res.nextCursor).toBe("abc");
	});

	it("requires items array and null nextCursor", () => {
		const res = parseTimelineResponse({
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			items: [],
			nextCursor: null,
		});
		expect(res.nextCursor).toBeNull();
		expect(res.items).toEqual([]);
	});

	it("rejects missing items", () => {
		expect(() =>
			parseTimelineResponse({
				pipelineConfigVersion: 1,
				scoresStale: false,
				staleReason: null,
				nextCursor: null,
			}),
		).toThrow(/items/);
	});

	it("rejects non-object timeline", () => {
		expect(() => parseTimelineResponse(undefined)).toThrow(/Invalid timeline/);
	});

	it("parses timeline item with null repoId", () => {
		const item = parseTimelineItem({
			id: "x",
			type: "pr.created",
			occurredAt: 1,
			dayKey: "2026-01-01",
			org: "o",
			project: "p",
			repoId: null,
			meta: { a: 1 },
		});
		expect(item.repoId).toBeNull();
		expect(item.meta).toEqual({ a: 1 });
	});

	it("rejects bad repoId type", () => {
		expect(() =>
			parseTimelineItem({
				id: "x",
				type: "t",
				occurredAt: 1,
				dayKey: "d",
				org: "o",
				project: "p",
				repoId: 1,
			}),
		).toThrow(/repoId/);
	});

	it("rejects non-string staleReason and nextCursor", () => {
		expect(() =>
			parseHeatmapResponse({
				pipelineConfigVersion: 1,
				scoresStale: false,
				staleReason: 1,
				rows: [],
			}),
		).toThrow(/staleReason/);
		expect(() =>
			parseTimelineResponse({
				pipelineConfigVersion: 1,
				scoresStale: false,
				staleReason: null,
				items: [],
				nextCursor: 1,
			}),
		).toThrow(/nextCursor/);
	});
});
