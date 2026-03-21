/**
 * Reorder utilities tests — Phase 6 Commit #12b.
 *
 * TDD: tests written before implementation.
 * Tests cover:
 * - reorderItems: array reorder with sequential tabOrder assignment
 * - computeNextTabOrder: max+1 or 0 for empty arrays
 */

import { describe, expect, test } from "bun:test";
import { computeNextTabOrder, reorderItems } from "./reorder";

describe("reorderItems", () => {
	test("moves item from index 0 to index 2", () => {
		const items = [
			{ id: "a", tabOrder: 0 },
			{ id: "b", tabOrder: 1 },
			{ id: "c", tabOrder: 2 },
		];

		const result = reorderItems(items, 0, 2);

		expect(result.map((i) => i.id)).toEqual(["b", "c", "a"]);
		// tabOrder should be re-assigned sequentially
		expect(result.map((i) => i.tabOrder)).toEqual([0, 1, 2]);
	});

	test("moves item from index 2 to index 0", () => {
		const items = [
			{ id: "a", tabOrder: 0 },
			{ id: "b", tabOrder: 1 },
			{ id: "c", tabOrder: 2 },
		];

		const result = reorderItems(items, 2, 0);

		expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
		expect(result.map((i) => i.tabOrder)).toEqual([0, 1, 2]);
	});

	test("same from and to index returns items with sequential tabOrder", () => {
		const items = [
			{ id: "a", tabOrder: 5 },
			{ id: "b", tabOrder: 10 },
		];

		const result = reorderItems(items, 0, 0);

		expect(result.map((i) => i.id)).toEqual(["a", "b"]);
		expect(result.map((i) => i.tabOrder)).toEqual([0, 1]);
	});

	test("handles single-item array", () => {
		const items = [{ id: "a", tabOrder: 42 }];

		const result = reorderItems(items, 0, 0);

		expect(result).toEqual([{ id: "a", tabOrder: 0 }]);
	});

	test("handles empty array", () => {
		const result = reorderItems([], 0, 0);
		expect(result).toEqual([]);
	});

	test("normalizes non-sequential tabOrder values", () => {
		const items = [
			{ id: "a", tabOrder: 100 },
			{ id: "b", tabOrder: 200 },
			{ id: "c", tabOrder: 300 },
		];

		// Move b (index 1) to index 0
		const result = reorderItems(items, 1, 0);

		expect(result.map((i) => i.id)).toEqual(["b", "a", "c"]);
		expect(result.map((i) => i.tabOrder)).toEqual([0, 1, 2]);
	});

	test("preserves other properties on items", () => {
		const items = [
			{ id: "a", tabOrder: 0, name: "Alpha" },
			{ id: "b", tabOrder: 1, name: "Beta" },
		];

		const result = reorderItems(items, 1, 0);

		expect(result[0]).toEqual({ id: "b", tabOrder: 0, name: "Beta" });
		expect(result[1]).toEqual({ id: "a", tabOrder: 1, name: "Alpha" });
	});
});

describe("computeNextTabOrder", () => {
	test("returns 0 for empty array", () => {
		expect(computeNextTabOrder([])).toBe(0);
	});

	test("returns max+1 for non-empty array", () => {
		const items = [{ tabOrder: 0 }, { tabOrder: 1 }, { tabOrder: 2 }];
		expect(computeNextTabOrder(items)).toBe(3);
	});

	test("handles non-sequential tabOrder values", () => {
		const items = [{ tabOrder: 5 }, { tabOrder: 10 }, { tabOrder: 3 }];
		expect(computeNextTabOrder(items)).toBe(11);
	});

	test("handles negative tabOrder values", () => {
		const items = [{ tabOrder: -1 }, { tabOrder: 0 }];
		expect(computeNextTabOrder(items)).toBe(1);
	});

	test("handles single-item array", () => {
		expect(computeNextTabOrder([{ tabOrder: 7 }])).toBe(8);
	});

	test("handles null/undefined tabOrder by treating as 0", () => {
		const items = [{ tabOrder: null as unknown as number }, { tabOrder: 5 }];
		expect(computeNextTabOrder(items)).toBe(6);
	});
});
