import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { liveRoute } from "./live.js";

describe("liveRoute", () => {
	test("returns ok", async () => {
		const app = new Hono<AppEnv>();
		app.get("/api/live", liveRoute);
		const res = await app.request("http://x/api/live");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, service: "signoff" });
	});
});
