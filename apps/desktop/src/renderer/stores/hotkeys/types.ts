/**
 * Hotkey types — keyboard shortcut system type definitions.
 */

/** All supported hotkey action identifiers. */
export type HotkeyAction =
	| "newTerminal"
	| "closeTab"
	| "nextTab"
	| "prevTab"
	| "toggleSidebar"
	| "toggleContentSidebar"
	| "toggleWorkspaceSidebar"
	| "newWorkspace"
	| "quickOpen"
	| "openSettings"
	| "focusTerminal"
	| "splitPane"
	| "closePane"
	| "stageAll"
	| "commitChanges";

/** Category for organizing hotkeys in the settings UI. */
export type HotkeyCategory = "general" | "terminal" | "editor" | "tabs" | "git";

/** A single keyboard shortcut binding. */
export interface HotkeyBinding {
	/** The action this binding triggers. */
	action: HotkeyAction;
	/** Human-readable key combination (e.g., "Cmd+T", "Ctrl+Shift+P"). */
	keys: string;
	/** Display label for the settings UI. */
	label: string;
	/** Category for grouping in settings. */
	category: HotkeyCategory;
}
