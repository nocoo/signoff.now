import type { Connector } from "@signoff/domain/connector";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	guideProgress,
	useConnectorsViewModel,
} from "./useConnectorsViewModel";

const connector = (overrides: Partial<Connector> = {}): Connector => ({
	id: "c1",
	owner: "email:a@x.io",
	name: "Laptop",
	platform: "darwin-arm64",
	version: "0.3.0",
	createdAt: 1,
	expiresAt: 2,
	lastSeenAt: null,
	state: null,
	message: "",
	capabilities: {},
	online: false,
	revoked: false,
	...overrides,
});

it("walks the guide from install to a running connector", () => {
	expect(guideProgress([], 0).current).toBe("install");
	expect(guideProgress([connector({ revoked: true })], 0).current).toBe(
		"install",
	);
	expect(guideProgress([connector()], 0).current).toBe("owner");
	expect(guideProgress([connector()], 1).current).toBe("az");
	const signedIn = connector({
		capabilities: { az: { installed: true, loggedIn: true } },
	});
	expect(guideProgress([signedIn], 1).current).toBe("run");
	const running = guideProgress([{ ...signedIn, online: true }], 1);
	expect(running.current).toBeNull();
	expect(Object.values(running.done).every(Boolean)).toBe(true);
});

let calls: { url: string; method: string }[] = [];
let fail = false;
beforeEach(() => {
	calls = [];
	fail = false;
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			calls.push({ url, method });
			if (method === "DELETE" && fail)
				return Response.json({ error: "Connector not found" }, { status: 404 });
			return Response.json(
				method === "GET"
					? { connectors: [connector()], ownedProjects: [] }
					: { status: "revoked" },
			);
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("loads connectors, revokes one and reports failures", async () => {
	const { result } = renderHook(() => useConnectorsViewModel());
	await waitFor(() => expect(result.current.list.data).not.toBeNull());
	expect(result.current.progress.current).toBe("owner");
	await act(() => result.current.revoke("c1"));
	expect(calls.filter((c) => c.method === "DELETE")).toEqual([
		{ url: "/api/connectors/c1", method: "DELETE" },
	]);
	fail = true;
	await act(() => result.current.revoke("c1"));
	expect(result.current.error).toBe("Connector not found");
	expect(result.current.busy).toBeNull();
});

it("ignores a second revoke while one is running and names unknown errors", async () => {
	const { result } = renderHook(() => useConnectorsViewModel());
	await waitFor(() => expect(result.current.list.data).not.toBeNull());
	let release: () => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, method: init?.method ?? "GET" });
			if (init?.method === "DELETE") {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				throw "offline";
			}
			return Response.json({ connectors: [], ownedProjects: [] });
		}),
	);
	let first: Promise<void> | undefined;
	act(() => {
		first = result.current.revoke("c1");
	});
	await waitFor(() => expect(result.current.busy).toBe("c1"));
	await act(() => result.current.revoke("c2"));
	await act(async () => {
		release();
		await first;
	});
	expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
	expect(result.current.error).toBe("Could not revoke connector.");
});
