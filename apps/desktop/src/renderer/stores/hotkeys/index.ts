/**
 * Hotkeys store — Zustand store for keyboard shortcuts.
 *
 * Manages:
 * - Default and custom hotkey bindings
 * - Binding lookup by action or category
 * - Individual and bulk binding updates
 *
 * The store acts as the single source of truth for keyboard shortcuts.
 * Bindings can be customized per-user and persisted via the hotkeys tRPC router.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { HotkeyAction, HotkeyBinding } from "./types";

export type { HotkeyAction, HotkeyBinding, HotkeyCategory } from "./types";

/** Platform-aware modifier key. */
const MOD = globalThis.navigator?.platform?.startsWith("Mac") ? "Cmd" : "Ctrl";

/** Default hotkey bindings shipped with the app. */
export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
	// General
	{
		action: "quickOpen",
		keys: `${MOD}+P`,
		label: "Quick Open",
		category: "general",
	},
	{
		action: "openSettings",
		keys: `${MOD}+,`,
		label: "Open Settings",
		category: "general",
	},
	{
		action: "toggleSidebar",
		keys: `${MOD}+B`,
		label: "Toggle Sidebar",
		category: "general",
	},
	{
		action: "toggleContentSidebar",
		keys: `${MOD}+Shift+B`,
		label: "Toggle Content Sidebar",
		category: "general",
	},
	{
		action: "toggleWorkspaceSidebar",
		keys: `${MOD}+Shift+E`,
		label: "Toggle Workspace Sidebar",
		category: "general",
	},
	{
		action: "newWorkspace",
		keys: `${MOD}+N`,
		label: "New Workspace",
		category: "general",
	},

	// Terminal
	{
		action: "newTerminal",
		keys: `${MOD}+T`,
		label: "New Terminal",
		category: "terminal",
	},
	{
		action: "focusTerminal",
		keys: `${MOD}+\``,
		label: "Focus Terminal",
		category: "terminal",
	},

	// Tabs
	{
		action: "closeTab",
		keys: `${MOD}+W`,
		label: "Close Tab",
		category: "tabs",
	},
	{
		action: "nextTab",
		keys: `${MOD}+Shift+]`,
		label: "Next Tab",
		category: "tabs",
	},
	{
		action: "prevTab",
		keys: `${MOD}+Shift+[`,
		label: "Previous Tab",
		category: "tabs",
	},

	// Editor
	{
		action: "splitPane",
		keys: `${MOD}+\\`,
		label: "Split Pane",
		category: "editor",
	},
	{
		action: "closePane",
		keys: `${MOD}+Shift+W`,
		label: "Close Pane",
		category: "editor",
	},

	// Git
	{
		action: "stageAll",
		keys: `${MOD}+Shift+A`,
		label: "Stage All Changes",
		category: "git",
	},
	{
		action: "commitChanges",
		keys: `${MOD}+Enter`,
		label: "Commit Changes",
		category: "git",
	},
];

interface HotkeysState {
	/** Current hotkey bindings. */
	bindings: HotkeyBinding[];

	/** Get binding for a specific action. */
	getBinding: (action: HotkeyAction) => HotkeyBinding | undefined;
	/** Get all bindings in a category. */
	getBindingsByCategory: (category: string) => HotkeyBinding[];
	/** Update the key combination for an action. */
	updateBinding: (action: HotkeyAction, keys: string) => void;
	/** Reset a single binding to its default. */
	resetBinding: (action: HotkeyAction) => void;
	/** Bulk-set bindings (e.g., from server). */
	setBindings: (bindings: HotkeyBinding[]) => void;
	/** Reset all bindings to defaults. */
	reset: () => void;
}

export const useHotkeysStore = create<HotkeysState>()(
	devtools(
		(set, get) => ({
			bindings: [...DEFAULT_HOTKEYS],

			getBinding(action) {
				return get().bindings.find((b) => b.action === action);
			},

			getBindingsByCategory(category) {
				return get().bindings.filter((b) => b.category === category);
			},

			updateBinding(action, keys) {
				set((state) => ({
					bindings: state.bindings.map((b) =>
						b.action === action ? { ...b, keys } : b,
					),
				}));
			},

			resetBinding(action) {
				const defaultBinding = DEFAULT_HOTKEYS.find((b) => b.action === action);
				if (!defaultBinding) return;

				set((state) => ({
					bindings: state.bindings.map((b) =>
						b.action === action ? { ...b, keys: defaultBinding.keys } : b,
					),
				}));
			},

			setBindings(bindings) {
				set({ bindings });
			},

			reset() {
				set({ bindings: [...DEFAULT_HOTKEYS] });
			},
		}),
		{ name: "hotkeys-store" },
	),
);
