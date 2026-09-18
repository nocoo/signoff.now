import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadMachinePulls } from "@/models/stateMachineApi";
import { useMachinePullPicker } from "./useMachinePullPicker";

vi.mock("@/models/stateMachineApi", () => ({ loadMachinePulls: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
const scope = { source: "cli" as const, projectId: "p", repositoryId: "repo" };
const item = (number: number) => ({
	id: `pr-${number}`,
	number,
	title: `PR ${number}`,
	watched: true,
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
it("loads one bounded page, coalesces scrolling, deduplicates results and stops at the end", async () => {
	vi.mocked(loadMachinePulls).mockResolvedValueOnce({
		data: [item(3), item(2)],
		nextCursor: "next",
	});
	const { result } = renderHook(() => useMachinePullPicker(scope, "", true));
	await waitFor(() => expect(result.current.items).toHaveLength(2));
	expect(loadMachinePulls).toHaveBeenCalledTimes(1);
	const pending = deferred<Awaited<ReturnType<typeof loadMachinePulls>>>();
	vi.mocked(loadMachinePulls).mockReturnValueOnce(pending.promise);
	let read!: Promise<void>;
	act(() => {
		read = result.current.loadMore();
		void result.current.loadMore();
	});
	expect(loadMachinePulls).toHaveBeenCalledTimes(2);
	expect(loadMachinePulls).toHaveBeenLastCalledWith(
		scope,
		{ search: "", watchedOnly: true, cursor: "next" },
		expect.any(AbortSignal),
	);
	await act(async () => {
		pending.resolve({ data: [item(2), item(1)], nextCursor: null });
		await read;
	});
	expect(result.current.items.map((pr) => pr.number)).toEqual([3, 2, 1]);
	await act(() => result.current.loadMore());
	expect(loadMachinePulls).toHaveBeenCalledTimes(2);
	vi.mocked(loadMachinePulls).mockResolvedValueOnce({
		data: [item(4)],
		nextCursor: null,
	});
	await act(() => result.current.reload());
	expect(result.current.items.map((pr) => pr.number)).toEqual([4]);
});
it("debounces searches and fences late pages when search, watch filter or source changes", async () => {
	const late = deferred<Awaited<ReturnType<typeof loadMachinePulls>>>();
	vi.mocked(loadMachinePulls)
		.mockReturnValueOnce(late.promise)
		.mockResolvedValue({ data: [item(42)], nextCursor: null });
	const { result, rerender, unmount } = renderHook(
		({ search, watchedOnly, source }) =>
			useMachinePullPicker({ ...scope, source }, search, watchedOnly),
		{
			initialProps: {
				search: "",
				watchedOnly: true,
				source: "cli" as "cli" | "demo",
			},
		},
	);
	await waitFor(() => expect(loadMachinePulls).toHaveBeenCalledTimes(1));
	const originalSignal = vi.mocked(loadMachinePulls).mock.calls[0]![2];
	rerender({ search: "4", watchedOnly: true, source: "cli" });
	rerender({ search: "42", watchedOnly: false, source: "demo" });
	expect(result.current.items).toEqual([]);
	expect(originalSignal.aborted).toBe(true);
	await act(async () => late.resolve({ data: [item(1)], nextCursor: "old" }));
	await waitFor(() => expect(result.current.items[0]?.number).toBe(42));
	expect(loadMachinePulls).toHaveBeenCalledTimes(2);
	expect(loadMachinePulls).toHaveBeenLastCalledWith(
		{ ...scope, source: "demo" },
		{ search: "42", watchedOnly: false, cursor: null },
		expect.any(AbortSignal),
	);
	const lastSignal = vi.mocked(loadMachinePulls).mock.lastCall![2];
	unmount();
	expect(lastSignal.aborted).toBe(true);
});
it("retains loaded choices after a page error and retries the same cursor", async () => {
	vi.mocked(loadMachinePulls)
		.mockResolvedValueOnce({ data: [item(2)], nextCursor: "next" })
		.mockRejectedValueOnce(new Error("Offline"))
		.mockResolvedValueOnce({ data: [item(1)], nextCursor: null });
	const { result } = renderHook(() => useMachinePullPicker(scope, "", false));
	await waitFor(() => expect(result.current.items).toHaveLength(1));
	await act(() => result.current.loadMore());
	expect(result.current.error).toBe("Offline");
	expect(result.current.items).toEqual([item(2)]);
	await act(() => result.current.loadMore());
	expect(result.current.items).toHaveLength(2);
	expect(result.current.error).toBeNull();
	expect(
		vi
			.mocked(loadMachinePulls)
			.mock.calls.slice(1)
			.map((call) => call[1].cursor),
	).toEqual(["next", "next"]);
});
it("waits for a project and reports first-page failures without leaving loading stuck", async () => {
	vi.mocked(loadMachinePulls)
		.mockRejectedValueOnce("offline")
		.mockResolvedValueOnce({ data: [], nextCursor: null });
	const { result, rerender } = renderHook(
		({ projectId }) => useMachinePullPicker({ ...scope, projectId }, "", true),
		{ initialProps: { projectId: "" } },
	);
	await act(() => result.current.loadMore());
	expect(loadMachinePulls).not.toHaveBeenCalled();
	rerender({ projectId: "p" });
	await waitFor(() => expect(result.current.error).toBe("Unable to load PRs"));
	expect(result.current.loading).toBe(false);
	await act(() => result.current.loadMore());
	expect(result.current.error).toBeNull();
	expect(result.current.hasMore).toBe(false);
});
