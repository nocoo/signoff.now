import { describe, expect, test } from "bun:test";
import {
	connectorLoginSchema,
	isConnectorToken,
	isLoopbackCallback,
} from "./connector";

describe("connector tokens and callbacks", () => {
	test("tokens have the sfc_ prefix and 32 base64url bytes", () => {
		expect(isConnectorToken(`sfc_${"a".repeat(43)}`)).toBe(true);
		expect(isConnectorToken(`sfc_${"a".repeat(42)}`)).toBe(false);
		expect(isConnectorToken(`tok_${"a".repeat(43)}`)).toBe(false);
		expect(isConnectorToken(`sfc_${"a".repeat(42)}=`)).toBe(false);
	});

	test("callbacks must stay on loopback with an explicit port", () => {
		for (const ok of [
			"http://localhost:5123/callback",
			"http://127.0.0.1:5123/callback?x=1",
			"http://[::1]:5123/callback",
		])
			expect(isLoopbackCallback(ok)).toBe(true);
		for (const bad of [
			"https://localhost:5123/callback",
			"http://localhost/callback",
			"http://localhost:5123/other",
			"http://evil.example:5123/callback",
			"http://user:pw@localhost:5123/callback",
			"http://localhost.evil.example:5123/callback",
			"not a url",
		])
			expect(isLoopbackCallback(bad)).toBe(false);
	});

	test("login requests default names and reject unknown fields", () => {
		const parsed = connectorLoginSchema.parse({
			callback: "http://localhost:5123/callback",
			state: "a".repeat(32),
		});
		expect(parsed).toMatchObject({
			name: "Connector",
			platform: "",
			version: "",
		});
		expect(
			connectorLoginSchema.safeParse({
				callback: "http://localhost:5123/callback",
				state: "short",
			}).success,
		).toBe(false);
		expect(
			connectorLoginSchema.safeParse({
				callback: "http://localhost:5123/callback",
				state: "a".repeat(32),
				extra: 1,
			}).success,
		).toBe(false);
	});
});
