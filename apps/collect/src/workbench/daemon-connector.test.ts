import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerWorkbenchCommands } from "./commands";
import { type ConnectorConfig, connectorStore } from "./connector-config";

const TOKEN = `sfc_${"t".repeat(43)}`;
const config: ConnectorConfig = {
	webOrigin: "https://signoff.hexly.ai",
	apiOrigin: "https://signoff-ingest.hexly.ai",
	token: TOKEN,
	connectorId: "c1-connector",
	owner: "email:maya@x.io",
	expiresAt: 4_000_000_000,
};
let dir: string;
let previous: string | undefined;
let calls: { url: URL; headers: Record<string, string>; body: unknown }[];
let restore: { mockRestore: () => void }[];
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "signoff-daemon-"));
	previous = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = dir;
	calls = [];
	restore = [
		spyOn(process.stdout, "write").mockImplementation(() => true),
		spyOn(process.stderr, "write").mockImplementation(() => true),
		spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: string | URL | Request, init?: RequestInit) => {
					const url = new URL(String(input));
					calls.push({
						url,
						headers: init?.headers as Record<string, string>,
						body: init?.body ? JSON.parse(String(init.body)) : null,
					});
					if (url.pathname === "/api/collector/avatars/claim")
						return Response.json([]);
					if (url.pathname === "/api/collector/claim") {
						process.emit("SIGTERM");
						return Response.json(null);
					}
					if (url.pathname.endsWith("schedule"))
						return Response.json({
							kind: "details",
							cooldownSeconds: 300,
							lastCompletedAt: null,
							roundId: null,
							requested: false,
							foregroundUntil: 0,
							totalJobs: 0,
							completedJobs: 0,
						});
					return Response.json({});
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		),
	];
});
afterEach(() => {
	for (const spy of restore) spy.mockRestore();
	if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = previous;
	rmSync(dir, { recursive: true, force: true });
});
async function daemon(...args: string[]) {
	const program = new Command().name("signoff").exitOverride();
	registerWorkbenchCommands(program);
	await program.parseAsync(["daemon", ...args], { from: "user" });
}

test("a signed-in connector sends its token to the machine host", async () => {
	connectorStore().write(config);
	await daemon();
	expect(calls.length).toBeGreaterThan(0);
	expect(
		calls.every((c) => c.url.origin === "https://signoff-ingest.hexly.ai"),
	).toBe(true);
	expect(
		calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}`),
	).toBe(true);
	const beat = calls.find((c) => c.url.pathname === "/api/collector/heartbeat");
	expect(beat?.body).toMatchObject({
		state: "ready",
		capabilities: { az: expect.any(Object), gh: expect.any(Object) },
		version: expect.any(String),
	});
});

test("--local ignores the connector and an expired sign-in stops the daemon", async () => {
	connectorStore().write(config);
	await daemon("--local");
	expect(calls.every((c) => c.url.hostname === "127.0.0.1")).toBe(true);
	calls.length = 0;
	connectorStore().write({ ...config, expiresAt: 1 });
	await expect(daemon()).rejects.toThrow("Connector sign-in expired");
	expect(calls).toEqual([]);
});
