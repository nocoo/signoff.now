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

	it("defaults missing rows and maps staleReason", () => {
		const res = parseHeatmapResponse({
			pipelineConfigVersion: 1,
			scoresStale: true,
			staleReason: "weights",
		});
		expect(res.rows).toEqual([]);
		expect(res.staleReason).toBe("weights");
	});

	it("defaults missing numeric fields on rows", () => {
		const row = parseHeatmapRow({});
		expect(row).toEqual({
			developerId: "",
			dayKey: "",
			total: 0,
			activityCount: 0,
		});
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

	it("nulls missing nextCursor and empty items", () => {
		const res = parseTimelineResponse({
			pipelineConfigVersion: 1,
			scoresStale: false,
			items: [],
		});
		expect(res.nextCursor).toBeNull();
		expect(res.items).toEqual([]);
		expect(res.staleReason).toBeNull();
	});

	it("rejects non-object timeline", () => {
		expect(() => parseTimelineResponse(undefined)).toThrow(/Invalid timeline/);
	});

	it("defaults timeline item fields and null repoId", () => {
		const item = parseTimelineItem({ repoId: null });
		expect(item.id).toBe("");
		expect(item.type).toBe("");
		expect(item.occurredAt).toBe(0);
		expect(item.repoId).toBeNull();
		expect(item.meta).toEqual({});

		const withRepo = parseTimelineItem({
			id: "x",
			type: "pr.created",
			occurredAt: 1,
			dayKey: "2026-01-01",
			org: "o",
			project: "p",
			repoId: "r",
			meta: { a: 1 },
		});
		expect(withRepo.repoId).toBe("r");
		expect(withRepo.meta).toEqual({ a: 1 });
	});
});
