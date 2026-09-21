import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAiPresence } from "./useAiPresence";
import { useAiScheduleViewModel } from "./useAiScheduleViewModel";

const schedule = {
	revision: 1,
	cooldownSeconds: 300,
	foreground: true,
	projects: [],
};
let calls: {
	url: string;
	body: Record<string, unknown> | null;
	init: RequestInit | undefined;
}[];
let focused = true;
let reply: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
	calls = [];
	focused = true;
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
	reply = async () => Response.json(schedule);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url, init) => {
			calls.push({
				url: String(url),
				body: init?.body ? JSON.parse(String(init.body)) : null,
				init,
			});
			return reply(String(url), init);
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("publishes only foreground presence, ticks on return and retires old sources on unmount", async () => {
	vi.useFakeTimers();
	const hook = renderHook(
		({ source }: { source: "cli" | "demo" }) => useAiPresence(source),
		{ initialProps: { source: "cli" } },
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(calls.map((c) => c.url)).toEqual(["/api/ai/presence", "/api/ai/tick"]);
	expect(calls[0]?.init?.keepalive).toBe(true);
	const tick = calls[1]!;
	expect(tick.body).toEqual({
		id: calls[0]?.body?.id,
		sequence: 1,
		source: "cli",
	});
	focused = false;
	act(() => window.dispatchEvent(new Event("blur")));
	expect(tick.init?.signal?.aborted).toBe(true);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(calls.filter((c) => c.url.endsWith("tick"))).toHaveLength(1);
	expect(calls[calls.length - 1]?.body?.visible).toBe(false);
	focused = true;
	act(() => window.dispatchEvent(new Event("focus")));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(calls.filter((c) => c.url.endsWith("tick"))).toHaveLength(2);
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "hidden",
	});
	act(() => document.dispatchEvent(new Event("visibilitychange")));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(calls[calls.length - 1]?.body?.visible).toBe(false);
	act(() => window.dispatchEvent(new Event("pagehide")));
	hook.rerender({ source: "demo" });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(calls[calls.length - 1]?.body?.source).toBe("demo");
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	act(() => window.dispatchEvent(new Event("pageshow")));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	hook.unmount();
	expect(calls[calls.length - 1]?.body?.visible).toBe(false);
});
it("late visibility receipts and overlapping ticks cannot start background work; network failures recover", async () => {
	vi.useFakeTimers();
	let release: (r: Response) => void = () => undefined;
	reply = () =>
		new Promise((r) => {
			release = r;
		});
	const hook = renderHook(() => useAiPresence("cli"));
	focused = false;
	act(() => window.dispatchEvent(new Event("blur")));
	await act(async () => {
		release(Response.json({ saved: true }));
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(calls.every((c) => c.url.endsWith("presence"))).toBe(true);
	reply = async () => {
		throw Error("offline");
	};
	focused = true;
	act(() => window.dispatchEvent(new Event("focus")));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	reply = async (url) =>
		url.endsWith("tick")
			? new Promise((r) => {
					release = r;
				})
			: Response.json({ saved: true });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(calls.filter((c) => c.url.endsWith("tick"))).toHaveLength(1);
	await act(async () => {
		release(Response.json({ processed: false }));
		await vi.advanceTimersByTimeAsync(0);
	});
	hook.unmount();
});
it("loads and saves schedule with its revision and reports CAS errors", async () => {
	const hook = renderHook(() => useAiScheduleViewModel("cli"));
	await waitFor(() =>
		expect(hook.result.current.data?.cooldownSeconds).toBe(300),
	);
	await act(async () => {
		await hook.result.current.save(600);
	});
	expect(calls.find((c) => c.init?.method === "PUT")?.body).toEqual({
		revision: 1,
		cooldownSeconds: 600,
	});
	reply = async () =>
		Response.json({ error: "Changed; reload" }, { status: 409 });
	await act(async () => {
		await hook.result.current.save(60);
	});
	expect(hook.result.current.mutationError).toBe("Changed; reload");
	expect(hook.result.current.saving).toBe(false);
});
it("saving waits for data and guards concurrent writes", async () => {
	let release: (r: Response) => void = () => undefined;
	reply = () =>
		new Promise((r) => {
			release = r;
		});
	const hook = renderHook(() => useAiScheduleViewModel("demo"));
	await act(async () => {
		await hook.result.current.save(600);
	});
	expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
	await act(async () => {
		release(Response.json(schedule));
	});
	await waitFor(() => expect(hook.result.current.data).not.toBeNull());
	let save: Promise<void>;
	act(() => {
		save = hook.result.current.save(600);
	});
	await act(async () => {
		await hook.result.current.save(60);
	});
	expect(calls.filter((c) => c.init?.method === "PUT")).toHaveLength(1);
	reply = async () => Response.json(schedule);
	await act(async () => {
		release(Response.json({ saved: true }));
		await save;
	});
});
