import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import {
	isPipelinePath,
	isPipelineWritePath,
	pipelineAuth,
} from "./pipeline-auth.js";

describe("isPipelineWritePath", () => {
	test("matches ingest and recompute", () => {
		expect(isPipelineWritePath("/api/pipeline/ingest")).toBe(true);
		expect(isPipelineWritePath("/api/pipeline/recompute/complete")).toBe(true);
	});

	test("rejects management and bootstrap", () => {
		expect(isPipelineWritePath("/api/settings")).toBe(false);
		expect(isPipelineWritePath("/api/pipeline/bootstrap")).toBe(false);
	});
});

describe("isPipelinePath", () => {
	test("matches all pipeline routes", () => {
		expect(isPipelinePath("/api/pipeline/bootstrap")).toBe(true);
		expect(isPipelinePath("/api/pipeline/ingest")).toBe(true);
		expect(isPipelinePath("/api/settings")).toBe(false);
	});
});

describe("pipelineAuth middleware", () => {
	function app(opts?: { access?: boolean; write?: string; read?: string }) {
		const a = new Hono<AppEnv>();
		a.use("*", async (c, next) => {
			c.env = {
				DB: {} as D1Database,
				SIGNOFF_PIPELINE_WRITE_TOKEN: opts?.write ?? "write-secret",
				SIGNOFF_PIPELINE_READ_TOKEN: opts?.read ?? "read-secret",
			};
			if (opts?.access) {
				c.set("accessAuthenticated", true);
			}
			return next();
		});
		a.use("*", pipelineAuth);
		a.all("*", (c) => c.json({ ok: true }));
		return a;
	}

	test("public routes", async () => {
		const res = await app().request("http://x/api/live", {
			headers: { host: "signoff.example.com" },
		});
		expect(res.status).toBe(200);
	});

	test("localhost skips token", async () => {
		const res = await app().request("http://localhost/api/settings", {
			headers: { host: "127.0.0.1:37042" },
		});
		expect(res.status).toBe(200);
	});

	test("browser access skips token on management", async () => {
		const res = await app({ access: true }).request(
			"http://signoff.example.com/api/settings",
			{ headers: { host: "signoff.example.com" } },
		);
		expect(res.status).toBe(200);
	});

	test("browser Access + pipeline ingest → 403", async () => {
		const res = await app({ access: true }).request(
			"http://signoff.example.com/api/pipeline/ingest",
			{
				method: "POST",
				headers: { host: "signoff.example.com" },
			},
		);
		expect(res.status).toBe(403);
	});

	test("browser Access + pipeline bootstrap → 403", async () => {
		const res = await app({ access: true }).request(
			"http://signoff.example.com/api/pipeline/bootstrap",
			{ headers: { host: "signoff.example.com" } },
		);
		expect(res.status).toBe(403);
	});

	test("missing bearer → 401", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{ headers: { host: "signoff-ingest.example.com" } },
		);
		expect(res.status).toBe(401);
	});

	test("write token on ingest", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/ingest",
			{
				method: "POST",
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer write-secret",
				},
			},
		);
		expect(res.status).toBe(200);
	});

	test("read token rejected on write", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/ingest",
			{
				method: "POST",
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer read-secret",
				},
			},
		);
		expect(res.status).toBe(403);
	});

	test("read token on bootstrap get", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer read-secret",
				},
			},
		);
		expect(res.status).toBe(200);
	});

	test("invalid token on get", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer wrong",
				},
			},
		);
		expect(res.status).toBe(403);
	});

	test("malformed authorization header", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Basic abc",
				},
			},
		);
		expect(res.status).toBe(401);
	});

	test("invalid write token on ingest", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/ingest",
			{
				method: "POST",
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer wrong",
				},
			},
		);
		expect(res.status).toBe(403);
	});

	test("write token works on bootstrap get", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{
				headers: {
					host: "signoff-ingest.example.com",
					authorization: "Bearer write-secret",
				},
			},
		);
		expect(res.status).toBe(200);
	});
});
