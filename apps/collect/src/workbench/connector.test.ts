import { describe, expect, spyOn, test } from "bun:test";
import type { LoginDeps, LoginResult } from "@nocoo/base-cli";
import {
	type ConnectorDeps,
	connectorHeaders,
	connectorLogin,
	connectorLogout,
	connectorStatus,
	defaultConnectorDeps,
	describeConnector,
} from "./connector.ts";
import type { ConnectorConfig, ConnectorStore } from "./connector-config.ts";

const TOKEN = `sfc_${"t".repeat(43)}`;
const me = {
	connectorId: "c1",
	owner: "email:maya@x.io",
	name: "Laptop",
	expiresAt: 2_000_000_000,
	projects: [{ id: "p1", name: "Platform", organization: "acme" }],
};
function memoryStore(initial: ConnectorConfig | null = null): ConnectorStore {
	let value = initial;
	return {
		path: "/tmp/signoff/connector.json",
		read: () => value,
		write: (config) => {
			value = config;
		},
		clear: () => {
			value = null;
		},
	};
}
function deps(overrides: Partial<ConnectorDeps> = {}): ConnectorDeps & {
	logs: string[];
	logins: LoginDeps[];
	requests: { url: string; headers: Record<string, string> }[];
} {
	const logs: string[] = [];
	const logins: LoginDeps[] = [];
	const requests: { url: string; headers: Record<string, string> }[] = [];
	return {
		logs,
		logins,
		requests,
		store: memoryStore(),
		openBrowser: async () => {},
		now: () => 1_800_000_000,
		log: (m) => logs.push(m),
		login: async (input): Promise<LoginResult> => {
			logins.push(input);
			input.onSaveToken(TOKEN);
			return {
				success: true,
				params: {
					api_key: TOKEN,
					connector_id: "c1",
					owner: "email:maya@x.io",
					expires_at: "2000000000",
				},
			};
		},
		fetchImpl: async (url: string, init?: RequestInit) => {
			requests.push({
				url,
				headers: init?.headers as Record<string, string>,
			});
			return Response.json(me);
		},
		...overrides,
	};
}

describe("connector login", () => {
	test("signs in through the browser, stores the token and verifies it", async () => {
		const d = deps();
		const result = await connectorLogin({ name: "Laptop" }, d);
		expect(d.logins[0]).toMatchObject({
			apiUrl: "https://signoff.hexly.ai",
			loginPath: "/api/auth/cli",
			extraParams: { name: "Laptop" },
		});
		expect(d.logins[0]?.extraParams?.platform).toBe(
			`${process.platform}-${process.arch}`,
		);
		expect(result.config).toEqual({
			webOrigin: "https://signoff.hexly.ai",
			apiOrigin: "https://signoff-ingest.hexly.ai",
			token: TOKEN,
			connectorId: "c1",
			owner: "email:maya@x.io",
			expiresAt: 2_000_000_000,
		});
		expect(d.store.read()).toEqual(result.config);
		expect(result.me.projects).toHaveLength(1);
		expect(d.requests[0]).toMatchObject({
			url: "https://signoff-ingest.hexly.ai/api/connector/v1/me",
			headers: connectorHeaders(TOKEN),
		});
	});

	test("failed or empty sign-in keeps no credentials", async () => {
		const failed = deps({
			login: async () => ({ success: false, error: "Login timeout" }),
		});
		await expect(connectorLogin({}, failed)).rejects.toThrow("Login timeout");
		expect(failed.store.read()).toBeNull();
		const empty = deps({ login: async () => ({ success: true }) });
		await expect(connectorLogin({}, empty)).rejects.toThrow(
			"did not return a connector token",
		);
	});

	test("a token SignOff rejects is removed again", async () => {
		const d = deps({
			fetchImpl: async () => new Response("", { status: 401 }),
		});
		await expect(connectorLogin({}, d)).rejects.toThrow("sign in again");
		expect(d.store.read()).toBeNull();
	});

	test("defaults the connector name to the host name", async () => {
		const d = deps();
		await connectorLogin({ server: "https://signoff-ingest.hexly.ai" }, d);
		expect(d.logins[0]?.extraParams?.name).toBeTruthy();
		expect(d.logins[0]?.apiUrl).toBe("https://signoff.hexly.ai");
	});
});

describe("connector status", () => {
	const saved: ConnectorConfig = {
		webOrigin: "https://signoff.hexly.ai",
		apiOrigin: "https://signoff-ingest.hexly.ai",
		token: TOKEN,
		connectorId: "c1",
		owner: "email:maya@x.io",
		expiresAt: 2_000_000_000,
	};

	test("reports signed out, expired, revoked and ready states", async () => {
		expect((await connectorStatus(deps())).state).toBe("signed_out");
		expect(
			(
				await connectorStatus(
					deps({ store: memoryStore({ ...saved, expiresAt: 1 }) }),
				)
			).state,
		).toBe("expired");
		expect(
			(
				await connectorStatus(
					deps({
						store: memoryStore(saved),
						fetchImpl: async () => new Response("", { status: 401 }),
					}),
				)
			).state,
		).toBe("revoked");
		const ready = await connectorStatus(deps({ store: memoryStore(saved) }));
		expect(ready).toMatchObject({ state: "ready", me });
	});

	test("server errors are surfaced rather than treated as revocation", async () => {
		await expect(
			describeConnector(saved, async () => new Response("", { status: 503 })),
		).rejects.toThrow("503");
	});

	test("logout removes saved credentials", () => {
		const d = deps({ store: memoryStore(saved) });
		expect(connectorLogout(d)).toBe(true);
		expect(connectorLogout(d)).toBe(false);
	});
});

test("default dependencies use base-cli and the private config store", () => {
	const d = defaultConnectorDeps();
	expect(d.store.path).toMatch(/signoff\/connector\.json$/);
	expect(typeof d.login).toBe("function");
	expect(d.now()).toBeGreaterThan(1_700_000_000);
	const write = spyOn(process.stderr, "write").mockImplementation(() => true);
	d.log("hello");
	expect(write).toHaveBeenCalledWith("hello\n");
	write.mockRestore();
});
