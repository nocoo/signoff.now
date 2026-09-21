import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	loadCollectionJob,
	loadCollectorHistory,
} from "@/models/monitoringApi";
import { fixtureJob } from "@/test/monitoring-fixture";
import { useCollectorHistoryViewModel } from "./useCollectorHistoryViewModel";

vi.mock("@/models/monitoringApi", () => ({
	loadCollectionJob: vi.fn(),
	loadCollectorHistory: vi.fn(),
}));
beforeEach(() => {
	vi.mocked(loadCollectorHistory).mockResolvedValue({
		data: [],
		nextCursor: "next",
	});
	vi.mocked(loadCollectionJob).mockResolvedValue(fixtureJob());
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});
test("loads history only while mounted, pages and resets selection with filters", async () => {
	const { result, unmount } = renderHook(() =>
		useCollectorHistoryViewModel("cli"),
	);
	await waitFor(() => expect(result.current.history.loading).toBe(false));
	expect(loadCollectionJob).not.toHaveBeenCalled();
	act(() => result.current.select("job-1"));
	await waitFor(() => expect(result.current.detail.data?.id).toBe("job-1"));
	act(() => result.current.older());
	await waitFor(() =>
		expect(loadCollectorHistory).toHaveBeenLastCalledWith(
			"cli",
			{ lane: "all", outcome: "all", cursor: "next" },
			expect.any(AbortSignal),
		),
	);
	expect(result.current.page).toBe(2);
	expect(result.current.selectedId).toBeNull();
	act(() => result.current.newer());
	await waitFor(() => expect(result.current.page).toBe(1));
	act(() => result.current.setFilters({ lane: "checks", outcome: "issues" }));
	await waitFor(() =>
		expect(loadCollectorHistory).toHaveBeenLastCalledWith(
			"cli",
			{ lane: "checks", outcome: "issues", cursor: undefined },
			expect.any(AbortSignal),
		),
	);
	unmount();
	expect(vi.mocked(loadCollectorHistory).mock.lastCall?.[2].aborted).toBe(true);
});
test("reports history failures and does not advance without another page", async () => {
	vi.mocked(loadCollectorHistory).mockRejectedValueOnce(
		new Error("History offline"),
	);
	const { result } = renderHook(() => useCollectorHistoryViewModel("demo"));
	await waitFor(() =>
		expect(result.current.history.error).toBe("History offline"),
	);
	act(() => result.current.older());
	expect(result.current.page).toBe(1);
	vi.mocked(loadCollectorHistory).mockResolvedValue({
		data: [],
		nextCursor: null,
	});
	await act(() => result.current.history.reload());
	expect(result.current.history.error).toBeNull();
	act(() => result.current.older());
	expect(result.current.page).toBe(1);
	vi.mocked(loadCollectionJob).mockRejectedValue(new Error("Task expired"));
	act(() => result.current.select("gone"));
	await waitFor(() => expect(result.current.detail.error).toBe("Task expired"));
});
