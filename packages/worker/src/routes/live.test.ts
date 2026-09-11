import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { version } from "../../../../package.json";
import type { AppEnv } from "../types.js";
import { liveRoute } from "./live.js";

describe("liveRoute", () => {
	function request(first: () => Promise<{ healthy: number } | null>) {
		const app = new Hono<AppEnv>();
		app.get("/api/live", liveRoute);
		return app.request(
			"http://x/api/live",
			{},
			{
				DB: { prepare: () => ({ first }) } as unknown as D1Database,
			},
		);
	}

	test("reports the deployed version and a real database check without caching", async () => {
		const res = await request(async () => ({ healthy: 1 }));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({
			ok: true,
			service: "signoff",
			status: "ok",
			version,
			database: { connected: true },
		});
	});

	test("does not call an empty database result healthy", async () => {
		const res = await request(async () => null);
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ status: "error" });
	});

	test("reports database failure without exposing diagnostics or caching", async () => {
		const res = await request(async () => {
			throw new Error("private-database-diagnostics");
		});
		expect(res.status).toBe(503);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({
			ok: false,
			service: "signoff",
			status: "error",
			version,
			database: { connected: false },
		});
	});
});
