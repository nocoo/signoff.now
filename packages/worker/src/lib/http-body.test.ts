import { describe, expect, test } from "bun:test";
import {
	asObjectBody,
	readJsonBody,
	readJsonBodyWithSize,
} from "./http-body.js";

describe("readJsonBody", () => {
	test("ok path", async () => {
		const r = await readJsonBody({
			req: { json: async () => ({ a: 1 }) },
		});
		expect(r).toEqual({ ok: true, value: { a: 1 } });
	});

	test("invalid json", async () => {
		const r = await readJsonBody({
			req: {
				json: async () => {
					throw new Error("bad");
				},
			},
		});
		expect(r.ok).toBe(false);
	});
});

function mockReq(body: string, headers?: Record<string, string>) {
	const bytes = new TextEncoder().encode(body);
	return {
		req: {
			header: (name: string) => headers?.[name.toLowerCase()],
			raw: new Request("http://x", {
				method: "POST",
				body: bytes,
				headers: headers,
			}),
		},
	};
}

describe("readJsonBodyWithSize", () => {
	test("parses and reports bytes", async () => {
		const text = JSON.stringify({ x: 1 });
		const r = await readJsonBodyWithSize(mockReq(text), 1024);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ x: 1 });
			expect(r.byteLength).toBe(new TextEncoder().encode(text).length);
		}
	});

	test("invalid json still reports size", async () => {
		const r = await readJsonBodyWithSize(mockReq("{"), 1024);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBe("invalid_json");
			expect(r.byteLength).toBe(1);
		}
	});

	test("content-length over cap → payload_too_large without reading", async () => {
		const r = await readJsonBodyWithSize(
			mockReq("{}", { "content-length": "999999" }),
			100,
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBe("payload_too_large");
		}
	});

	test("streamed body over cap → payload_too_large", async () => {
		const big = "x".repeat(200);
		const r = await readJsonBodyWithSize(mockReq(big), 50);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBe("payload_too_large");
			expect(r.byteLength).toBeGreaterThan(50);
		}
	});
});

describe("asObjectBody", () => {
	test("guards", () => {
		expect(asObjectBody(null)).toBeNull();
		expect(asObjectBody([])).toBeNull();
		expect(asObjectBody("x")).toBeNull();
		expect(asObjectBody({ a: 1 })).toEqual({ a: 1 });
	});
});
