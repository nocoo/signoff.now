import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayName, loadSession } from "./sessionApi";

const session = {
	authenticated: true,
	local: false,
	principal: "email:a@x.io",
	email: "a@x.io",
	name: "Ada",
	service: false,
	admin: false,
	tenants: [{ id: "default", name: "Default" }],
	tenantId: "default",
};
let replies: unknown[] = [];
const headers: (string | null)[] = [];
beforeEach(() => {
	localStorage.clear();
	headers.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			headers.push(
				(init?.headers as Record<string, string>)["x-signoff-tenant"] ?? null,
			);
			return Response.json(replies.shift());
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());

describe("loadSession", () => {
	it("sends the stored tenant and keeps a usable selection", async () => {
		localStorage.setItem("signoff-tenant", "default");
		replies = [session];
		expect(await loadSession()).toEqual(session);
		expect(headers).toEqual(["default"]);
	});

	it("clears a stale tenant and reads the server default", async () => {
		localStorage.setItem("signoff-tenant", "gone");
		replies = [{ ...session, tenantId: null }, session];
		expect((await loadSession()).tenantId).toBe("default");
		expect(headers).toEqual(["gone", null]);
		expect(localStorage.getItem("signoff-tenant")).toBeNull();
	});

	it("keeps an unassigned session without retrying", async () => {
		replies = [{ ...session, tenants: [], tenantId: null }];
		expect((await loadSession()).tenantId).toBeNull();
		expect(headers).toEqual([null]);
	});
});

describe("displayName", () => {
	it("prefers local, then name, email and principal", () => {
		expect(displayName({ ...session, local: true })).toBe("Local");
		expect(displayName(session)).toBe("Ada");
		expect(displayName({ ...session, name: null })).toBe("a@x.io");
		expect(displayName({ ...session, name: null, email: null })).toBe(
			"email:a@x.io",
		);
		expect(
			displayName({ ...session, name: null, email: null, principal: null }),
		).toBe("Signed out");
	});
});
