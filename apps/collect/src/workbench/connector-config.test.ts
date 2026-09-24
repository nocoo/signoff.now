import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ConnectorConfig,
	connectorOrigins,
	connectorStore,
} from "./connector-config.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
const config: ConnectorConfig = {
	webOrigin: "https://signoff.hexly.ai",
	apiOrigin: "https://signoff-ingest.hexly.ai",
	connectorId: "c1",
	token: `sfc_${"a".repeat(43)}`,
	owner: "email:maya@x.io",
	expiresAt: 1_900_000_000,
};

describe("connector origins", () => {
	test("derive the machine host from either production host", () => {
		const expected = {
			webOrigin: "https://signoff.hexly.ai",
			apiOrigin: "https://signoff-ingest.hexly.ai",
		};
		expect(connectorOrigins("https://signoff.hexly.ai")).toEqual(expected);
		expect(connectorOrigins("https://signoff-ingest.hexly.ai/")).toEqual(
			expected,
		);
	});

	test("loopback and short hosts use a single origin", () => {
		expect(connectorOrigins("http://127.0.0.1:37042")).toEqual({
			webOrigin: "http://127.0.0.1:37042",
			apiOrigin: "http://127.0.0.1:37042",
		});
		expect(connectorOrigins("https://example.com")).toEqual({
			webOrigin: "https://example.com",
			apiOrigin: "https://example.com",
		});
	});

	test("rejects insecure remote, credentialed or path origins", () => {
		for (const bad of [
			"http://signoff.hexly.ai",
			"https://u:p@signoff.hexly.ai",
			"https://signoff.hexly.ai/app",
			"https://signoff.hexly.ai/?x=1",
			"https://signoff.hexly.ai/#x",
		])
			expect(() => connectorOrigins(bad)).toThrow(TypeError);
	});
});

describe("connector store", () => {
	test("writes a private config and reads it back", () => {
		const dir = mkdtempSync(join(tmpdir(), "signoff-connector-"));
		dirs.push(dir);
		const store = connectorStore({ XDG_CONFIG_HOME: dir });
		expect(store.path).toBe(join(dir, "signoff", "connector.json"));
		expect(store.read()).toBeNull();
		store.write(config);
		expect(store.read()).toEqual(config);
		expect(statSync(store.path).mode & 0o777).toBe(0o600);
		store.clear();
		expect(store.read()).toBeNull();
	});

	test("ignores malformed config and rejects invalid writes", () => {
		const dir = mkdtempSync(join(tmpdir(), "signoff-connector-"));
		dirs.push(dir);
		const store = connectorStore({ XDG_CONFIG_HOME: dir });
		expect(() => store.write({ ...config, token: "nope" })).toThrow();
		expect(store.read()).toBeNull();
	});

	test("defaults to ~/.config when XDG_CONFIG_HOME is unset", () => {
		expect(connectorStore({}).path).toMatch(
			/\.config\/signoff\/connector\.json$/,
		);
	});
});
