import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ownerLabel, useDataOwnerViewModel } from "./useDataOwnerViewModel";

const directory = {
	tenants: [
		{
			id: "default",
			name: "Default",
			members: [
				{ principal: "email:b@x.io", addedBy: "x", addedAt: 1 },
				{ principal: "service:ci", addedBy: "x", addedAt: 1 },
				{ principal: "email:a@x.io", addedBy: "x", addedAt: 1 },
			],
		},
	],
	admins: [],
};
let writes: { url: string; body: unknown }[] = [];
let fail: unknown = null;
beforeEach(() => {
	writes = [];
	fail = null;
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "PUT") {
				if (fail instanceof Error) throw fail;
				if (fail) return Response.json({ error: fail }, { status: 409 });
				writes.push({ url, body: JSON.parse(String(init.body)) });
				return Response.json({ dataOwner: null });
			}
			return Response.json(directory);
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("offers email members as candidates and assigns an owner", async () => {
	const onChanged = vi.fn(async () => {});
	const { result } = renderHook(() => useDataOwnerViewModel(true, onChanged));
	await waitFor(() =>
		expect(result.current.candidates).toEqual(["email:a@x.io", "email:b@x.io"]),
	);
	await act(() => result.current.assign("p1", "email:a@x.io"));
	await act(() => result.current.assign("p1", null));
	expect(writes).toEqual([
		{ url: "/api/projects/p1/data-owner", body: { dataOwner: "email:a@x.io" } },
		{ url: "/api/projects/p1/data-owner", body: { dataOwner: null } },
	]);
	expect(onChanged).toHaveBeenCalledTimes(2);
});

it("stays idle for non-admins and reports failures", async () => {
	const idle = renderHook(() =>
		useDataOwnerViewModel(
			false,
			vi.fn(async () => {}),
		),
	);
	expect(idle.result.current.candidates).toEqual([]);
	const { result } = renderHook(() =>
		useDataOwnerViewModel(
			true,
			vi.fn(async () => {}),
		),
	);
	fail = "The data owner must be a member of the project's tenant";
	await act(() => result.current.assign("p1", "email:z@x.io"));
	expect(result.current.error).toBe(fail);
	fail = new TypeError("x");
	await act(() => result.current.assign("p1", "email:z@x.io"));
	expect(result.current.error).toBe("Cannot reach the SignOff service.");
});

it("ignores overlapping assignments", async () => {
	let release: () => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "PUT") {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				throw "offline";
			}
			return Response.json(directory);
		}),
	);
	const { result } = renderHook(() =>
		useDataOwnerViewModel(
			true,
			vi.fn(async () => {}),
		),
	);
	let first: Promise<void> | undefined;
	act(() => {
		first = result.current.assign("p1", "email:a@x.io");
	});
	await waitFor(() => expect(result.current.busy).toBe("p1"));
	await act(() => result.current.assign("p2", "email:a@x.io"));
	await act(async () => {
		release();
		await first;
	});
	expect(result.current.error).toBe("Could not set the data owner.");
});

it("labels owners without the principal prefix", () => {
	expect(ownerLabel("email:a@x.io")).toBe("a@x.io");
	expect(ownerLabel(null)).toBe("No data owner");
});
