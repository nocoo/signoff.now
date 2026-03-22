/**
 * Tests for the settings tRPC router.
 *
 * TDD: written before implementation.
 * Uses a mock db object to test settings operations
 * without requiring a real SQLite database.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createSettingsRouter } from "./index";

/** Default settings shape returned by the mock. */
const DEFAULT_SETTINGS = {
	id: 1,
	lastActiveWorkspaceId: null,
	terminalPresets: null,
	terminalPresetsInitialized: false,
	confirmOnQuit: false,
	terminalLinkBehavior: "external-editor",
	terminalPersistence: true,
	autoApplyDefaultPreset: false,
	branchPrefixMode: "none",
	branchPrefixCustom: null,
	deleteLocalBranch: false,
	fileOpenMode: "split-pane",
	showPresetsBar: true,
	useCompactTerminalAddButton: false,
	terminalFontFamily: null,
	terminalFontSize: null,
	editorFontFamily: null,
	editorFontSize: null,
	worktreeBaseDir: null,
	openLinksInApp: false,
	defaultEditor: null,
};

/** Create a mock db object that simulates Drizzle-like operations. */
function createMockDb() {
	let currentSettings = { ...DEFAULT_SETTINGS };

	return {
		/** Simulates db.select().from(settings).get() */
		get: mock(() => Promise.resolve({ ...currentSettings })),
		/** Simulates db.update(settings).set(values).where(eq(settings.id, 1)) */
		update: mock((values: Record<string, unknown>) => {
			currentSettings = { ...currentSettings, ...values };
			return Promise.resolve({ ...currentSettings });
		}),
		/** Reset internal state for test isolation. */
		_reset() {
			currentSettings = { ...DEFAULT_SETTINGS };
		},
	};
}

type MockDb = ReturnType<typeof createMockDb>;

describe("settings router", () => {
	let mockDb: MockDb;
	let router: ReturnType<typeof createSettingsRouter>;

	beforeEach(() => {
		mockDb = createMockDb();
		router = createSettingsRouter(mockDb as unknown);
	});

	afterEach(() => {
		mock.restore();
	});

	// ── get ──────────────────────────────────────────────

	describe("get", () => {
		it("returns current settings", async () => {
			const result = await router.get();

			expect(result).toBeDefined();
			expect(result.id).toBe(1);
			expect(result.confirmOnQuit).toBe(false);
			expect(result.terminalPersistence).toBe(true);
		});

		it("calls db.get once", async () => {
			await router.get();
			expect(mockDb.get).toHaveBeenCalledTimes(1);
		});

		it("returns default values when settings not initialized", async () => {
			(mockDb.get as ReturnType<typeof mock>).mockImplementation(() =>
				Promise.resolve(null),
			);
			const result = await router.get();

			// Should return defaults when no row exists
			expect(result).toBeDefined();
			expect(result.confirmOnQuit).toBe(false);
			expect(result.terminalPersistence).toBe(true);
		});
	});

	// ── update ──────────────────────────────────────────

	describe("update", () => {
		it("updates a single setting", async () => {
			const result = await router.update({ confirmOnQuit: true });

			expect(result.confirmOnQuit).toBe(true);
			expect(mockDb.update).toHaveBeenCalledTimes(1);
		});

		it("updates multiple settings at once", async () => {
			const result = await router.update({
				terminalFontSize: 16,
				terminalFontFamily: "JetBrains Mono",
				editorFontSize: 14,
			});

			expect(result.terminalFontSize).toBe(16);
			expect(result.terminalFontFamily).toBe("JetBrains Mono");
			expect(result.editorFontSize).toBe(14);
		});

		it("updates terminal link behavior", async () => {
			const result = await router.update({
				terminalLinkBehavior: "file-viewer",
			});

			expect(result.terminalLinkBehavior).toBe("file-viewer");
		});

		it("updates branch prefix mode and custom prefix", async () => {
			const result = await router.update({
				branchPrefixMode: "custom",
				branchPrefixCustom: "feature/",
			});

			expect(result.branchPrefixMode).toBe("custom");
			expect(result.branchPrefixCustom).toBe("feature/");
		});

		it("updates file open mode", async () => {
			const result = await router.update({
				fileOpenMode: "new-tab",
			});

			expect(result.fileOpenMode).toBe("new-tab");
		});

		it("updates default editor", async () => {
			const result = await router.update({
				defaultEditor: "vscode",
			});

			expect(result.defaultEditor).toBe("vscode");
		});

		it("clears nullable fields by setting to null", async () => {
			// First set a value
			await router.update({ terminalFontFamily: "Menlo" });
			// Then clear it
			const result = await router.update({ terminalFontFamily: null });

			expect(result.terminalFontFamily).toBeNull();
		});

		it("updates worktree base dir", async () => {
			const result = await router.update({
				worktreeBaseDir: "/custom/worktrees",
			});

			expect(result.worktreeBaseDir).toBe("/custom/worktrees");
		});
	});
});
