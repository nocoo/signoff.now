/**
 * Settings store — Zustand store for user preferences.
 *
 * Manages:
 * - All user-configurable settings
 * - Loaded state (whether settings have been fetched from backend)
 * - Individual setting updates
 *
 * The store acts as the single source of truth for settings on the renderer side.
 * Settings are loaded from the tRPC settings router on app startup and
 * written back via tRPC mutations when changed.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface SettingsState {
	/** Whether settings have been loaded from the backend. */
	isLoaded: boolean;

	// ── Appearance ──────────────────────────────────────
	terminalFontFamily: string | null;
	terminalFontSize: number | null;
	editorFontFamily: string | null;
	editorFontSize: number | null;

	// ── Terminal ────────────────────────────────────────
	terminalLinkBehavior: string;
	terminalPersistence: boolean;
	autoApplyDefaultPreset: boolean;
	showPresetsBar: boolean;
	useCompactTerminalAddButton: boolean;

	// ── Git ─────────────────────────────────────────────
	branchPrefixMode: string;
	branchPrefixCustom: string | null;
	deleteLocalBranch: boolean;
	worktreeBaseDir: string | null;

	// ── Behavior ────────────────────────────────────────
	confirmOnQuit: boolean;
	fileOpenMode: string;
	openLinksInApp: boolean;
	defaultEditor: string | null;

	// ── Actions ─────────────────────────────────────────
	/** Bulk-set settings from server response. */
	setSettings: (settings: Partial<Omit<SettingsState, "isLoaded">>) => void;
	/** Update a single setting. */
	updateSetting: <K extends SettingKey>(
		key: K,
		value: SettingsState[K],
	) => void;
	/** Reset to initial state. */
	reset: () => void;
}

/** Keys that represent actual settings (not actions or metadata). */
type SettingKey = Exclude<
	keyof SettingsState,
	"isLoaded" | "setSettings" | "updateSetting" | "reset"
>;

const initialState = {
	isLoaded: false,

	// Appearance
	terminalFontFamily: null as string | null,
	terminalFontSize: null as number | null,
	editorFontFamily: null as string | null,
	editorFontSize: null as number | null,

	// Terminal
	terminalLinkBehavior: "external-editor",
	terminalPersistence: true,
	autoApplyDefaultPreset: false,
	showPresetsBar: true,
	useCompactTerminalAddButton: false,

	// Git
	branchPrefixMode: "none",
	branchPrefixCustom: null as string | null,
	deleteLocalBranch: false,
	worktreeBaseDir: null as string | null,

	// Behavior
	confirmOnQuit: false,
	fileOpenMode: "split-pane",
	openLinksInApp: false,
	defaultEditor: null as string | null,
};

export const useSettingsStore = create<SettingsState>()(
	devtools(
		(set) => ({
			...initialState,

			setSettings(settings) {
				set({ ...settings, isLoaded: true });
			},

			updateSetting(key, value) {
				set({ [key]: value });
			},

			reset() {
				set({
					...initialState,
					// Reset reference types
					terminalFontFamily: null,
					terminalFontSize: null,
					editorFontFamily: null,
					editorFontSize: null,
					branchPrefixCustom: null,
					worktreeBaseDir: null,
					defaultEditor: null,
				});
			},
		}),
		{ name: "settings-store" },
	),
);
