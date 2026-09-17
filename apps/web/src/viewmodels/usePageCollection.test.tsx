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

it("announces all current-page PRs, keeps membership updates in the same round, and renews the foreground lease", () => {
	const publish = vi.fn().mockResolvedValue(true);
	const ids = Array.from({ length: 20 }, (_, i) => `pr-${i}`);
	const { rerender, unmount } = renderHook(
		({ pageKey, pullIds }) =>
			usePageCollection(publish, true, pageKey, pullIds),
		{ initialProps: { pageKey: "first", pullIds: ids } },
	);
	expect(publish).toHaveBeenLastCalledWith({
		visible: true,
		refresh: true,
		pageKey: "first",
		pullIds: ids,
	});
	act(() => vi.advanceTimersByTime(15_000));
	expect(publish).toHaveBeenLastCalledWith({
		visible: true,
		refresh: false,
		pageKey: "first",
		pullIds: ids,
	});
	rerender({ pageKey: "first", pullIds: ["new-pr", ...ids.slice(1)] });
	expect(publish).toHaveBeenCalledTimes(3);
	expect(publish.mock.calls[publish.mock.calls.length - 1]?.[0]).toMatchObject({
		refresh: false,
		visible: true,
		pullIds: ["new-pr", ...ids.slice(1)],
	});
	rerender({ pageKey: "second", pullIds: ["pr-21"] });
	expect(publish.mock.calls.slice(-2).map((call) => call[0])).toEqual([
		{ visible: false, refresh: false, pageKey: "first", pullIds: [] },
		{ visible: true, refresh: true, pageKey: "second", pullIds: ["pr-21"] },
	]);
	unmount();
	expect(publish).toHaveBeenLastCalledWith({
		visible: false,
		refresh: false,
		pageKey: "second",
		pullIds: [],
	});
	const count = publish.mock.calls.length;
	act(() => vi.advanceTimersByTime(60_000));
	expect(publish).toHaveBeenCalledTimes(count);
});

it("pauses immediately in the background and requests a new round immediately on foreground return", () => {
	const publish = vi.fn().mockResolvedValue(true);
	const { rerender } = renderHook(
		({ enabled }) => usePageCollection(publish, enabled, "page", ["pr"]),
		{ initialProps: { enabled: false } },
	);
	expect(publish).not.toHaveBeenCalled();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	rerender({ enabled: true });
	expect(publish).toHaveBeenLastCalledWith({
		visible: false,
		refresh: false,
		pageKey: "page",
		pullIds: [],
	});
	act(() => vi.advanceTimersByTime(60_000));
	expect(publish).toHaveBeenCalledTimes(1);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	expect(publish.mock.calls[publish.mock.calls.length - 1]?.[0]).toMatchObject({
		visible: true,
		refresh: true,
		pullIds: ["pr"],
	});
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	expect(publish.mock.calls[publish.mock.calls.length - 1]?.[0]).toMatchObject({
		visible: false,
		refresh: false,
	});
	rerender({ enabled: false });
	const count = publish.mock.calls.length;
	act(() => vi.advanceTimersByTime(60_000));
	expect(publish).toHaveBeenCalledTimes(count);
});

it("does not let a slow foreground request delay the hide notification or enqueue more work afterwards", async () => {
	let resolve!: (value: boolean) => void;
	const pending = new Promise<boolean>((done) => {
		resolve = done;
	});
	const publish = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(true);
	const { unmount } = renderHook(() =>
		usePageCollection(publish, true, "page", ["pr"]),
	);
	unmount();
	expect(publish).toHaveBeenCalledTimes(2);
	expect(publish.mock.calls[1]?.[0].visible).toBe(false);
	await act(async () => {
		resolve(true);
		await pending;
	});
	act(() => vi.advanceTimersByTime(60_000));
	expect(publish).toHaveBeenCalledTimes(2);
});
