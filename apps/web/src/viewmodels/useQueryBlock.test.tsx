import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useQueryBlock } from "./useQueryBlock";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("hidden pages abort reads; returning foreground reads once and concurrent reloads coalesce", async () => {
	vi.useFakeTimers();
	let visibility: DocumentVisibilityState = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(
		() => visibility,
	);
	const signals: AbortSignal[] = [];
	let resolve!: (value: number) => void;
	const load = vi.fn((signal: AbortSignal) => {
		signals.push(signal);
		return new Promise<number>((r) => {
			resolve = r;
		});
	});
	const { result, unmount } = renderHook(() =>
		useQueryBlock("live", load, 1000),
	);
	await act(async () => {});
	act(() => {
		visibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(signals[0]?.aborted).toBe(true);
	await act(async () => {
		resolve(1);
		await vi.advanceTimersByTimeAsync(10000);
	});
	expect(load).toHaveBeenCalledTimes(1);
	expect(result.current.data).toBeNull();
	await act(async () => {
		visibility = "visible";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(load).toHaveBeenCalledTimes(2);
	const pending: Promise<unknown>[] = [];
	act(() => {
		pending.push(result.current.reload(), result.current.reload());
	});
	await act(async () => {
		resolve(2);
	});
	expect(load).toHaveBeenCalledTimes(3);
	await act(async () => {
		resolve(3);
		await Promise.all(pending);
	});
	expect(result.current.data).toBe(3);
	unmount();
	expect(signals[signals.length - 1]?.aborted).toBe(true);
	await vi.advanceTimersByTimeAsync(10000);
	expect(load).toHaveBeenCalledTimes(3);
});

test("null keys and initially hidden blocks stay idle; manual blocks never set a polling timer", async () => {
	vi.useFakeTimers();
	const load = vi.fn(async () => 42);
	const visibility = vi
		.spyOn(document, "visibilityState", "get")
		.mockReturnValue("hidden");
	const { result, rerender } = renderHook(
		({ key }: { key: string | null }) => useQueryBlock(key, load, 0),
		{ initialProps: { key: null as string | null } },
	);
	await act(async () => {
		await result.current.reload();
	});
	expect(result.current.loading).toBe(false);
	expect(load).not.toHaveBeenCalled();
	rerender({ key: "live" });
	await act(async () => {});
	expect(load).not.toHaveBeenCalled();
	visibility.mockReturnValue("visible");
	await act(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(result.current.data).toBe(42);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60000);
	});
	expect(load).toHaveBeenCalledTimes(1);
});

test("repeated failures back off to four intervals, then success resets the delay", async () => {
	vi.useFakeTimers();
	const load = vi
		.fn()
		.mockRejectedValueOnce("network error")
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(7);
	const { result } = renderHook(() => useQueryBlock("live", load, 1000));
	await act(async () => {});
	expect(result.current.error).toBe("Unable to read cached data");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1999);
	});
	expect(load).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(4001);
	});
	expect(load).toHaveBeenCalledTimes(3);
	expect(result.current.data).toBe(7);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(load).toHaveBeenCalledTimes(4);
});
test("query polling waits for completion, preserves failed cache, and never overlaps", async () => {
	vi.useFakeTimers();
	let release!: (value: number) => void;
	const load = vi.fn(
		() =>
			new Promise<number>((resolve) => {
				release = resolve;
			}),
	);
	const { result } = renderHook(() => useQueryBlock("live", load, 1000));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(load).toHaveBeenCalledTimes(1);
	await act(async () => {
		release(10);
	});
	expect(result.current.data).toBe(10);
	load.mockRejectedValueOnce(new Error("Unavailable"));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(load).toHaveBeenCalledTimes(2);
	expect(result.current.data).toBe(10);
	expect(result.current.error).toBe("Unavailable");
});
test("source changes immediately hide old data and ignore late responses", async () => {
	let resolveOld!: (value: string) => void;
	const { result, rerender } = renderHook(
		({ source }) =>
			useQueryBlock(source, () =>
				source === "live"
					? new Promise<string>((resolve) => {
							resolveOld = resolve;
						})
					: Promise.resolve("sample"),
			),
		{ initialProps: { source: "live" } },
	);
	await act(async () => {});
	rerender({ source: "sample" });
	await act(async () => {});
	expect(result.current.data).toBe("sample");
	await act(async () => {
		resolveOld("late live data");
	});
	expect(result.current.data).toBe("sample");
});
