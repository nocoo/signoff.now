import { describe, expect, test } from "bun:test";
import {
	createPipelineClient,
	type FetchLike,
	isPipelineClientError,
} from "./client.ts";

function mockFetch(
	status: number,
	body: unknown,
	assert?: (url: string, init?: RequestInit) => void,
): FetchLike {
	return async (url, init) => {
		assert?.(url, init);
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
}

describe("createPipelineClient", () => {
	test("bootstrap 200", async () => {
		const snap = {
			fetchedAt: "2026-01-01T00:00:00.000Z",
			settings: {
				timezone: "UTC",
				emailSuffixes: ["x.com"],
				activityWeights: {},
				pipelineConfigVersion: 1,
				scoresStale: false,
				scoresStaleReason: null,
			},
			developers: [],
			repos: [],
		};
		const client = createPipelineClient({
			apiBase: "http://127.0.0.1:37042",
			fetchImpl: mockFetch(200, snap, (url, init) => {
				expect(url).toBe("http://127.0.0.1:37042/api/pipeline/bootstrap");
				expect(init?.method).toBe("GET");
			}),
		});
		const r = await client.bootstrap();
		expect(r.settings.pipelineConfigVersion).toBe(1);
	});

	test("sends bearer token", async () => {
		const client = createPipelineClient({
			apiBase: "https://ingest.example.com",
			writeToken: "tok",
			fetchImpl: mockFetch(200, {}, (_url, init) => {
				const h = init?.headers as Record<string, string>;
				expect(h.authorization).toBe("Bearer tok");
			}),
		});
		await client.bootstrap();
	});

	test("401 / 403 / 409 / 413 / 501 throw with status", async () => {
		for (const status of [401, 403, 409, 413, 501]) {
			const client = createPipelineClient({
				apiBase: "http://x",
				fetchImpl: mockFetch(status, { error: "x" }),
			});
			try {
				await client.ingest({ a: 1 });
				expect.unreachable();
			} catch (e) {
				expect(isPipelineClientError(e)).toBe(true);
				if (isPipelineClientError(e)) {
					expect(e.status).toBe(status);
				}
			}
		}
	});

	test("recomputeComplete posts body", async () => {
		const client = createPipelineClient({
			apiBase: "http://x",
			fetchImpl: mockFetch(200, { ok: true }, (url, init) => {
				expect(url).toContain("/recompute/complete");
				expect(init?.method).toBe("POST");
				expect(JSON.parse(String(init?.body))).toEqual({
					pipelineConfigVersion: 1,
					ok: true,
				});
			}),
		});
		await client.recomputeComplete({ pipelineConfigVersion: 1, ok: true });
	});

	test("non-json error body still throws", async () => {
		const client = createPipelineClient({
			apiBase: "http://x",
			fetchImpl: async () => new Response("plain", { status: 500 }),
		});
		try {
			await client.bootstrap();
			expect.unreachable();
		} catch (e) {
			expect(isPipelineClientError(e)).toBe(true);
		}
	});

	test("empty 200 body", async () => {
		const client = createPipelineClient({
			apiBase: "http://x",
			fetchImpl: async () => new Response("", { status: 200 }),
		});
		const r = await client.bootstrap();
		expect(r).toBeNull();
	});

	test("200 non-json body returns text", async () => {
		const client = createPipelineClient({
			apiBase: "http://x",
			fetchImpl: async () => new Response("not-json", { status: 200 }),
		});
		const r = await client.ingest({});
		expect(r).toBe("not-json");
	});

	test("uses globalThis.fetch when fetchImpl omitted", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
			})) as unknown as typeof fetch;
		try {
			const client = createPipelineClient({ apiBase: "http://x" });
			const r = await client.recomputeComplete({ a: 1 });
			expect(r).toEqual({ ok: true });
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("isPipelineClientError", () => {
	test("guards", () => {
		expect(
			isPipelineClientError({ status: 400, body: null, message: "m" }),
		).toBe(true);
		expect(isPipelineClientError(new Error("x"))).toBe(false);
		expect(isPipelineClientError(null)).toBe(false);
	});
});
