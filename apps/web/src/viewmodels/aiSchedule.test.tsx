import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAiScheduleViewModel } from "./useAiScheduleViewModel";

const schedule = {
	revision: 1,
	cooldownSeconds: 300,

	projects: [],
};
let calls: {
	url: string;
	body: Record<string, unknown> | null;
	init: RequestInit | undefined;
}[];
let reply: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
	calls = [];
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
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
