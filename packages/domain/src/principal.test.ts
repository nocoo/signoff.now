import { describe, expect, test } from "bun:test";
import {
	canUseWorkspace,
	emailPrincipal,
	memberPrincipal,
	parseAdminPrincipals,
	principalSchema,
	type Session,
	selectTenant,
	servicePrincipal,
} from "./principal";

describe("principals", () => {
	test("normalize email and service identities", () => {
		expect(emailPrincipal("  Maya@Example.COM ")).toBe(
			"email:maya@example.com",
		);
		expect(servicePrincipal(" abc.access ")).toBe("service:abc.access");
		expect(principalSchema.safeParse("email:a@b.co").success).toBe(true);
		expect(principalSchema.safeParse("name:a").success).toBe(false);
		expect(principalSchema.safeParse("email:a b").success).toBe(false);
	});

	test("member input accepts emails and explicit service tokens only", () => {
		expect(memberPrincipal("Maya@Example.com")).toBe("email:maya@example.com");
		expect(memberPrincipal("SERVICE: e367.access ")).toBe(
			"service:e367.access",
		);
		expect(memberPrincipal("service:")).toBeNull();
		expect(memberPrincipal("service:a b")).toBeNull();
		expect(memberPrincipal(`service:${"x".repeat(241)}`)).toBeNull();
		expect(memberPrincipal("maya")).toBeNull();
		expect(memberPrincipal("")).toBeNull();
	});

	test("admin environment ignores blanks and invalid entries", () => {
		expect([...parseAdminPrincipals(undefined)]).toEqual([]);
		expect([
			...parseAdminPrincipals(" A@x.io, ,nope,a@x.io,service:ci.access"),
		]).toEqual(["email:a@x.io", "service:ci.access"]);
	});
});

describe("tenant selection", () => {
	const tenants = [
		{ id: "team-b", name: "B" },
		{ id: "default", name: "Default" },
	];
	test("explicit requests must be available", () => {
		expect(selectTenant("team-b", tenants)).toBe("team-b");
		expect(selectTenant("missing", tenants)).toBeNull();
	});
	test("defaults prefer the default tenant, then the first", () => {
		expect(selectTenant(undefined, tenants)).toBe("default");
		expect(selectTenant(undefined, [tenants[0]!])).toBe("team-b");
		expect(selectTenant(undefined, [])).toBeNull();
	});
});

test("workspace access needs local trust or a selected tenant", () => {
	const base: Session = {
		authenticated: true,
		local: false,
		principal: "email:a@x.io",
		email: "a@x.io",
		name: "a",
		service: false,
		admin: false,
		tenants: [],
		tenantId: null,
	};
	expect(canUseWorkspace(base)).toBe(false);
	expect(canUseWorkspace({ ...base, tenantId: "default" })).toBe(true);
	expect(canUseWorkspace({ ...base, local: true })).toBe(true);
});
