/**
 * Reorder utilities for workspace and project tab ordering.
 *
 * Pure functions — no database dependency.
 */

interface HasTabOrder {
	tabOrder: number;
}

/**
 * Moves an item from `fromIndex` to `toIndex` in an array and
 * re-assigns sequential `tabOrder` values (0, 1, 2, ...).
 *
 * Returns a new array — the input is not mutated.
 */
export function reorderItems<T extends HasTabOrder>(
	items: T[],
	fromIndex: number,
	toIndex: number,
): T[] {
	if (items.length === 0) return [];

	const result = [...items];
	const [moved] = result.splice(fromIndex, 1);
	result.splice(toIndex, 0, moved);

	return result.map((item, index) => ({
		...item,
		tabOrder: index,
	})) as T[];
}

/**
 * Returns the next available `tabOrder` value for a list of items.
 * For an empty list returns 0, otherwise returns max(tabOrder) + 1.
 */
export function computeNextTabOrder(items: HasTabOrder[]): number {
	if (items.length === 0) return 0;
	const max = Math.max(...items.map((i) => i.tabOrder ?? 0));
	return max + 1;
}
