import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, apiFetch, SERVICE_UNAVAILABLE } from "./api";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("apiFetch", () => {
	test("returns json on ok", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
			),
		);
		const data = await apiFetch<{ ok: boolean }>("/api/live");
		expect(data.ok).toBe(true);
	});

	test("throws ApiError with message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "Version conflict" }), {
						status: 409,
					}),
			),
		);
		await expect(apiFetch("/api/settings")).rejects.toBeInstanceOf(ApiError);
		try {
			await apiFetch("/api/settings");
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
			expect((e as ApiError).status).toBe(409);
			expect((e as ApiError).message).toBe("Version conflict");
		}
	});

	test("non-json error body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("plain fail", { status: 500 })),
		);
		try {
			await apiFetch("/api/x");
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
			expect((e as ApiError).message).toBe(SERVICE_UNAVAILABLE);
		}
	});

	test("empty ok body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 200 })),
		);
		const data = await apiFetch<null>("/api/x");
		expect(data).toBeNull();
	});
});

test.each([
	new TypeError("Failed to fetch"),
	new DOMException("signal timed out", "TimeoutError"),
])("normalizes transport failures without exposing browser errors: %s", async (error) => {
	const signal =
		error.name === "TimeoutError" ? AbortSignal.abort(error) : undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw error;
		}),
	);
	await expect(apiFetch("/api/query/v1/prs", { signal })).rejects.toMatchObject(
		{ message: SERVICE_UNAVAILABLE, status: 0 },
	);
});

test("preserves caller cancellation and unrelated errors", async () => {
	const cancellation = new DOMException("Navigation canceled", "AbortError");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw cancellation;
		}),
	);
	await expect(
		apiFetch("/api/x", { signal: AbortSignal.abort(cancellation) }),
	).rejects.toBe(cancellation);
	const error = new Error("Unexpected client error");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw error;
		}),
	);
	await expect(apiFetch("/api/x")).rejects.toBe(error);
});

test.each([
	502, 503, 504,
])("normalizes empty proxy response %s", async (status) => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(null, { status })),
	);
	await expect(apiFetch("/api/x")).rejects.toMatchObject({
		message: SERVICE_UNAVAILABLE,
		status,
	});
});

test("preserves structured business errors and authentication failures", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: { message: "PR cache failed", code: "CACHE_FAILED" },
					}),
					{ status: 503 },
				),
		),
	);
	await expect(apiFetch("/api/x")).rejects.toMatchObject({
		message: "PR cache failed",
		body: { error: { code: "CACHE_FAILED" } },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Sign in required", { status: 401 })),
	);
	await expect(apiFetch("/api/x")).rejects.toMatchObject({
		message: "Sign in required",
		status: 401,
	});
});

test("bounds cache reads including response bodies, while allowing longer commands", async () => {
	const timeout = vi.spyOn(AbortSignal, "timeout");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			text: async () => {
				throw new TypeError("Connection lost reading body");
			},
		})),
	);
	await expect(apiFetch("/api/x")).rejects.toMatchObject({
		message: SERVICE_UNAVAILABLE,
	});
	expect(timeout).toHaveBeenLastCalledWith(15000);
	await expect(apiFetch("/api/x", { method: "POST" })).rejects.toMatchObject({
		message: SERVICE_UNAVAILABLE,
	});
	expect(timeout).toHaveBeenLastCalledWith(45000);
	timeout.mockRestore();
});
