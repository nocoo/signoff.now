import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMinuteNow } from "./useMinuteNow";

const NOW = 1_800_000_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW * 1000 + 500);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("advances the displayed age once a minute without fetching data", () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	const { result, unmount } = renderHook(useMinuteNow);
	expect(result.current).toBe(NOW);
	act(() => vi.advanceTimersByTime(59_999));
	expect(result.current).toBe(NOW);
	act(() => vi.advanceTimersByTime(1));
	expect(result.current).toBe(NOW + 60);
	act(() => vi.advanceTimersByTime(120_000));
	expect(result.current).toBe(NOW + 180);
	expect(fetch).not.toHaveBeenCalled();
	unmount();
	expect(vi.getTimerCount()).toBe(0);
});

it("catches up to wall-clock time on foreground return and cleans up its listener", () => {
	const { result, unmount } = renderHook(useMinuteNow);
	vi.setSystemTime((NOW + 300) * 1000);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	expect(result.current).toBe(NOW);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	expect(result.current).toBe(NOW + 300);
	const removeListener = vi.spyOn(document, "removeEventListener");
	unmount();
	expect(removeListener).toHaveBeenCalledWith(
		"visibilitychange",
		expect.any(Function),
	);
});
