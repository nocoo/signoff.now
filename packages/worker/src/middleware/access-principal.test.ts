import { describe, expect, test } from "bun:test";
import { principalFromPayload } from "./access-principal.js";

describe("principalFromPayload", () => {
	test("prefers email then sub", () => {
		expect(principalFromPayload({ email: "a@b.com", name: "A" })).toEqual({
			email: "a@b.com",
			name: "A",
			service: false,
		});
		expect(principalFromPayload({ sub: "u@x.com" })).toEqual({
			email: "u@x.com",
			name: "u",
			service: false,
		});
		expect(principalFromPayload({})).toEqual({
			email: null,
			name: null,
			service: false,
		});
	});
});

describe("service token principals", () => {
	test("a service token is identified by common_name", () => {
		// Cloudflare's service-token payload carries no `email` and an EMPTY
		// `sub`. Reading only those resolved it to `{email:"", name:""}` — it
		// authenticated, but every audit line said nothing about who acted.
		expect(
			principalFromPayload({
				sub: "",
				common_name: "e367826f93b8d71185e03fe518aff3b4.access",
			}),
		).toEqual({
			email: null,
			name: "e367826f93b8d71185e03fe518aff3b4.access",
			service: true,
		});
	});

	test("a person is never marked as a service", () => {
		expect(principalFromPayload({ email: "a@b.com" }).service).toBe(false);
	});
});
