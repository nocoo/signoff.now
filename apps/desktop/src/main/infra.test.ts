import { describe, expect, test } from "bun:test";

// ─── App State ───────────────────────────────────────────────────────────────

describe("main/lib/app-state", () => {
	test("initAppState returns a valid state object", async () => {
		const { initAppState } = await import("./lib/app-state");
		const state = initAppState();
		expect(state).toBeDefined();
		expect("lastActiveProjectId" in state).toBe(true);
		expect("onboardingCompleted" in state).toBe(true);
		expect("lastUpdateCheck" in state).toBe(true);
	});

	test("getAppState returns consistent state after init", async () => {
		const { getAppState, initAppState } = await import("./lib/app-state");
		initAppState();
		const state = getAppState();
		expect("onboardingCompleted" in state).toBe(true);
	});

	test("updateAppState patches and returns updated state", async () => {
		const { getAppState, initAppState, updateAppState } = await import(
			"./lib/app-state"
		);
		initAppState();
		const uniqueId = `proj-test-${Date.now()}`;
		const updated = updateAppState({ lastActiveProjectId: uniqueId });
		expect(updated.lastActiveProjectId).toBe(uniqueId);

		// Verify getAppState reflects the update
		const retrieved = getAppState();
		expect(retrieved.lastActiveProjectId).toBe(uniqueId);

		// Clean up: reset to null
		updateAppState({ lastActiveProjectId: null });
	});
});

// ─── Window State ────────────────────────────────────────────────────────────

describe("main/lib/window-state", () => {
	test("loadWindowState returns a valid state with dimensions", async () => {
		const { loadWindowState } = await import("./lib/window-state");
		const state = loadWindowState();
		expect(state).toBeDefined();
		expect(state.width).toBeGreaterThan(0);
		expect(state.height).toBeGreaterThan(0);
		expect(typeof state.isMaximized).toBe("boolean");
	});

	test("extractWindowState extracts bounds correctly", async () => {
		const { extractWindowState } = await import("./lib/window-state");
		const state = extractWindowState({
			x: 100,
			y: 200,
			width: 1024,
			height: 768,
			isMaximized: true,
		});
		expect(state.x).toBe(100);
		expect(state.y).toBe(200);
		expect(state.width).toBe(1024);
		expect(state.height).toBe(768);
		expect(state.isMaximized).toBe(true);
	});

	test("saveWindowState and loadWindowState roundtrip", async () => {
		const { saveWindowState, loadWindowState } = await import(
			"./lib/window-state"
		);
		const testState = {
			x: 42,
			y: 84,
			width: 999,
			height: 777,
			isMaximized: true,
		};

		saveWindowState(testState);
		const loaded = loadWindowState();
		expect(loaded.x).toBe(42);
		expect(loaded.y).toBe(84);
		expect(loaded.width).toBe(999);
		expect(loaded.height).toBe(777);
		expect(loaded.isMaximized).toBe(true);
	});
});

// ─── Local DB module exports ─────────────────────────────────────────────────

describe("main/lib/local-db", () => {
	test("module exports getDb, getSqlite, initLocalDb, closeLocalDb", async () => {
		// The module is mocked in test-setup.ts because better-sqlite3 is a native module.
		// We verify the mock shape matches the expected API.
		const mod = await import("./lib/local-db");
		expect(mod).toBeDefined();
		expect(typeof mod.getDb).toBe("function");
		expect(typeof mod.getSqlite).toBe("function");
		expect(typeof mod.initLocalDb).toBe("function");
		expect(typeof mod.closeLocalDb).toBe("function");
	});
});
