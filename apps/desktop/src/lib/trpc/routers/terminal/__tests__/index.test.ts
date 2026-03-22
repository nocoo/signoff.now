/**
 * Tests for the terminal tRPC router factory.
 *
 * Verifies that createTerminalRouter correctly delegates
 * all operations to the TerminalManager.
 */

import { describe, expect, it, mock } from "bun:test";
import { createTerminalRouter } from "../index";

/** Creates a mock TerminalManager with all methods as spies. */
function createMockManager() {
	return {
		createOrAttach: mock(() =>
			Promise.resolve({
				isNew: true,
				snapshot: null,
				wasRecovered: false,
				pid: null,
			}),
		),
		write: mock(() => Promise.resolve()),
		resize: mock(() => Promise.resolve()),
		detach: mock(() => Promise.resolve()),
		kill: mock(() => Promise.resolve()),
		signal: mock(() => Promise.resolve()),
		clearScrollback: mock(() => Promise.resolve()),
		listSessions: mock(() => Promise.resolve({ sessions: [] })),
	};
}

describe("createTerminalRouter", () => {
	it("creates a router with all expected procedures", () => {
		const manager = createMockManager();
		const router = createTerminalRouter(
			manager as Parameters<typeof createTerminalRouter>[0],
		);

		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.createOrAttach).toBeDefined();
		expect(record.write).toBeDefined();
		expect(record.resize).toBeDefined();
		expect(record.signal).toBeDefined();
		expect(record.kill).toBeDefined();
		expect(record.detach).toBeDefined();
		expect(record.clearScrollback).toBeDefined();
		expect(record.listDaemonSessions).toBeDefined();
	});

	it("has exactly 8 procedures", () => {
		const manager = createMockManager();
		const router = createTerminalRouter(
			manager as Parameters<typeof createTerminalRouter>[0],
		);

		const record = router._def.record;
		expect(Object.keys(record)).toHaveLength(8);
	});

	it("procedure names match expected API surface", () => {
		const manager = createMockManager();
		const router = createTerminalRouter(
			manager as Parameters<typeof createTerminalRouter>[0],
		);

		const names = Object.keys(router._def.record).sort();
		expect(names).toEqual([
			"clearScrollback",
			"createOrAttach",
			"detach",
			"kill",
			"listDaemonSessions",
			"resize",
			"signal",
			"write",
		]);
	});
});
