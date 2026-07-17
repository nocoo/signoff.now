import { describe, expect, test } from "bun:test";
import { principalFromPayload } from "./access-principal.js";

describe("principalFromPayload", () => {
	test("prefers email then sub", () => {
		expect(principalFromPayload({ email: "a@b.com", name: "A" })).toEqual({
			email: "a@b.com",
			name: "A",
		});
		expect(principalFromPayload({ sub: "u@x.com" })).toEqual({
			email: "u@x.com",
			name: "u",
		});
		expect(principalFromPayload({})).toEqual({ email: null, name: null });
	});
});
