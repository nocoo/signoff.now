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
			authenticated: true,
		});
	});
});
