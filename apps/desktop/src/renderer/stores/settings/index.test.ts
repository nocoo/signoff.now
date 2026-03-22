/**
 * Tests for the settings Zustand store.
 *
 * TDD: written before implementation.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { useSettingsStore } from "./index";

describe("settings store", () => {
	afterEach(() => {
		useSettingsStore.getState().reset();
	});

	// ── Initial state ──────────────────────────────────

	it("has correct initial state", () => {
		const state = useSettingsStore.getState();

		expect(state.isLoaded).toBe(false);
		expect(state.confirmOnQuit).toBe(false);
		expect(state.terminalPersistence).toBe(true);
		expect(state.terminalLinkBehavior).toBe("external-editor");
		expect(state.branchPrefixMode).toBe("none");
		expect(state.fileOpenMode).toBe("split-pane");
		expect(state.showPresetsBar).toBe(true);
	});

	// ── setSettings ────────────────────────────────────

	it("sets all settings from server response", () => {
		useSettingsStore.getState().setSettings({
			confirmOnQuit: true,
			terminalFontSize: 16,
			terminalFontFamily: "JetBrains Mono",
			fileOpenMode: "new-tab",
		});

		const state = useSettingsStore.getState();
		expect(state.isLoaded).toBe(true);
		expect(state.confirmOnQuit).toBe(true);
		expect(state.terminalFontSize).toBe(16);
		expect(state.terminalFontFamily).toBe("JetBrains Mono");
		expect(state.fileOpenMode).toBe("new-tab");
	});

	it("preserves defaults for unset fields", () => {
		useSettingsStore.getState().setSettings({
			confirmOnQuit: true,
		});

		const state = useSettingsStore.getState();
		expect(state.terminalPersistence).toBe(true);
		expect(state.showPresetsBar).toBe(true);
	});

	// ── updateSetting ──────────────────────────────────

	it("updates a single setting", () => {
		useSettingsStore.getState().updateSetting("confirmOnQuit", true);

		expect(useSettingsStore.getState().confirmOnQuit).toBe(true);
	});

	it("updates font settings", () => {
		useSettingsStore.getState().updateSetting("terminalFontSize", 18);
		useSettingsStore
			.getState()
			.updateSetting("terminalFontFamily", "Fira Code");

		const state = useSettingsStore.getState();
		expect(state.terminalFontSize).toBe(18);
		expect(state.terminalFontFamily).toBe("Fira Code");
	});

	it("clears a nullable setting", () => {
		useSettingsStore.getState().updateSetting("terminalFontFamily", "Menlo");
		useSettingsStore.getState().updateSetting("terminalFontFamily", null);

		expect(useSettingsStore.getState().terminalFontFamily).toBeNull();
	});

	// ── reset ──────────────────────────────────────────

	it("resets to initial state", () => {
		useSettingsStore.getState().setSettings({
			confirmOnQuit: true,
			terminalFontSize: 20,
		});

		useSettingsStore.getState().reset();

		const state = useSettingsStore.getState();
		expect(state.isLoaded).toBe(false);
		expect(state.confirmOnQuit).toBe(false);
		expect(state.terminalFontSize).toBeNull();
	});

	// ── editor settings ────────────────────────────────

	it("updates editor font settings", () => {
		useSettingsStore.getState().updateSetting("editorFontSize", 14);
		useSettingsStore
			.getState()
			.updateSetting("editorFontFamily", "Source Code Pro");

		const state = useSettingsStore.getState();
		expect(state.editorFontSize).toBe(14);
		expect(state.editorFontFamily).toBe("Source Code Pro");
	});

	// ── branch prefix settings ─────────────────────────

	it("updates branch prefix settings", () => {
		useSettingsStore.getState().updateSetting("branchPrefixMode", "custom");
		useSettingsStore.getState().updateSetting("branchPrefixCustom", "feat/");

		const state = useSettingsStore.getState();
		expect(state.branchPrefixMode).toBe("custom");
		expect(state.branchPrefixCustom).toBe("feat/");
	});

	// ── default editor ─────────────────────────────────

	it("updates default editor", () => {
		useSettingsStore.getState().updateSetting("defaultEditor", "cursor");

		expect(useSettingsStore.getState().defaultEditor).toBe("cursor");
	});
});
