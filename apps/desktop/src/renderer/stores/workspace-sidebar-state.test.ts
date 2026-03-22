/**
 * Workspace sidebar store tests — Phase 6 Commit #12a.
 *
 * TDD: tests written before implementation.
 * Tests cover:
 * - Initial state values
 * - Toggle open/close
 * - Width management with snap-to-collapsed
 * - Project collapse/expand
 * - Collapsed state detection
 */

import { describe, expect, test } from "bun:test";

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

describe("workspace-sidebar-state constants", () => {
	test("DEFAULT_WORKSPACE_SIDEBAR_WIDTH is 280", async () => {
		const { DEFAULT_WORKSPACE_SIDEBAR_WIDTH } = await import(
			"./workspace-sidebar-state"
		);
		expect(DEFAULT_WORKSPACE_SIDEBAR_WIDTH).toBe(280);
	});

	test("COLLAPSED_WORKSPACE_SIDEBAR_WIDTH is 52", async () => {
		const { COLLAPSED_WORKSPACE_SIDEBAR_WIDTH } = await import(
			"./workspace-sidebar-state"
		);
		expect(COLLAPSED_WORKSPACE_SIDEBAR_WIDTH).toBe(52);
	});

	test("MAX_WORKSPACE_SIDEBAR_WIDTH is 400", async () => {
		const { MAX_WORKSPACE_SIDEBAR_WIDTH } = await import(
			"./workspace-sidebar-state"
		);
		expect(MAX_WORKSPACE_SIDEBAR_WIDTH).toBe(400);
	});
});

describe("workspace-sidebar-state initial state", () => {
	test("isOpen is true by default", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const state = useWorkspaceSidebarStore.getState();
		expect(state.isOpen).toBe(true);
	});

	test("width is DEFAULT_WORKSPACE_SIDEBAR_WIDTH by default", async () => {
		const { useWorkspaceSidebarStore, DEFAULT_WORKSPACE_SIDEBAR_WIDTH } =
			await import("./workspace-sidebar-state");
		const state = useWorkspaceSidebarStore.getState();
		expect(state.width).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH);
	});

	test("collapsedProjectIds is empty by default", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const state = useWorkspaceSidebarStore.getState();
		expect(state.collapsedProjectIds).toEqual([]);
	});

	test("isResizing is false by default", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const state = useWorkspaceSidebarStore.getState();
		expect(state.isResizing).toBe(false);
	});
});

describe("workspace-sidebar-state toggleOpen", () => {
	test("closes sidebar when open", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		store.toggleOpen();

		const state = useWorkspaceSidebarStore.getState();
		expect(state.isOpen).toBe(false);
		expect(state.width).toBe(0);
	});

	test("opens sidebar when closed and restores width", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		// Close first
		store.setOpen(false);
		expect(useWorkspaceSidebarStore.getState().isOpen).toBe(false);

		// Toggle open
		store.toggleOpen();

		const state = useWorkspaceSidebarStore.getState();
		expect(state.isOpen).toBe(true);
		expect(state.width).toBe(state.lastExpandedWidth);
	});
});

describe("workspace-sidebar-state setWidth", () => {
	test("snaps to collapsed when below threshold (120)", async () => {
		const { useWorkspaceSidebarStore, COLLAPSED_WORKSPACE_SIDEBAR_WIDTH } =
			await import("./workspace-sidebar-state");
		const store = useWorkspaceSidebarStore.getState();

		store.setWidth(100);

		const state = useWorkspaceSidebarStore.getState();
		expect(state.width).toBe(COLLAPSED_WORKSPACE_SIDEBAR_WIDTH);
		expect(state.isOpen).toBe(true);
	});

	test("clamps to MAX_WORKSPACE_SIDEBAR_WIDTH when too large", async () => {
		const { useWorkspaceSidebarStore, MAX_WORKSPACE_SIDEBAR_WIDTH } =
			await import("./workspace-sidebar-state");
		const store = useWorkspaceSidebarStore.getState();

		store.setWidth(800);

		expect(useWorkspaceSidebarStore.getState().width).toBe(
			MAX_WORKSPACE_SIDEBAR_WIDTH,
		);
	});

	test("updates lastExpandedWidth for valid widths", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		store.setWidth(350);

		const state = useWorkspaceSidebarStore.getState();
		expect(state.width).toBe(350);
		expect(state.lastExpandedWidth).toBe(350);
	});
});

describe("workspace-sidebar-state toggleProjectCollapsed", () => {
	test("collapses a project", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		store.toggleProjectCollapsed("project-1");

		expect(useWorkspaceSidebarStore.getState().collapsedProjectIds).toContain(
			"project-1",
		);
	});

	test("expands a collapsed project", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		// Collapse, then toggle again to expand
		store.toggleProjectCollapsed("project-2");
		expect(useWorkspaceSidebarStore.getState().collapsedProjectIds).toContain(
			"project-2",
		);

		store.toggleProjectCollapsed("project-2");
		expect(
			useWorkspaceSidebarStore.getState().collapsedProjectIds,
		).not.toContain("project-2");
	});

	test("isProjectCollapsed returns correct status", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		expect(store.isProjectCollapsed("project-3")).toBe(false);

		store.toggleProjectCollapsed("project-3");

		expect(
			useWorkspaceSidebarStore.getState().isProjectCollapsed("project-3"),
		).toBe(true);
	});
});

describe("workspace-sidebar-state toggleCollapsed", () => {
	test("collapses sidebar from expanded state", async () => {
		const { useWorkspaceSidebarStore, COLLAPSED_WORKSPACE_SIDEBAR_WIDTH } =
			await import("./workspace-sidebar-state");
		const store = useWorkspaceSidebarStore.getState();

		// Ensure expanded
		store.setWidth(300);

		store.toggleCollapsed();

		expect(useWorkspaceSidebarStore.getState().width).toBe(
			COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
		);
	});

	test("expands sidebar from collapsed state", async () => {
		const { useWorkspaceSidebarStore, COLLAPSED_WORKSPACE_SIDEBAR_WIDTH } =
			await import("./workspace-sidebar-state");
		const store = useWorkspaceSidebarStore.getState();

		// Force collapsed
		store.setWidth(50); // Below threshold, snaps to collapsed

		store.toggleCollapsed();

		const state = useWorkspaceSidebarStore.getState();
		expect(state.width).not.toBe(COLLAPSED_WORKSPACE_SIDEBAR_WIDTH);
		expect(state.width).toBe(state.lastExpandedWidth);
	});

	test("isCollapsed returns true when at collapsed width", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		store.setWidth(50); // Snaps to collapsed

		expect(useWorkspaceSidebarStore.getState().isCollapsed()).toBe(true);
	});

	test("isCollapsed returns false when expanded", async () => {
		const { useWorkspaceSidebarStore } = await import(
			"./workspace-sidebar-state"
		);
		const store = useWorkspaceSidebarStore.getState();

		store.setWidth(300);

		expect(useWorkspaceSidebarStore.getState().isCollapsed()).toBe(false);
	});
});
