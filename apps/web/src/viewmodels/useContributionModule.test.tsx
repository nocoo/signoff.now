import {
	type ContributionSnapshot,
	contributionFiltersSchema,
} from "@signoff/domain/insights";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculateContribution,
	fetchContribution,
} from "@/models/contributionsApi";
import { useContributionModule } from "./useContributionModule";

vi.mock("@/models/contributionsApi", () => ({
	fetchContribution: vi.fn(),
	calculateContribution: vi.fn(),
}));
const read = vi.mocked(fetchContribution);
const calculate = vi.mocked(calculateContribution);
const filters = contributionFiltersSchema.parse({ source: "cli" });
const saved = {
	module: "overview",
	filters,
	calculatedAt: 100,
	totals: { total: 2 },
} as ContributionSnapshot;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
beforeEach(() => {
	vi.clearAllMocks();
	read.mockResolvedValue(null);
});

describe("manual statistics lifecycle", () => {
	it("reads on mount, never calculates for elapsed time, and ignores equivalent filter objects", async () => {
		const { result, rerender, unmount } = renderHook(
			({ scope }) => useContributionModule("overview", scope),
			{ initialProps: { scope: filters } },
		);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.snapshot).toBeNull();
		expect(calculate).not.toHaveBeenCalled();
		vi.useFakeTimers();
		act(() => {
			vi.advanceTimersByTime(4 * 86400_000);
		});
		rerender({ scope: { ...filters } });
		expect(read).toHaveBeenCalledTimes(1);
		expect(calculate).not.toHaveBeenCalled();
		unmount();
		vi.useRealTimers();
	});
	it("deduplicates manual refresh, supersedes an initial GET, and preserves the last good result on failure", async () => {
		const initial = deferred<ContributionSnapshot | null>();
		const refresh = deferred<ContributionSnapshot>();
		read.mockReturnValue(initial.promise);
		calculate.mockReturnValue(refresh.promise);
		const { result } = renderHook(() =>
			useContributionModule("overview", filters),
		);
		let first!: Promise<void>;
		act(() => {
			first = result.current.refresh();
			void result.current.refresh();
		});
		expect(calculate).toHaveBeenCalledTimes(1);
		expect(result.current.refreshing).toBe(true);
		await act(async () => {
			refresh.resolve(saved);
			await first;
			initial.resolve(null);
			await initial.promise;
		});
		expect(result.current.snapshot).toEqual(saved);
		calculate.mockRejectedValueOnce(
			new Error("Collector database unavailable"),
		);
		await act(async () => {
			await result.current.refresh();
		});
		expect(result.current.snapshot).toEqual(saved);
		expect(result.current.error).toBe("Collector database unavailable");
		expect(result.current.refreshing).toBe(false);
	});

	it("never displays old-source results or failures after switching source, filters, or unmounting", async () => {
		const old = deferred<ContributionSnapshot | null>();
		const write = deferred<ContributionSnapshot>();
		read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(null);
		calculate.mockReturnValue(write.promise);
		const { result, rerender, unmount } = renderHook(
			({ scope }) => useContributionModule("overview", scope),
			{ initialProps: { scope: filters } },
		);
		act(() => {
			void result.current.refresh();
		});
		rerender({ scope: { ...filters, source: "demo" } });
		expect(result.current.snapshot).toBeNull();
		await act(async () => {
			old.resolve(saved);
			write.reject("Old source failed");
			await old.promise;
		});
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.snapshot).toBeNull();
		expect(result.current.error).toBeNull();
		const later = deferred<ContributionSnapshot>();
		calculate.mockReturnValue(later.promise);
		act(() => {
			void result.current.refresh();
		});
		unmount();
		await act(async () => {
			later.resolve(saved);
			await later.promise;
		});
	});

	it("clears invalid scopes, handles read failure, and can recover with a manual calculation", async () => {
		read.mockRejectedValueOnce("No network");
		const { result, rerender } = renderHook(
			({ scope }) => useContributionModule("overview", scope),
			{ initialProps: { scope: filters as typeof filters | null } },
		);
		await waitFor(() =>
			expect(result.current.error).toBe("Could not load statistics"),
		);
		calculate.mockRejectedValueOnce("No network");
		await act(async () => {
			await result.current.refresh();
		});
		expect(result.current.error).toBe("Could not calculate statistics");
		calculate.mockResolvedValue(saved);
		await act(async () => {
			await result.current.refresh();
		});
		expect(result.current.error).toBeNull();
		rerender({ scope: null });
		await act(async () => {
			await result.current.refresh();
		});
		expect(result.current.snapshot).toBeNull();
		expect(result.current.loading).toBe(false);
	});
});
