import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePageCollection } from "./usePageCollection";

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("collects the new page after navigation and cancels pending work after leaving the PR page", () => {
	const firstPage = vi.fn();
	const secondPage = vi.fn();
	const hook = renderHook(
		({ collect, pageKey }) => usePageCollection(collect, true, pageKey),
		{ initialProps: { collect: firstPage, pageKey: "page-1" } },
	);
	act(() => vi.advanceTimersByTime(600));
	expect(firstPage).toHaveBeenCalledOnce();
	const firstSignal: AbortSignal = firstPage.mock.calls[0]![0];
	expect(firstSignal.aborted).toBe(false);
	hook.rerender({ collect: secondPage, pageKey: "page-2" });
	expect(firstSignal.aborted).toBe(true);
	act(() => vi.advanceTimersByTime(600));
	expect(secondPage).toHaveBeenCalledOnce();
	const secondSignal: AbortSignal = secondPage.mock.calls[0]![0];
	expect(firstPage).toHaveBeenCalledOnce();
	hook.rerender({ collect: firstPage, pageKey: "page-1" });
	hook.unmount();
	expect(secondSignal.aborted).toBe(true);
	act(() => vi.advanceTimersByTime(30_000));
	expect(firstPage).toHaveBeenCalledOnce();
	expect(secondPage).toHaveBeenCalledOnce();
});

it("pauses in a hidden tab or when disabled and resumes due work when the tab becomes visible", () => {
	const collect = vi.fn();
	const { rerender } = renderHook(
		({ enabled }) => usePageCollection(collect, enabled, "page-1"),
		{ initialProps: { enabled: true } },
	);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	act(() => vi.advanceTimersByTime(5000));
	expect(collect).not.toHaveBeenCalled();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	act(() => vi.advanceTimersByTime(600));
	expect(collect).toHaveBeenCalledOnce();
	act(() => vi.advanceTimersByTime(5000));
	expect(collect).toHaveBeenCalledTimes(2);
	rerender({ enabled: false });
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	act(() => vi.advanceTimersByTime(30_000));
	expect(collect).toHaveBeenCalledTimes(2);
});
