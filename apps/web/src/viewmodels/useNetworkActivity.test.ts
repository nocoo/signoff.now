import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { useNetworkActivity } from "./useNetworkActivity";

vi.mock("@/lib/api", async (original) => ({
	...(await original<typeof import("@/lib/api")>()),
	apiFetch: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
test("reads local counts every ten seconds, pauses hidden and refreshes on return", async () => {
	vi.useFakeTimers();
	const visibility = vi
		.spyOn(document, "visibilityState", "get")
		.mockReturnValue("visible");
	vi.mocked(apiFetch).mockResolvedValue({
		asOf: 1,
		buckets: [{ at: 0, adoDiscovery: 1, adoDetails: 2, adoChecks: 3, jev: 4 }],
	});
	const { result } = renderHook(useNetworkActivity);
	await act(async () => {});
	expect(result.current.data?.buckets[0]?.jev).toBe(4);
	expect(apiFetch).toHaveBeenCalledTimes(1);
	await act(() => vi.advanceTimersByTimeAsync(9999));
	expect(apiFetch).toHaveBeenCalledTimes(1);
	await act(() => vi.advanceTimersByTimeAsync(1));
	expect(apiFetch).toHaveBeenCalledTimes(2);
	visibility.mockReturnValue("hidden");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	await act(() => vi.advanceTimersByTimeAsync(60000));
	expect(apiFetch).toHaveBeenCalledTimes(2);
	visibility.mockReturnValue("visible");
	await act(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(apiFetch).toHaveBeenCalledTimes(3);
	expect(apiFetch).toHaveBeenLastCalledWith("/api/query/v1/network", {
		signal: expect.any(AbortSignal),
	});
});
