import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAdminViewModel } from "./useAdminViewModel";

const directory = {
	tenants: [{ id: "default", name: "Default", members: [] }],
	admins: [],
};
let calls: { url: string; method: string; body: unknown }[] = [];
let fail: string | null = null;
beforeEach(() => {
	calls = [];
	fail = null;
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			calls.push({
				url,
				method,
				body: init?.body ? JSON.parse(String(init.body)) : null,
			});
			if (method !== "GET" && fail)
				return Response.json({ error: fail }, { status: 400 });
			return Response.json(method === "GET" ? directory : { status: "ok" });
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const writes = () => calls.filter((c) => c.method !== "GET");

it("loads the directory and runs each write, then reloads", async () => {
	const { result } = renderHook(() => useAdminViewModel());
	await waitFor(() => expect(result.current.directory.data).toEqual(directory));
	await act(async () => {
		expect(await result.current.addMember("default", " a@x.io ")).toBe(true);
	});
	await act(async () => {
		await result.current.removeMember("default", "email:a@x.io");
		await result.current.addAdmin(" b@x.io ");
		await result.current.removeAdmin("email:b@x.io");
	});
	expect(writes().map((c) => [c.method, c.url, c.body])).toEqual([
		["POST", "/api/admin/tenants/default/members", { member: "a@x.io" }],
		["DELETE", "/api/admin/tenants/default/members/email%3Aa%40x.io", null],
		["POST", "/api/admin/admins", { member: "b@x.io" }],
		["DELETE", "/api/admin/admins/email%3Ab%40x.io", null],
	]);
	expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(4);
	expect(result.current.busy).toBeNull();
});

it("reports failures and ignores writes while busy", async () => {
	const { result } = renderHook(() => useAdminViewModel());
	await waitFor(() => expect(result.current.directory.data).not.toBeNull());
	fail = "Enter an email address or service:<client id>";
	await act(async () => {
		expect(await result.current.addAdmin("nope")).toBe(false);
	});
	expect(result.current.error).toBe(fail);

	fail = null;
	let release: () => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			calls.push({ url, method, body: null });
			if (method === "GET") return Response.json(directory);
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return Response.json({ status: "added" });
		}),
	);
	let first: Promise<boolean> | undefined;
	act(() => {
		first = result.current.addAdmin("a@x.io");
	});
	await waitFor(() => expect(result.current.busy).toBe("admin"));
	let second: boolean | undefined;
	await act(async () => {
		second = await result.current.addAdmin("b@x.io");
	});
	expect(second).toBe(false);
	await act(async () => {
		release();
		await first;
	});
	expect(await first).toBe(true);
	expect(writes().filter((c) => c.method === "POST")).toHaveLength(2);
});

it("uses a generic message for non-Error failures", async () => {
	const { result } = renderHook(() => useAdminViewModel());
	await waitFor(() => expect(result.current.directory.data).not.toBeNull());
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "POST") throw "offline";
			return Response.json(directory);
		}),
	);
	await act(async () => {
		await result.current.addAdmin("a@x.io");
	});
	expect(result.current.error).toBe("Administrator request failed.");
});
