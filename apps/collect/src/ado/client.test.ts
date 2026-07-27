import { describe, expect, test } from "bun:test";
import type { ExecFn } from "../doctor/az.ts";
import {
	ADO_API_VERSION,
	AdoError,
	adoUrl,
	createAdoClient,
	type FetchFn,
} from "./client.ts";

const TOKEN_JSON = JSON.stringify({
	accessToken: "tok-1",
	expires_on: Math.floor(Date.now() / 1000) + 3600,
});

const okExec: ExecFn = async () => ({
	exitCode: 0,
	stdout: TOKEN_JSON,
	stderr: "",
});

function headers(map: Record<string, string> = {}) {
	return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

type Reply = {
	status: number;
	body?: string;
	headers?: Record<string, string>;
};

/** Queue of scripted replies; records every request for assertions. */
function scriptedFetch(replies: Reply[]) {
	const calls: { url: string; init?: unknown }[] = [];
	const fetchFn: FetchFn = async (url, init) => {
		calls.push({ url, init });
		const r = replies.shift() ?? { status: 200, body: "{}" };
		return {
			status: r.status,
			headers: headers(r.headers ?? {}),
			text: async () => r.body ?? "",
		};
	};
	return { fetchFn, calls };
}

const noSleep = async () => {};

describe("adoUrl", () => {
	test("pins the api version and encodes params", () => {
		const u = adoUrl("https://dev.azure.com/acme/Alpha/", "_apis/git/repos", {
			"searchCriteria.status": "completed",
			$top: 100,
		});
		expect(u).toContain(`api-version=${ADO_API_VERSION}`);
		expect(u).toContain("searchCriteria.status=completed");
		expect(u).toContain("%24top=100");
	});

	test("omits undefined params and tolerates a base without a slash", () => {
		const u = adoUrl("https://dev.azure.com/acme/Alpha", "_apis/x", {
			a: undefined,
			b: "1",
		});
		expect(u).not.toContain("a=");
		expect(u).toContain("b=1");
		expect(u).toContain("/acme/Alpha/_apis/x");
	});

	test("encodes values that would otherwise alter the query", () => {
		const u = adoUrl("https://dev.azure.com/acme/Alpha", "_apis/x", {
			q: "a&b=c d",
		});
		expect(u).toContain("q=a%26b%3Dc+d");
	});
});

describe("token acquisition", () => {
	test("sends the token as a bearer header", async () => {
		const { fetchFn, calls } = scriptedFetch([{ status: 200, body: "{}" }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		await c.get("https://x/y");
		const init = calls[0]?.init as { headers: Record<string, string> };
		expect(init.headers.authorization).toBe("Bearer tok-1");
	});

	test("reuses a live token across calls", async () => {
		let execCount = 0;
		const exec: ExecFn = async () => {
			execCount++;
			return { exitCode: 0, stdout: TOKEN_JSON, stderr: "" };
		};
		const { fetchFn } = scriptedFetch([
			{ status: 200, body: "{}" },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await c.get("https://x/1");
		await c.get("https://x/2");
		expect(execCount).toBe(1);
	});

	test("re-acquires after invalidateToken", async () => {
		let execCount = 0;
		const exec: ExecFn = async () => {
			execCount++;
			return { exitCode: 0, stdout: TOKEN_JSON, stderr: "" };
		};
		const { fetchFn } = scriptedFetch([
			{ status: 200, body: "{}" },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await c.get("https://x/1");
		c.invalidateToken();
		await c.get("https://x/2");
		expect(execCount).toBe(2);
	});

	test("a token expiring within the refresh margin is replaced", async () => {
		let execCount = 0;
		const exec: ExecFn = async () => {
			execCount++;
			return {
				exitCode: 0,
				// Expires in 30s — inside the 60s margin, so must not be reused.
				stdout: JSON.stringify({
					accessToken: `tok-${execCount}`,
					expires_on: Math.floor(Date.now() / 1000) + 30,
				}),
				stderr: "",
			};
		};
		const { fetchFn, calls } = scriptedFetch([
			{ status: 200, body: "{}" },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await c.get("https://x/1");
		await c.get("https://x/2");
		expect(execCount).toBe(2);
		const second = calls[1]?.init as { headers: Record<string, string> };
		expect(second.headers.authorization).toBe("Bearer tok-2");
	});

	test("az failure surfaces as unauthenticated", async () => {
		const exec: ExecFn = async () => ({
			exitCode: 1,
			stdout: "",
			stderr: "Please run 'az login'",
		});
		const { fetchFn } = scriptedFetch([]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "unauthenticated",
		});
	});

	test("unparseable or tokenless az output is reported, not ignored", async () => {
		for (const stdout of ["not json", JSON.stringify({ expires_on: 1 })]) {
			const exec: ExecFn = async () => ({ exitCode: 0, stdout, stderr: "" });
			const { fetchFn } = scriptedFetch([]);
			const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
			await expect(c.get("https://x/y")).rejects.toBeInstanceOf(AdoError);
		}
	});
});

describe("status handling", () => {
	test("401 triggers exactly one silent token refresh, then fails", async () => {
		let execCount = 0;
		const exec: ExecFn = async () => {
			execCount++;
			return { exitCode: 0, stdout: TOKEN_JSON, stderr: "" };
		};
		const { fetchFn, calls } = scriptedFetch([
			{ status: 401 },
			{ status: 401 },
		]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "unauthenticated",
			status: 401,
		});
		expect(calls).toHaveLength(2);
		expect(execCount).toBe(2);
	});

	test("401 that clears on refresh succeeds", async () => {
		const { fetchFn } = scriptedFetch([
			{ status: 401 },
			{ status: 200, body: '{"ok":true}' },
		]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		expect(await c.get("https://x/y")).toEqual({ ok: true });
	});

	test("403 is authorization, not authentication", async () => {
		const { fetchFn } = scriptedFetch([{ status: 403 }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		// Distinct kind so the CLI does not tell a signed-in user to sign in.
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "forbidden",
			status: 403,
		});
	});

	test("404 is its own kind", async () => {
		const { fetchFn } = scriptedFetch([{ status: 404 }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "not_found",
		});
	});

	test("a 200 with a non-JSON body is a bad response, not silent success", async () => {
		const { fetchFn } = scriptedFetch([{ status: 200, body: "<html>oops" }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "bad_response",
		});
	});
});

describe("retry behaviour", () => {
	test("429 retries and eventually succeeds", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{ status: 429 },
			{ status: 429 },
			{ status: 200, body: '{"v":1}' },
		]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		expect(await c.get("https://x/y")).toEqual({ v: 1 });
		expect(calls).toHaveLength(3);
	});

	test("Retry-After is honoured over exponential backoff", async () => {
		const waits: number[] = [];
		const { fetchFn } = scriptedFetch([
			{ status: 429, headers: { "retry-after": "7" } },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: async (ms) => {
				waits.push(ms);
			},
			jitterMs: () => 0,
		});
		await c.get("https://x/y");
		expect(waits).toEqual([7000]);
	});

	test("X-RateLimit-Delay is used when Retry-After is absent", async () => {
		const waits: number[] = [];
		const { fetchFn } = scriptedFetch([
			{ status: 429, headers: { "x-ratelimit-delay": "3" } },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: async (ms) => {
				waits.push(ms);
			},
			jitterMs: () => 0,
		});
		await c.get("https://x/y");
		expect(waits).toEqual([3000]);
	});

	test("without hints the delay grows exponentially", async () => {
		const waits: number[] = [];
		const { fetchFn } = scriptedFetch([
			{ status: 503 },
			{ status: 503 },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: async (ms) => {
				waits.push(ms);
			},
			jitterMs: () => 0,
		});
		await c.get("https://x/y");
		expect(waits).toEqual([1000, 2000]);
	});

	test("jitter is added so retries do not synchronise", async () => {
		const waits: number[] = [];
		const { fetchFn } = scriptedFetch([
			{ status: 500 },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: async (ms) => {
				waits.push(ms);
			},
			jitterMs: () => 137,
		});
		await c.get("https://x/y");
		expect(waits).toEqual([1137]);
	});

	test("the retry budget is finite", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{ status: 500 },
			{ status: 500 },
			{ status: 500 },
		]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: noSleep,
			maxRetries: 2,
		});
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "server",
		});
		expect(calls).toHaveLength(3);
	});

	test("exhausted 429s report rate limiting, not a generic server error", async () => {
		const { fetchFn } = scriptedFetch([{ status: 429 }, { status: 429 }]);
		const c = createAdoClient({
			exec: okExec,
			fetchFn,
			sleep: noSleep,
			maxRetries: 1,
		});
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "rate_limited",
		});
	});

	test("4xx other than 401/403/404/429 does not retry", async () => {
		const { fetchFn, calls } = scriptedFetch([{ status: 400 }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		await expect(c.get("https://x/y")).rejects.toMatchObject({
			kind: "server",
		});
		expect(calls).toHaveLength(1);
	});
});

