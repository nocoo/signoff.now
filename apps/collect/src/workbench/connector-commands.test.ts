import { expect, test } from "bun:test";
import { Command } from "commander";
import type { ConnectorDeps } from "./connector.ts";
import { registerConnectorCommands } from "./connector-commands.ts";
import type { ConnectorConfig, ConnectorStore } from "./connector-config.ts";

const TOKEN = `sfc_${"t".repeat(43)}`;
const saved: ConnectorConfig = {
	webOrigin: "https://signoff.hexly.ai",
	apiOrigin: "https://signoff-ingest.hexly.ai",
	token: TOKEN,
	connectorId: "c1",
	owner: "email:maya@x.io",
	expiresAt: 2_000_000_000,
};
const me = (projects: unknown[]) => ({
	connectorId: "c1",
	owner: "email:maya@x.io",
	name: "Laptop",
	expiresAt: 2_000_000_000,
	projects,
});

function harness(initial: ConnectorConfig | null, projects: unknown[] = []) {
	let stored = initial;
	const store: ConnectorStore = {
		path: "/tmp/connector.json",
		read: () => stored,
		write: (c) => {
			stored = c;
		},
		clear: () => {
			stored = null;
		},
	};
	const printed: unknown[] = [];
	const deps: ConnectorDeps = {
		store,
		openBrowser: async () => {},
		now: () => 1_800_000_000,
		log: () => {},
		login: async (input) => {
			input.onSaveToken(TOKEN);
			return {
				success: true,
				params: {
					connector_id: "c1",
					owner: "email:maya@x.io",
					expires_at: "2000000000",
				},
			};
		},
		fetchImpl: async () => Response.json(me(projects)),
	};
	const program = new Command().exitOverride();
	registerConnectorCommands(
		program,
		(value) => printed.push(value),
		() => deps,
	);
	const run = (...args: string[]) =>
		program.parseAsync(["node", "signoff", "connector", ...args]);
	return { run, printed, store };
}

test("login prints the next step for owners and non-owners", async () => {
	const none = harness(null);
	await none.run("login", "--name", "Laptop");
	expect(none.printed[0]).toMatchObject({
		connectorId: "c1",
		owner: "email:maya@x.io",
		server: "https://signoff.hexly.ai",
		expiresAt: "2033-05-18T03:33:20.000Z",
		next: expect.stringContaining("data owner"),
	});
	const owner = harness(null, [
		{ id: "p1", name: "Platform", organization: "acme" },
	]);
	await owner.run("login");
	expect(owner.printed[0]).toMatchObject({ next: "Run: signoff daemon" });
});

test("status succeeds when ready and fails with guidance otherwise", async () => {
	const ready = harness(saved);
	await ready.run("status");
	expect(ready.printed[0]).toMatchObject({ state: "ready", connectorId: "c1" });
	const out = harness(null);
	await expect(out.run("status")).rejects.toThrow("No connector is signed in");
	expect(out.printed[0]).toMatchObject({
		state: "signed_out",
		next: "Run: signoff connector login",
	});
	const expired = harness({ ...saved, expiresAt: 1 });
	await expect(expired.run("status")).rejects.toThrow(
		"Connector token is expired",
	);
});

test("logout forgets the saved token", async () => {
	const h = harness(saved);
	await h.run("logout");
	expect(h.printed[0]).toEqual({ removed: true });
	expect(h.store.read()).toBeNull();
});
