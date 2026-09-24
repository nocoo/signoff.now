import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import app from "./index";
import { setAccessJwtVerifierForTests } from "./middleware/access-auth";
import type { Caller } from "./middleware/principal";
import { decide, type RoutePolicy, routePolicies } from "./route-policy";
import { createSqliteD1, type SqliteD1 } from "./test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	setAccessJwtVerifierForTests(async (jwt) =>
		jwt.startsWith("service:")
			? { email: null, name: jwt.slice(8), service: true }
			: { email: jwt, name: jwt.split("@")[0] ?? null, service: false },
	);
});
afterEach(() => {
	setAccessJwtVerifierForTests(null);
	sqlite.close();
});

const REMOTE = {
	CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
	CF_ACCESS_AUD: "aud",
	SIGNOFF_ADMIN_EMAILS: "Owner@Example.com",
};
const send = (
	path: string,
	init: {
		method?: string;
		jwt?: string;
		headers?: Record<string, string>;
	} = {},
	host = "signoff.hexly.ai",
) =>
	app.request(
		`https://${host}${path}`,
		{
			method: init.method ?? "GET",
			headers: {
				host,
				...(init.jwt ? { "cf-access-jwt-assertion": init.jwt } : {}),
				...init.headers,
			},
		},
		{ DB: sqlite.db, ...REMOTE },
	);
const member = (principal: string, tenant = "default") =>
	sqlite.raw
		.query(
			"INSERT INTO tenant_members(tenant_id,principal,added_by,added_at) VALUES(?,?,'test',1)",
		)
		.run(tenant, principal);

test("every registered API route has exactly one policy", () => {
	const registered = new Set(
		app.routes
			.filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
			.map((r) => `${r.method} ${r.path}`),
	);
	expect([...registered].filter((r) => !(r in routePolicies))).toEqual([]);
	expect(Object.keys(routePolicies).filter((r) => !registered.has(r))).toEqual(
		[],
	);
});

describe("decision matrix", () => {
	const person = (
		admin: boolean,
		tenantId: string | null,
		tenants = tenantId ? [{ id: tenantId, name: "T" }] : [],
	): Caller => ({
		kind: "person",
		principal: "email:a@x.io",
		admin,
		tenants,
		tenantId,
	});
	const callers: Record<string, Caller> = {
		local: { kind: "local" },
		admin: person(true, "default"),
		member: person(false, "default"),
		unassigned: person(false, null),
		machine: { kind: "machine" },
		anonymous: { kind: "anonymous" },
	};
	const expected: Record<RoutePolicy, Record<string, number | "allow">> = {
		public: {
			local: "allow",
			admin: "allow",
			member: "allow",
			unassigned: "allow",
			machine: "allow",
			anonymous: "allow",
		},
		pipeline: {
			local: "allow",
			admin: "allow",
			member: "allow",
			unassigned: "allow",
			machine: "allow",
			anonymous: "allow",
		},
		member: {
			local: "allow",
			admin: "allow",
			member: "allow",
			unassigned: 403,
			machine: 403,
			anonymous: 401,
		},
		admin: {
			local: "allow",
			admin: "allow",
			member: 403,
			unassigned: 403,
			machine: 403,
			anonymous: 401,
		},
		collector: {
			local: "allow",
			admin: 403,
			member: 403,
			unassigned: 403,
			machine: 403,
			anonymous: 401,
		},
	};
	for (const [policy, row] of Object.entries(expected))
		for (const [name, outcome] of Object.entries(row))
			test(`${policy} × ${name}`, () => {
				const decision = decide(policy as RoutePolicy, callers[name]!);
				expect<number | "allow">(
					decision === "allow" ? "allow" : decision.status,
				).toBe(outcome);
			});
	test("unknown routes are not found for everyone", () => {
		expect(decide(null, callers.local!)).toEqual({
			status: 404,
			error: "Not found",
		});
	});
	test("members with tenants but no selection are asked to choose", () => {
		expect(
			decide("member", person(false, null, [{ id: "t", name: "T" }])),
		).toEqual({ status: 403, error: "Choose an available tenant" });
	});
});

