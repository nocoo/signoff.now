import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { loadCollectorGroups } from "@/models/monitoringApi";
import { useCollectorGroupsViewModel } from "./useCollectorGroupsViewModel";

vi.mock("@/models/monitoringApi", () => ({ loadCollectorGroups: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	vi.useRealTimers();
});
test("paginates stable groups and preserves selection during refresh", async () => {
	vi.mocked(loadCollectorGroups).mockResolvedValue({
		data: [],
		nextCursor: "page-2",
		generatedAt: new Date().toISOString(),
	});
	const { result } = renderHook(() => useCollectorGroupsViewModel("cli"));
	await waitFor(() => expect(result.current.groups.loading).toBe(false));
	act(() => result.current.newer());
	expect(result.current.page).toBe(1);
	act(() => result.current.select("pr:one"));
	await act(() => result.current.groups.reload());
	expect(result.current.selected).toBe("pr:one");
	act(() => result.current.select("pr:one"));
	expect(result.current.selected).toBeNull();
	act(() => result.current.select("pr:one"));
	act(() => result.current.older());
	expect(result.current.selected).toBeNull();
	await waitFor(() =>
		expect(loadCollectorGroups).toHaveBeenLastCalledWith(
			"cli",
			"page-2",
			expect.any(AbortSignal),
		),
	);
	expect(result.current.page).toBe(2);
	vi.mocked(loadCollectorGroups).mockResolvedValue({
		data: [],
		nextCursor: null,
		generatedAt: new Date().toISOString(),
	});
	await act(() => result.current.groups.reload());
	act(() => result.current.older());
	expect(result.current.page).toBe(2);
	act(() => result.current.newer());
	expect(result.current.page).toBe(1);
});
test("updates the clock every second only while mounted", async () => {
	vi.useFakeTimers();
	vi.mocked(loadCollectorGroups).mockResolvedValue({
		data: [],
		nextCursor: null,
		generatedAt: new Date().toISOString(),
	});
	const { result, unmount } = renderHook(() =>
		useCollectorGroupsViewModel("cli"),
	);
	const start = result.current.now;
	await act(() => vi.advanceTimersByTimeAsync(1000));
	expect(result.current.now).toBe(start + 1);
	unmount();
});
