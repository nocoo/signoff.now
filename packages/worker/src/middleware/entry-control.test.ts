import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import {
	entryControl,
	isLocalhost,
	isMachineEndpoint,
} from "./entry-control.js";

describe("isLocalhost", () => {
	test("matches localhost and loopback", () => {
		expect(isLocalhost("localhost")).toBe(true);
		expect(isLocalhost("localhost:8787")).toBe(true);
		expect(isLocalhost("127.0.0.1")).toBe(true);
		expect(isLocalhost("127.0.0.1:37042")).toBe(true);
		expect(isLocalhost("[::1]")).toBe(true);
		expect(isLocalhost("[::1]:8787")).toBe(true);
	});

	test("matches *.dev.hexly.ai", () => {
		expect(isLocalhost("signoff.dev.hexly.ai")).toBe(true);
	});

	test("rejects production hosts", () => {
		expect(isLocalhost("signoff.example.com")).toBe(false);
		expect(isLocalhost("signoff-ingest.example.com")).toBe(false);
	});
});

describe("isMachineEndpoint", () => {
	test("detects ingest host", () => {
		expect(isMachineEndpoint("signoff-ingest.example.com")).toBe(true);
		expect(isMachineEndpoint("signoff.example.com")).toBe(false);
	});
});

describe("entryControl middleware", () => {
	function app() {
		const a = new Hono<AppEnv>();
		a.use("*", entryControl);
		a.all("*", (c) => c.json({ ok: true }));
		return a;
	}

	test("allows all on localhost", async () => {
		const res = await app().request("http://localhost/api/settings", {
			headers: { host: "localhost:37042" },
		});
		expect(res.status).toBe(200);
	});

	test("machine whitelist allows bootstrap", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/pipeline/bootstrap",
			{ headers: { host: "signoff-ingest.example.com" } },
		);
		expect(res.status).toBe(200);
	});

	test("machine rejects management path", async () => {
		const res = await app().request(
			"http://signoff-ingest.example.com/api/settings",
			{
				method: "PUT",
				headers: { host: "signoff-ingest.example.com" },
			},
		);
		expect(res.status).toBe(403);
	});

	test("browser host passes through", async () => {
		const res = await app().request("http://signoff.example.com/api/live", {
			headers: { host: "signoff.example.com" },
		});
		expect(res.status).toBe(200);
	});
});

describe("isMachineEndpoint host spoofing", () => {
	test("a lookalike domain does not get the token path", () => {
		// A substring test accepted every one of these. Cloudflare's SNI routing
		// happens to reject a mismatched Host at the edge today, but an auth
		// boundary should not depend on someone else's routing.
		expect(isMachineEndpoint("evil-signoff-ingest.attacker.com")).toBe(false);
		expect(isMachineEndpoint("signoff-ingest-evil.attacker.com")).toBe(false);
		expect(isMachineEndpoint("attacker.com/signoff-ingest")).toBe(false);
		expect(isMachineEndpoint("x.signoff-ingest.hexly.ai")).toBe(false);
	});

	test("the real machine host still bypasses, port and case included", () => {
		expect(isMachineEndpoint("signoff-ingest.hexly.ai")).toBe(true);
		expect(isMachineEndpoint("SIGNOFF-INGEST.HEXLY.AI")).toBe(true);
		expect(isMachineEndpoint("signoff-ingest.hexly.ai:443")).toBe(true);
	});

	test("the human domain never does", () => {
		expect(isMachineEndpoint("signoff.hexly.ai")).toBe(false);
	});
});