describe("remote requests", () => {
	test("anonymous API calls need Access; liveness stays public", async () => {
		expect((await send("/api/live")).status).toBe(200);
		expect((await send("/api/workbench")).status).toBe(401);
		expect((await send("/api/nope", { jwt: "a@x.io" })).status).toBe(404);
	});

	test("an Access user outside every tenant reads only their session", async () => {
		const me = await send("/api/me", { jwt: "Stranger@x.io" });
		expect(await me.json()).toMatchObject({
			principal: "email:stranger@x.io",
			admin: false,
			tenants: [],
			tenantId: null,
		});
		const denied = await send("/api/workbench", { jwt: "stranger@x.io" });
		expect(denied.status).toBe(403);
		expect(await denied.json()).toEqual({
			error: "Ask an administrator to add you to a tenant",
		});
	});

	test("members read tenant data but not admin, collector or Activity routes", async () => {
		member("email:maya@x.io");
		expect((await send("/api/workbench", { jwt: "maya@x.io" })).status).toBe(
			200,
		);
		for (const [method, path] of [
			["POST", "/api/projects"],
			["GET", "/api/ai/settings"],
			["GET", "/api/developers"],
			["POST", "/api/commands/v1/discover"],
			["PATCH", "/api/collection/settings"],
		] as const)
			expect((await send(path, { method, jwt: "maya@x.io" })).status).toBe(403);
		expect(
			(await send("/api/collector/claim", { method: "POST", jwt: "maya@x.io" }))
				.status,
		).toBe(403);
	});

	test("environment and database admins pass admin routes", async () => {
		expect(
			(await send("/api/ai/settings", { jwt: "owner@example.com" })).status,
		).toBe(200);
		sqlite.raw
			.query(
				"INSERT INTO admins(principal,created_by,created_at) VALUES('email:ops@x.io','test',1)",
			)
			.run();
		expect((await send("/api/ai/settings", { jwt: "ops@x.io" })).status).toBe(
			200,
		);
	});

	test("service tokens are members only when an admin adds them", async () => {
		expect(
			(await send("/api/workbench", { jwt: "service:ci.access" })).status,
		).toBe(403);
		member("service:ci.access");
		expect(
			(await send("/api/workbench", { jwt: "service:ci.access" })).status,
		).toBe(200);
	});

	test("tenant header must name an available tenant", async () => {
		member("email:maya@x.io");
		sqlite.raw
			.query(
				"INSERT INTO tenants(id,name,created_at,updated_at) VALUES('other','Other',1,1)",
			)
			.run();
		expect(
			(
				await send("/api/workbench", {
					jwt: "maya@x.io",
					headers: { "x-signoff-tenant": "other" },
				})
			).status,
		).toBe(403);
		expect(
			(
				await send("/api/workbench", {
					jwt: "maya@x.io",
					headers: { "x-signoff-tenant": "default" },
				})
			).status,
		).toBe(200);
	});

	test("browser writes reject foreign origins", async () => {
		const write = (origin: string) =>
			send("/api/pr-collections?source=live", {
				method: "POST",
				jwt: "owner@example.com",
				headers: { origin, "content-type": "application/json" },
			});
		expect((await write("https://evil.example")).status).toBe(403);
		expect((await write("null")).status).toBe(403);
		expect((await write("https://signoff.hexly.ai")).status).toBe(400);
	});

	test("the machine host keeps only pipeline and public routes", async () => {
		const machine = (path: string, method = "GET") =>
			send(path, { method }, "signoff-ingest.hexly.ai");
		expect((await machine("/api/live")).status).toBe(200);
		expect((await machine("/api/me")).status).toBe(200);
		expect((await machine("/api/pipeline/bootstrap")).status).toBe(401);
	});

	test("a JWT without identity is anonymous", async () => {
		setAccessJwtVerifierForTests(async () => ({
			email: null,
			name: null,
			service: false,
		}));
		expect((await send("/api/workbench", { jwt: "blank" })).status).toBe(401);
	});
});

test("policy middleware ignores non-API paths", async () => {
	const { authorize } = await import("./route-policy");
	const plain = new Hono().use("*", authorize).get("/", (c) => c.text("ok"));
	expect((await plain.request("http://x/")).status).toBe(200);
});
