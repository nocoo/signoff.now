import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { accessAuth, setAccessJwtVerifierForTests } from "./access-auth.js";

afterEach(() => {
	setAccessJwtVerifierForTests(null);
});

describe("accessAuth middleware", () => {
	function app(env: Partial<AppEnv["Bindings"]> = {}) {
		const a = new Hono<AppEnv>();
		a.use("*", async (c, next) => {
			c.env = {
				DB: {} as D1Database,
				...env,
			};
			return next();
		});
		a.use("*", accessAuth);
		a.get("*", (c) =>
			c.json({
				ok: true,
				auth: c.get("accessAuthenticated") === true,
				email: c.get("accessEmail") ?? null,
				name: c.get("accessName") ?? null,
			}),
		);
		return a;
	}

	const accessEnv = {
		CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
		CF_ACCESS_AUD: "aud-tag",
	};

	test("skips on localhost", async () => {
		const res = await app().request("http://localhost/api/settings", {
			headers: { host: "127.0.0.1:37042" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			auth: false,
			email: null,
			name: null,
		});
	});

	test("skips on *.dev.hexly.ai", async () => {
		const res = await app().request(
			"http://signoff.dev.hexly.ai/api/settings",
			{ headers: { host: "signoff.dev.hexly.ai" } },
		);
		expect(res.status).toBe(200);
	});

	test("skips on machine host", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{ headers: { host: "signoff-ingest.example.com" } },
		);
		expect(res.status).toBe(200);
	});

	test("skips /api/live on browser host", async () => {
		const res = await app().request("http://signoff.example.com/api/live", {
			headers: { host: "signoff.example.com" },
		});
		expect(res.status).toBe(200);
	});

	test("fail-closed when Access env missing on browser", async () => {
		const res = await app({}).request(
			"http://signoff.example.com/api/settings",
			{ headers: { host: "signoff.example.com" } },
		);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/not configured/i);
	});

	test("missing JWT → 401 when Access configured", async () => {
		const res = await app(accessEnv).request(
			"http://signoff.example.com/api/settings",
			{ headers: { host: "signoff.example.com" } },
		);
		expect(res.status).toBe(401);
	});

	test("injected verifier success sets principal", async () => {
		setAccessJwtVerifierForTests(async () => ({
			email: "ada@example.com",
			name: "Ada",
		}));
		const res = await app(accessEnv).request(
			"http://signoff.example.com/api/settings",
			{
				headers: {
					host: "signoff.example.com",
					"cf-access-jwt-assertion": "any.jwt.value",
				},
			},
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			auth: true,
			email: "ada@example.com",
			name: "Ada",
		});
	});

	test("injected verifier throw → 403", async () => {
		setAccessJwtVerifierForTests(async () => {
			throw new Error("bad");
		});
		const res = await app(accessEnv).request(
			"http://signoff.example.com/api/settings",
			{
				headers: {
					host: "signoff.example.com",
					"cf-access-jwt-assertion": "bad.token",
				},
			},
		);
		expect(res.status).toBe(403);
	});
});