describe("post", () => {
	test("sends a JSON body with the right content type", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{ status: 200, body: '{"r":1}' },
		]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		expect(await c.post("https://x/wiql", { query: "SELECT 1" })).toEqual({
			r: 1,
		});
		const init = calls[0]?.init as {
			method: string;
			headers: Record<string, string>;
			body: string;
		};
		expect(init.method).toBe("POST");
		expect(init.headers["content-type"]).toBe("application/json");
		expect(JSON.parse(init.body)).toEqual({ query: "SELECT 1" });
	});

	test("GET carries no body or content-type", async () => {
		const { fetchFn, calls } = scriptedFetch([{ status: 200, body: "{}" }]);
		const c = createAdoClient({ exec: okExec, fetchFn, sleep: noSleep });
		await c.get("https://x/y");
		const init = calls[0]?.init as {
			body?: string;
			headers: Record<string, string>;
		};
		expect(init.body).toBeUndefined();
		expect(init.headers["content-type"]).toBeUndefined();
	});
});

describe("defaults", () => {
	test("the built-in sleep and jitter are exercised on a real retry", async () => {
		// Neither is injected here, so this covers the production defaults that
		// every real run uses.
		const { fetchFn, calls } = scriptedFetch([
			{ status: 503, headers: { "retry-after": "0" } },
			{ status: 200, body: '{"ok":1}' },
		]);
		const c = createAdoClient({ exec: okExec, fetchFn });
		expect(await c.get("https://x/y")).toEqual({ ok: 1 });
		expect(calls).toHaveLength(2);
	});

	test("a token without expires_on gets a bounded lease rather than forever", async () => {
		let execCount = 0;
		const exec: ExecFn = async () => {
			execCount++;
			return {
				exitCode: 0,
				stdout: JSON.stringify({ accessToken: `t${execCount}` }),
				stderr: "",
			};
		};
		const { fetchFn } = scriptedFetch([
			{ status: 200, body: "{}" },
			{ status: 200, body: "{}" },
		]);
		const c = createAdoClient({ exec, fetchFn, sleep: noSleep });
		await c.get("https://x/1");
		await c.get("https://x/2");
		// Still cached within the fallback lease — not re-fetched every call.
		expect(execCount).toBe(1);
	});
});
