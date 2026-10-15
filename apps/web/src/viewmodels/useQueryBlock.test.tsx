import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { awaitReactAct } from "@/test/reactAct";
import { useQueryBlock } from "./useQueryBlock";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("an explicit invalidation cannot display an older in-flight read while its replacement is pending", async () => {
	let old!: (value: number) => void;
	let latest!: (value: number) => void;
	const load = vi
		.fn()
		.mockResolvedValueOnce(1)
		.mockImplementationOnce(
			() =>
				new Promise<number>((resolve) => {
					old = resolve;
				}),
		)
		.mockImplementationOnce(
			() =>
				new Promise<number>((resolve) => {
					latest = resolve;
				}),
		);
	const { result } = renderHook(() => useQueryBlock("live", load));
	await awaitReactAct(async () => {});
	act(() => {
		void result.current.reload();
	});
	await awaitReactAct(async () => {});
	let refreshed!: Promise<unknown>;
	act(() => {
		refreshed = result.current.reload();
	});
	await awaitReactAct(async () => {
		old(2);
	});
	expect(result.current.data).toBe(1);
	expect(result.current.loading).toBe(false);
	await awaitReactAct(async () => {
		latest(3);
		await refreshed;
	});
	expect(result.current.data).toBe(3);
});

test.each(["response", "error"])(
	"a confirmed mutation fences an older in-flight %s",
	async (outcome) => {
		let release!: (value: { watching: boolean }) => void;
		let reject!: (error: Error) => void;
		const load = vi
			.fn()
			.mockResolvedValueOnce({ watching: false })
			.mockImplementationOnce(
				() =>
					new Promise<{ watching: boolean }>((resolve, fail) => {
						release = resolve;
						reject = fail;
					}),
			)
			.mockResolvedValue({ watching: false });
		const { result } = renderHook(() => useQueryBlock("live", load));
		await awaitReactAct(async () => {});
		let read!: Promise<unknown>;
		act(() => {
			read = result.current.reload();
		});
		await awaitReactAct(async () => {});
		act(() => result.current.update(() => ({ watching: true })));
		expect(result.current.loading).toBe(false);
		expect(result.current.data).toEqual({ watching: true });
		await awaitReactAct(async () => {
			if (outcome === "error") reject(new Error("Stale read failed"));
			else release({ watching: false });
			await read;
		});
		expect(result.current.data).toEqual({ watching: true });
		expect(result.current.refreshing).toBe(false);
		expect(result.current.error).toBeNull();
		// A subsequent server change (for example, CLI removal) is authoritative.
		await awaitReactAct(() => result.current.reload());
		expect(result.current.data).toEqual({ watching: false });
	},
);

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
	await awaitReactAct(async () => {});
	act(() => {
		visibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(signals[0]?.aborted).toBe(true);
	await awaitReactAct(async () => {
		resolve(1);
		await vi.advanceTimersByTimeAsync(10000);
	});
	expect(load).toHaveBeenCalledTimes(1);
	expect(result.current.data).toBeNull();
	await awaitReactAct(async () => {
		visibility = "visible";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(load).toHaveBeenCalledTimes(2);
	const pending: Promise<unknown>[] = [];
	act(() => {
		pending.push(result.current.reload(), result.current.reload());
	});
	await awaitReactAct(async () => {
		resolve(2);
	});
	expect(load).toHaveBeenCalledTimes(3);
	await awaitReactAct(async () => {
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
	await awaitReactAct(async () => {
		result.current.update(() => 7);
		await result.current.reload();
	});
	expect(result.current.loading).toBe(false);
	expect(result.current.data).toBeNull();
	expect(load).not.toHaveBeenCalled();
	rerender({ key: "live" });
	await awaitReactAct(async () => {});
	expect(load).not.toHaveBeenCalled();
	visibility.mockReturnValue("visible");
	await awaitReactAct(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(result.current.data).toBe(42);
	await awaitReactAct(async () => {
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
	await awaitReactAct(async () => {});
	expect(result.current.error).toBe("Unable to read cached data");
	await awaitReactAct(async () => {
		await vi.advanceTimersByTimeAsync(1999);
	});
	expect(load).toHaveBeenCalledTimes(1);
	await awaitReactAct(async () => {
		await vi.advanceTimersByTimeAsync(4001);
	});
	expect(load).toHaveBeenCalledTimes(3);
	expect(result.current.data).toBe(7);
	await awaitReactAct(async () => {
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
	await awaitReactAct(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(load).toHaveBeenCalledTimes(1);
	await awaitReactAct(async () => {
		release(10);
	});
	expect(result.current.data).toBe(10);
	load.mockRejectedValueOnce(new Error("Unavailable"));
	await awaitReactAct(async () => {
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
	await awaitReactAct(async () => {});
	rerender({ source: "sample" });
	await awaitReactAct(async () => {});
	expect(result.current.data).toBe("sample");
	await awaitReactAct(async () => {
		resolveOld("late live data");
	});
	expect(result.current.data).toBe("sample");
});
