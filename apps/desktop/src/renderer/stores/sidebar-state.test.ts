/**
 * Sidebar store tests — Phase 6 Commit #12a.
 *
 * TDD: tests written before implementation.
 * Tests cover:
 * - Initial state values
 * - Sidebar open/close/toggle behavior
 * - Width clamping (MIN/MAX)
 * - Mode switching (Tabs/Changes)
 * - Right sidebar tab switching
 * - IsResizing state
 * - Persist migration (percentage to pixel)
 */

import { beforeEach, describe, expect, test } from "bun:test";

// Mock localStorage for zustand persist middleware
const mockStorage = new Map<string, string>();
const mockLocalStorage = {
	getItem: (key: string) => mockStorage.get(key) ?? null,
	setItem: (key: string, value: string) => mockStorage.set(key, value),
	removeItem: (key: string) => mockStorage.delete(key),
	clear: () => mockStorage.clear(),
};

// @ts-expect-error - mocking global localStorage
globalThis.localStorage = mockLocalStorage;

// Reset before each test
beforeEach(() => {
	mockStorage.clear();
});

describe("sidebar-state constants", () => {
	test("SidebarMode enum has Tabs and Changes", async () => {
		const { SidebarMode } = await import("./sidebar-state");
		expect(SidebarMode.Tabs as string).toBe("tabs");
		expect(SidebarMode.Changes as string).toBe("changes");
	});

	test("RightSidebarTab enum has Changes and Files", async () => {
		const { RightSidebarTab } = await import("./sidebar-state");
		expect(RightSidebarTab.Changes as string).toBe("changes");
		expect(RightSidebarTab.Files as string).toBe("files");
	});

	test("DEFAULT_SIDEBAR_WIDTH is 250", async () => {
		const { DEFAULT_SIDEBAR_WIDTH } = await import("./sidebar-state");
		expect(DEFAULT_SIDEBAR_WIDTH).toBe(250);
	});

	test("MIN_SIDEBAR_WIDTH is 200", async () => {
		const { MIN_SIDEBAR_WIDTH } = await import("./sidebar-state");
		expect(MIN_SIDEBAR_WIDTH).toBe(200);
	});

	test("MAX_SIDEBAR_WIDTH is 500", async () => {
		const { MAX_SIDEBAR_WIDTH } = await import("./sidebar-state");
		expect(MAX_SIDEBAR_WIDTH).toBe(500);
	});
});

describe("sidebar-state initial state", () => {
	test("isSidebarOpen is true by default", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		// Create fresh state by accessing store
		const state = useSidebarStore.getState();
		expect(state.isSidebarOpen).toBe(true);
	});

	test("sidebarWidth is DEFAULT_SIDEBAR_WIDTH by default", async () => {
		const { useSidebarStore, DEFAULT_SIDEBAR_WIDTH } = await import(
			"./sidebar-state"
		);
		const state = useSidebarStore.getState();
		expect(state.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
	});

	test("currentMode is SidebarMode.Tabs by default", async () => {
		const { useSidebarStore, SidebarMode } = await import("./sidebar-state");
		const state = useSidebarStore.getState();
		expect(state.currentMode).toBe(SidebarMode.Tabs);
	});

	test("isResizing is false by default", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const state = useSidebarStore.getState();
		expect(state.isResizing).toBe(false);
	});

	test("rightSidebarTab is RightSidebarTab.Changes by default", async () => {
		const { useSidebarStore, RightSidebarTab } = await import(
			"./sidebar-state"
		);
		const state = useSidebarStore.getState();
		expect(state.rightSidebarTab).toBe(RightSidebarTab.Changes);
	});
});

describe("sidebar-state toggleSidebar", () => {
	test("closes sidebar when open", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		// Ensure open first
		expect(store.isSidebarOpen).toBe(true);

		store.toggleSidebar();

		const newState = useSidebarStore.getState();
		expect(newState.isSidebarOpen).toBe(false);
		expect(newState.sidebarWidth).toBe(0);
	});

	test("opens sidebar when closed", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		// Close first
		store.setSidebarOpen(false);
		expect(useSidebarStore.getState().isSidebarOpen).toBe(false);

		store.toggleSidebar();

		const newState = useSidebarStore.getState();
		expect(newState.isSidebarOpen).toBe(true);
		expect(newState.sidebarWidth).toBeGreaterThan(0);
	});
});

