/**
 * Tests for the hotkeys Zustand store.
 *
 * TDD: written before implementation.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_HOTKEYS, useHotkeysStore } from "./index";
import type { HotkeyAction, HotkeyBinding } from "./types";

describe("hotkeys store", () => {
	afterEach(() => {
		useHotkeysStore.getState().reset();
	});

	// ── Initial state ──────────────────────────────────

	it("has default hotkey bindings", () => {
		const state = useHotkeysStore.getState();
		expect(state.bindings.length).toBeGreaterThan(0);
	});

	it("includes essential hotkeys in defaults", () => {
		const state = useHotkeysStore.getState();
		const actions = state.bindings.map((b) => b.action);

		expect(actions).toContain("newTerminal");
		expect(actions).toContain("closeTab");
		expect(actions).toContain("toggleSidebar");
		expect(actions).toContain("quickOpen");
		expect(actions).toContain("openSettings");
	});

	// ── getBinding ─────────────────────────────────────

	it("gets binding for an action", () => {
		const binding = useHotkeysStore.getState().getBinding("newTerminal");

		expect(binding).toBeDefined();
		expect(binding?.action).toBe("newTerminal");
		expect(binding?.keys).toBeDefined();
	});

	it("returns undefined for unknown action", () => {
		const binding = useHotkeysStore
			.getState()
			.getBinding("nonExistentAction" as HotkeyAction);

		expect(binding).toBeUndefined();
	});

	// ── updateBinding ──────────────────────────────────

	it("updates key binding for an action", () => {
		useHotkeysStore.getState().updateBinding("newTerminal", "Ctrl+Shift+T");

		const binding = useHotkeysStore.getState().getBinding("newTerminal");
		expect(binding?.keys).toBe("Ctrl+Shift+T");
	});

	it("preserves other bindings when updating one", () => {
		const originalClose = useHotkeysStore.getState().getBinding("closeTab");
		useHotkeysStore.getState().updateBinding("newTerminal", "Ctrl+Shift+T");

		const closeAfter = useHotkeysStore.getState().getBinding("closeTab");
		expect(closeAfter?.keys).toBe(originalClose?.keys);
	});

	// ── resetBinding ───────────────────────────────────

	it("resets a single binding to default", () => {
		const defaultBinding = useHotkeysStore.getState().getBinding("newTerminal");
		const defaultKeys = defaultBinding?.keys;

		// Change it
		useHotkeysStore.getState().updateBinding("newTerminal", "Ctrl+Shift+T");
		expect(useHotkeysStore.getState().getBinding("newTerminal")?.keys).toBe(
			"Ctrl+Shift+T",
		);

		// Reset it
		useHotkeysStore.getState().resetBinding("newTerminal");
		expect(useHotkeysStore.getState().getBinding("newTerminal")?.keys).toBe(
			defaultKeys,
		);
	});

	// ── reset ──────────────────────────────────────────

	it("resets all bindings to defaults", () => {
		useHotkeysStore.getState().updateBinding("newTerminal", "Ctrl+Shift+T");
		useHotkeysStore.getState().updateBinding("closeTab", "Ctrl+Shift+W");

		useHotkeysStore.getState().reset();

		const state = useHotkeysStore.getState();
		expect(state.bindings).toEqual(DEFAULT_HOTKEYS);
	});

	// ── setBindings ────────────────────────────────────

	it("bulk-sets bindings from server", () => {
		const custom: HotkeyBinding[] = [
			{
				action: "newTerminal",
				keys: "Alt+T",
				label: "New Terminal",
				category: "terminal",
			},
		];

		useHotkeysStore.getState().setBindings(custom);

		const state = useHotkeysStore.getState();
		expect(state.bindings).toHaveLength(1);
		expect(state.bindings[0].keys).toBe("Alt+T");
	});

	// ── getBindingsByCategory ──────────────────────────

	it("filters bindings by category", () => {
		const terminalBindings = useHotkeysStore
			.getState()
			.getBindingsByCategory("terminal");

		expect(terminalBindings.length).toBeGreaterThan(0);
		for (const b of terminalBindings) {
			expect(b.category).toBe("terminal");
		}
	});

	it("returns empty array for unknown category", () => {
		const result = useHotkeysStore
			.getState()
			.getBindingsByCategory("nonExistent");

		expect(result).toEqual([]);
	});
});
