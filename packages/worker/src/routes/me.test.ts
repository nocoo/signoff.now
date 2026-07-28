import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { meRoute } from "./me.js";

describe("meRoute", () => {
	test("anonymous when not authenticated", async () => {
		const app = new Hono<AppEnv>();
		app.get("/api/me", meRoute);
		const res = await app.request("http://x/api/me");
		expect(await res.json()).toEqual({
			email: null,
			name: null,
			service: false,
			authenticated: false,
		});
	});

	test("returns principal when accessAuthenticated", async () => {
		const app = new Hono<AppEnv>();
		app.use("*", async (c, next) => {
			c.set("accessAuthenticated", true);
			c.set("accessEmail", "a@b.com");
			c.set("accessName", "A");
			return next();
		});
		app.get("/api/me", meRoute);
		const res = await app.request("http://x/api/me");
		expect(await res.json()).toEqual({
			email: "a@b.com",
			name: "A",
			service: false,
			authenticated: true,
		});
	});

	test("a service token shows its Client ID, not a blank identity", async () => {
		// Cloudflare's service-token JWT carries no email. Without surfacing
		// `service`, the sidebar would render an empty name and an automated
		// session would be indistinguishable from a person's.
		const app = new Hono<AppEnv>();
		app.use("*", async (c, next) => {
			c.set("accessAuthenticated", true);
			c.set("accessEmail", null);
			c.set("accessName", "e367826f93b8d71185e03fe518aff3b4.access");
			c.set("accessService", true);
			return next();
		});
		app.get("/api/me", meRoute);

		const res = await app.request("http://x/api/me");
		expect(await res.json()).toEqual({
			email: null,
			name: "e367826f93b8d71185e03fe518aff3b4.access",
			service: true,
			authenticated: true,
		});
	});
});