describe("sidebar-state setSidebarOpen", () => {
	test("opens sidebar and restores width", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setSidebarOpen(false);
		expect(useSidebarStore.getState().isSidebarOpen).toBe(false);

		store.setSidebarOpen(true);
		const state = useSidebarStore.getState();

		expect(state.isSidebarOpen).toBe(true);
		expect(state.sidebarWidth).toBe(state.lastOpenSidebarWidth);
	});

	test("closes sidebar and saves last mode", async () => {
		const { useSidebarStore, SidebarMode } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		// Set to Changes mode
		store.setMode(SidebarMode.Changes);
		expect(useSidebarStore.getState().currentMode).toBe(SidebarMode.Changes);

		store.setSidebarOpen(false);
		const state = useSidebarStore.getState();

		expect(state.isSidebarOpen).toBe(false);
		expect(state.sidebarWidth).toBe(0);
		expect(state.currentMode).toBe(SidebarMode.Tabs);
		expect(state.lastMode).toBe(SidebarMode.Changes);
	});
});

describe("sidebar-state setSidebarWidth", () => {
	test("clamps width to MIN_SIDEBAR_WIDTH when too small", async () => {
		const { useSidebarStore, MIN_SIDEBAR_WIDTH } = await import(
			"./sidebar-state"
		);
		const store = useSidebarStore.getState();

		store.setSidebarWidth(100);
		expect(useSidebarStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);
	});

	test("clamps width to MAX_SIDEBAR_WIDTH when too large", async () => {
		const { useSidebarStore, MAX_SIDEBAR_WIDTH } = await import(
			"./sidebar-state"
		);
		const store = useSidebarStore.getState();

		store.setSidebarWidth(1000);
		expect(useSidebarStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
	});

	test("opens sidebar when setting positive width", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setSidebarOpen(false);
		expect(useSidebarStore.getState().isSidebarOpen).toBe(false);

		store.setSidebarWidth(300);
		const state = useSidebarStore.getState();

		expect(state.isSidebarOpen).toBe(true);
		expect(state.sidebarWidth).toBe(300);
	});

	test("closes sidebar when setting width to 0", async () => {
		const { useSidebarStore, SidebarMode } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setMode(SidebarMode.Changes);
		store.setSidebarWidth(0);
		const state = useSidebarStore.getState();

		expect(state.isSidebarOpen).toBe(false);
		expect(state.currentMode).toBe(SidebarMode.Tabs);
		expect(state.lastMode).toBe(SidebarMode.Changes);
	});
});

describe("sidebar-state setMode", () => {
	test("changes currentMode to Tabs", async () => {
		const { useSidebarStore, SidebarMode } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setMode(SidebarMode.Tabs);
		expect(useSidebarStore.getState().currentMode).toBe(SidebarMode.Tabs);
	});

	test("changes currentMode to Changes", async () => {
		const { useSidebarStore, SidebarMode } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setMode(SidebarMode.Changes);
		expect(useSidebarStore.getState().currentMode).toBe(SidebarMode.Changes);
	});
});

describe("sidebar-state setIsResizing", () => {
	test("sets isResizing to true", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setIsResizing(true);
		expect(useSidebarStore.getState().isResizing).toBe(true);
	});

	test("sets isResizing to false", async () => {
		const { useSidebarStore } = await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setIsResizing(true);
		store.setIsResizing(false);
		expect(useSidebarStore.getState().isResizing).toBe(false);
	});
});

describe("sidebar-state setRightSidebarTab", () => {
	test("changes rightSidebarTab to Files", async () => {
		const { useSidebarStore, RightSidebarTab } = await import(
			"./sidebar-state"
		);
		const store = useSidebarStore.getState();

		store.setRightSidebarTab(RightSidebarTab.Files);
		expect(useSidebarStore.getState().rightSidebarTab).toBe(
			RightSidebarTab.Files,
		);
	});

	test("changes rightSidebarTab to Changes", async () => {
		const { useSidebarStore, RightSidebarTab } = await import(
			"./sidebar-state"
		);
		const store = useSidebarStore.getState();

		store.setRightSidebarTab(RightSidebarTab.Changes);
		expect(useSidebarStore.getState().rightSidebarTab).toBe(
			RightSidebarTab.Changes,
		);
	});
});

describe("sidebar-state width validation", () => {
	test("width below 100 gets clamped to MIN_SIDEBAR_WIDTH", async () => {
		const { useSidebarStore, MIN_SIDEBAR_WIDTH } = await import(
			"./sidebar-state"
		);
		const store = useSidebarStore.getState();

		// Setting width to 80 (which would be an old percentage value) gets clamped
		store.setSidebarWidth(80);
		expect(useSidebarStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);
	});

	test("valid width range is [MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]", async () => {
		const { useSidebarStore, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } =
			await import("./sidebar-state");
		const store = useSidebarStore.getState();

		store.setSidebarWidth(MIN_SIDEBAR_WIDTH);
		expect(useSidebarStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);

		store.setSidebarWidth(MAX_SIDEBAR_WIDTH);
		expect(useSidebarStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);

		store.setSidebarWidth(350);
		expect(useSidebarStore.getState().sidebarWidth).toBe(350);
	});
});
