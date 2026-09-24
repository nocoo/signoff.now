import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Caller } from "../middleware/principal.js";
import type { AppEnv } from "../types.js";
import { meRoute } from "./me.js";

function me(caller?: Caller, access: Record<string, unknown> = {}) {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		if (caller) c.set("caller", caller);
		for (const [key, value] of Object.entries(access))
			c.set(key as "accessEmail", value as string);
		return next();
	});
	app.get("/api/me", meRoute);
	return Promise.resolve(app.request("http://x/api/me")).then((r) => r.json());
}

describe("meRoute", () => {
	test("anonymous without a resolved caller", async () => {
		expect(await me()).toEqual({
			authenticated: false,
			local: false,
			principal: null,
			email: null,
			name: null,
			service: false,
			admin: false,
			tenants: [],
			tenantId: null,
		});
	});

	test("local trust is an administrator without an identity", async () => {
		expect(await me({ kind: "local" })).toMatchObject({
			authenticated: false,
			local: true,
			admin: true,
			principal: null,
		});
	});

	test("a person reports admin and tenant selection", async () => {
		expect(
			await me(
				{
					kind: "person",
					principal: "email:a@b.com",
					admin: false,
					tenants: [{ id: "default", name: "Default" }],
					tenantId: "default",
				},
				{ accessEmail: "a@b.com", accessName: "A" },
			),
		).toEqual({
			authenticated: true,
			local: false,
			principal: "email:a@b.com",
			email: "a@b.com",
			name: "A",
			service: false,
			admin: false,
			tenants: [{ id: "default", name: "Default" }],
			tenantId: "default",
		});
	});

	test("a service token shows its Client ID, not a blank identity", async () => {
		// Cloudflare's service-token JWT carries no email. Without surfacing
		// `service`, the sidebar would render an empty name and an automated
		// session would be indistinguishable from a person's.
		expect(
			await me(
				{
					kind: "service",
					principal: "service:e367.access",
					admin: true,
					tenants: [],
					tenantId: null,
				},
				{ accessName: "e367.access" },
			),
		).toMatchObject({
			principal: "service:e367.access",
			email: null,
			name: "e367.access",
			service: true,
			admin: true,
		});
	});
});
