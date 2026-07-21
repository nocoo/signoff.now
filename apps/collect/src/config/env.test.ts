import { describe, expect, test } from "bun:test";
import { isLoopbackBase, loadEnv, requireWriteToken } from "./env.ts";

describe("isLoopbackBase", () => {
	test("loopback hosts", () => {
		expect(isLoopbackBase("http://127.0.0.1:37042")).toBe(true);
		expect(isLoopbackBase("http://localhost:37042")).toBe(true);
		expect(isLoopbackBase("https://signoff.dev.hexly.ai")).toBe(true);
	});

	test("remote hosts", () => {
		expect(isLoopbackBase("https://signoff-ingest.example.com")).toBe(false);
	});

	test("invalid url", () => {
		expect(isLoopbackBase("not-a-url")).toBe(false);
	});
});

describe("loadEnv", () => {
	test("defaults to local worker", () => {
		const e = loadEnv({}, "/tmp/proj");
		expect(e.apiBase).toBe("http://127.0.0.1:37042");
		expect(e.isLoopback).toBe(true);
		expect(e.dataDir).toBe("/tmp/proj/.data");
		expect(e.writeToken).toBeNull();
	});

	test("reads token and custom base", () => {
		const e = loadEnv({
			SIGNOFF_API_BASE: "https://signoff-ingest.example.com/",
			SIGNOFF_PIPELINE_WRITE_TOKEN: " secret ",
			SIGNOFF_DATA_DIR: "/var/data",
		});
		expect(e.apiBase).toBe("https://signoff-ingest.example.com");
		expect(e.writeToken).toBe("secret");
		expect(e.dataDir).toBe("/var/data");
		expect(e.isLoopback).toBe(false);
	});

	test("strips write token on loopback even if env set", () => {
		const e = loadEnv({
			SIGNOFF_API_BASE: "http://127.0.0.1:37042",
			SIGNOFF_PIPELINE_WRITE_TOKEN: "prod-secret",
		});
		expect(e.isLoopback).toBe(true);
		expect(e.writeToken).toBeNull();
	});
});

describe("requireWriteToken", () => {
	test("skips on loopback", () => {
		expect(
			requireWriteToken({
				apiBase: "http://127.0.0.1:37042",
				writeToken: null,
				dataDir: ".data",
				isLoopback: true,
			}),
		).toBeNull();
	});

	test("requires token on remote", () => {
		expect(
			requireWriteToken({
				apiBase: "https://x.com",
				writeToken: null,
				dataDir: ".data",
				isLoopback: false,
			}),
		).toMatch(/SIGNOFF_PIPELINE_WRITE_TOKEN/);
		expect(
			requireWriteToken({
				apiBase: "https://x.com",
				writeToken: "t",
				dataDir: ".data",
				isLoopback: false,
			}),
		).toBeNull();
	});
});
