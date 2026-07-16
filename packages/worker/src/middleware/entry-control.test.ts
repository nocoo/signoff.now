import { describe, expect, test } from "bun:test";
import { isLocalhost, isMachineEndpoint } from "./entry-control.js";

describe("isLocalhost", () => {
	test("matches localhost and loopback", () => {
		expect(isLocalhost("localhost")).toBe(true);
		expect(isLocalhost("localhost:8787")).toBe(true);
		expect(isLocalhost("127.0.0.1")).toBe(true);
		expect(isLocalhost("127.0.0.1:37042")).toBe(true);
		expect(isLocalhost("[::1]")).toBe(true);
	});

	test("matches *.dev.hexly.ai", () => {
		expect(isLocalhost("signoff.dev.hexly.ai")).toBe(true);
	});

	test("rejects production hosts", () => {
		expect(isLocalhost("signoff.example.com")).toBe(false);
		expect(isLocalhost("signoff-ingest.example.com")).toBe(false);
	});
});

describe("isMachineEndpoint", () => {
	test("detects ingest host", () => {
		expect(isMachineEndpoint("signoff-ingest.example.com")).toBe(true);
		expect(isMachineEndpoint("signoff.example.com")).toBe(false);
	});
});
