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

describe("readJsonBodyWithSize", () => {
	test("parses and reports bytes", async () => {
		const text = JSON.stringify({ x: 1 });
		const r = await readJsonBodyWithSize({
			req: { text: async () => text },
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ x: 1 });
			expect(r.byteLength).toBe(new TextEncoder().encode(text).length);
		}
	});

	test("invalid json still reports size", async () => {
		const r = await readJsonBodyWithSize({
			req: { text: async () => "{" },
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.byteLength).toBe(1);
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
