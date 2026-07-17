import { describe, expect, test } from "bun:test";
import { asObjectBody, readJsonBody } from "./http-body.js";

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
		expect(r).toEqual({ ok: false, error: "invalid_json" });
	});
});

describe("asObjectBody", () => {
	test("guards", () => {
		expect(asObjectBody(undefined)).toBeNull();
		expect(asObjectBody({ x: true })).toEqual({ x: true });
	});
});
