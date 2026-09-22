import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
	loadCollectionPulls,
	loadCollections,
	loadMemberships,
} from "@/models/prCollectionsApi";
import {
	useCollectionMutation,
	useCollectionPullList,
	useCollectionSearch,
	usePrCollections,
	usePrMemberships,
} from "./usePrCollections";

vi.mock("@/models/prCollectionsApi", () => ({
	loadCollections: vi.fn(),
	loadMemberships: vi.fn(),
	loadCollectionPulls: vi.fn(),
}));

import type { PullRow } from "@/models/workbench";
import { queryFixture } from "@/test/monitoring-fixture";

vi.mock("./WorkbenchProvider", () => ({
	useWorkbench: () => ({ withWatchState: (row: PullRow) => row, metrics: {} }),
}));
afterEach(() => {
	cleanup();
	localStorage.clear();
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

test("collection list includes history, selects all members and resets selection on shared filters", async () => {
	const fixture = queryFixture().pulls;
	fixture.data.push({ ...fixture.data[0]!, id: "merged", state: "merged" });
	vi.mocked(loadCollectionPulls).mockResolvedValue(fixture);
	const { result } = renderHook(() => useCollectionPullList("cli", "c1"));
	expect(result.current.pullsLoaded).toBe(false);
	await waitFor(() => expect(result.current.pullsLoaded).toBe(true));
	expect(result.current.rows).toHaveLength(2);
	expect(result.current.authors).toEqual(fixture.authors);
	expect(result.current.metrics).toEqual(fixture.metrics);
	const params = new URLSearchParams(
		vi.mocked(loadCollectionPulls).mock.calls[0]![0],
	);
	expect(params.get("collectionId")).toBe("c1");
	expect(params.get("state")).toBe("all");
	expect(params.get("draft")).toBe("include");
	act(() => result.current.selectAll(true));
	expect(result.current.selectedIds.size).toBe(2);
	act(() => result.current.toggleSelection("merged", false));
	expect(result.current.selectedIds.size).toBe(1);
	act(() => result.current.toggleSelection("merged", true));
	expect(result.current.selectedRows).toHaveLength(2);
	act(() => result.current.setFilter({ status: "attention" }));
	expect(result.current.filter.state).toBe("open");
	expect(result.current.selectedIds.size).toBe(0);
	act(() => result.current.setFilter({ query: " target " }));
	await waitFor(() =>
		expect(
			new URLSearchParams(vi.mocked(loadCollectionPulls).mock.lastCall![0]).get(
				"q",
			),
		).toBe("target"),
	);
	act(() => result.current.selectAll(false));
	expect(result.current.selectedIds.size).toBe(0);
});

test("restores collection filters and sort before the first cached query without selecting rows", async () => {
	vi.mocked(loadCollectionPulls).mockResolvedValue(queryFixture().pulls);
	const first = renderHook(() => useCollectionPullList("cli", "saved"));
	await waitFor(() => expect(first.result.current.pullsLoaded).toBe(true));
	act(() =>
		first.result.current.setFilter({
			state: "open",
			draft: "only",
			query: "review",
			authors: ["author-key"],
			watching: "unwatched",
			sort: "title",
			sortDirection: "desc",
		}),
	);
	const saved = first.result.current.filter;
	first.unmount();
	vi.mocked(loadCollectionPulls).mockClear();
	const restored = renderHook(() => useCollectionPullList("cli", "saved"));
	expect(restored.result.current.filter).toEqual(saved);
	expect(restored.result.current.selectedIds.size).toBe(0);
	await waitFor(() => expect(loadCollectionPulls).toHaveBeenCalled());
	const query = new URLSearchParams(
		vi.mocked(loadCollectionPulls).mock.calls[0]![0],
	);
	expect(query.get("q")).toBe("review");
	expect(query.get("draft")).toBe("only");
	expect(query.get("sort")).toBe("title");
	expect(query.get("direction")).toBe("desc");
	expect(query.getAll("author")).toEqual(["author-key"]);
	const other = renderHook(() => useCollectionPullList("cli", "other"));
	expect(other.result.current.filter).toMatchObject({
		state: "all",
		draft: "include",
		query: "",
		sort: "updated",
		sortDirection: "desc",
	});
});
