import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { loadCollections, loadMemberships } from "@/models/prCollectionsApi";
import {
	useCollectionMutation,
	useCollectionSearch,
	usePrCollections,
	usePrMemberships,
} from "./usePrCollections";

vi.mock("@/models/prCollectionsApi", () => ({
	loadCollections: vi.fn(),
	loadMemberships: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	vi.useRealTimers();
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("loads source-specific catalogs and only requests visible PR memberships", async () => {
	vi.mocked(loadCollections).mockResolvedValue({ items: [] });
	vi.mocked(loadMemberships).mockResolvedValue({ items: [] });
	const catalog = renderHook(() => usePrCollections("cli"));
	const members = renderHook(({ ids }) => usePrMemberships("demo", ids), {
		initialProps: { ids: [] as string[] },
	});
	await waitFor(() => expect(catalog.result.current.loading).toBe(false));
	expect(loadCollections).toHaveBeenCalledWith("cli", expect.any(AbortSignal));
	expect(loadMemberships).not.toHaveBeenCalled();
	members.rerender({ ids: ["p1", "p2"] });
	await waitFor(() => expect(members.result.current.loading).toBe(false));
	expect(loadMemberships).toHaveBeenLastCalledWith(
		"demo",
		["p1", "p2"],
		expect.any(AbortSignal),
	);
	members.rerender({ ids: ["p3"] });
	await waitFor(() =>
		expect(loadMemberships).toHaveBeenLastCalledWith(
			"demo",
			["p3"],
			expect.any(AbortSignal),
		),
	);
	members.unmount();
	expect(vi.mocked(loadMemberships).mock.lastCall?.[2].aborted).toBe(true);
});
test("mutation dedupes repeated clicks, reloads before completion, and can retry errors", async () => {
	const saved = deferred<string>(),
		reloaded = deferred<void>();
	const reload = vi.fn(() => reloaded.promise),
		work = vi.fn(() => saved.promise);
	const { result } = renderHook(() => useCollectionMutation(reload));
	let pending!: Promise<string | null>;
	act(() => {
		pending = result.current.run(work);
	});
	expect(result.current.busy).toBe(true);
	await act(async () => expect(await result.current.run(work)).toBeNull());
	expect(work).toHaveBeenCalledTimes(1);
	await act(async () => {
		saved.resolve("saved");
		await Promise.resolve();
	});
	expect(reload).toHaveBeenCalledTimes(1);
	expect(result.current.busy).toBe(true);
	await act(async () => {
		reloaded.resolve();
		expect(await pending).toBe("saved");
	});
	expect(result.current.busy).toBe(false);
	await act(async () => {
		expect(
			await result.current.run(() => Promise.reject(new Error("Conflict"))),
		).toBeNull();
	});
	expect(result.current.error).toBe("Conflict");
	await act(async () => {
		await result.current.run(() => Promise.reject("offline"));
	});
	expect(result.current.error).toBe("Could not update collection.");
	await act(async () => {
		expect(await result.current.run(() => Promise.resolve(true))).toBe(true);
	});
	expect(result.current.error).toBeNull();
});
test("unmounted mutations cannot publish results or run a follow-up reload", async () => {
	const work = deferred<string>(),
		reload = vi.fn(() => Promise.resolve());
	const { result, unmount } = renderHook(() => useCollectionMutation(reload));
	let pending!: Promise<string | null>;
	act(() => {
		pending = result.current.run(() => work.promise);
	});
	unmount();
	work.resolve("late");
	expect(await pending).toBeNull();
	expect(reload).not.toHaveBeenCalled();
	const refresh = deferred<void>();
	const second = renderHook(() => useCollectionMutation(() => refresh.promise));
	act(() => {
		pending = second.result.current.run(() => Promise.resolve("saved"));
	});
	await act(async () => {
		await Promise.resolve();
	});
	second.unmount();
	refresh.resolve();
	expect(await pending).toBeNull();
});
test("search debounce cancels obsolete terms and trims the query", async () => {
	vi.useFakeTimers();
	const { result, unmount } = renderHook(() => useCollectionSearch());
	act(() => {
		result.current.setSearch("old");
	});
	act(() => {
		vi.advanceTimersByTime(200);
		result.current.setSearch("  new PR  ");
	});
	act(() => {
		vi.advanceTimersByTime(299);
	});
	expect(result.current.query).toBe("");
	act(() => {
		vi.advanceTimersByTime(1);
	});
	expect(result.current.query).toBe("new PR");
	unmount();
	expect(vi.getTimerCount()).toBe(0);
});
