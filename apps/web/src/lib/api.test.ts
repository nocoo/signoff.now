import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, apiFetch } from "./api";

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
});
