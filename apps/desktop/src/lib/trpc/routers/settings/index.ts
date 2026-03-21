/**
 * Settings router — user preferences for the desktop app.
 *
 * Uses the factory pattern:
 * - createSettingsRouter(db) returns plain async functions (testable)
 * - createSettingsTrpcRouter(db) wraps in tRPC procedures
 *
 * The db dependency provides get() and update() operations
 * against the settings table.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────

export interface Settings {
	id: number;
	lastActiveWorkspaceId: string | null;
	terminalPresets: unknown[] | null;
	terminalPresetsInitialized: boolean;
	confirmOnQuit: boolean;
	terminalLinkBehavior: string;
	terminalPersistence: boolean;
	autoApplyDefaultPreset: boolean;
	branchPrefixMode: string;
	branchPrefixCustom: string | null;
	deleteLocalBranch: boolean;
	fileOpenMode: string;
	showPresetsBar: boolean;
	useCompactTerminalAddButton: boolean;
	terminalFontFamily: string | null;
	terminalFontSize: number | null;
	editorFontFamily: string | null;
	editorFontSize: number | null;
	worktreeBaseDir: string | null;
	openLinksInApp: boolean;
	defaultEditor: string | null;
}

/** Default settings used when no row exists in the database. */
export const DEFAULT_SETTINGS: Settings = {
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

// ── Factory ───────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: db instance type varies between test mock and production
type SettingsDb = any;

export function createSettingsRouter(db: SettingsDb) {
	return {
		async get(): Promise<Settings> {
			const row = await db.get();
			if (!row) return { ...DEFAULT_SETTINGS };
			return row;
		},

		async update(values: Partial<Omit<Settings, "id">>): Promise<Settings> {
			const updated = await db.update(values);
			return updated;
		},
	};
}

// ── tRPC wrapper ──────────────────────────────────────

const settingsUpdateSchema = z.object({
	lastActiveWorkspaceId: z.string().nullable().optional(),
	terminalPresetsInitialized: z.boolean().optional(),
	confirmOnQuit: z.boolean().optional(),
	terminalLinkBehavior: z.string().optional(),
	terminalPersistence: z.boolean().optional(),
	autoApplyDefaultPreset: z.boolean().optional(),
	branchPrefixMode: z.string().optional(),
	branchPrefixCustom: z.string().nullable().optional(),
	deleteLocalBranch: z.boolean().optional(),
	fileOpenMode: z.string().optional(),
	showPresetsBar: z.boolean().optional(),
	useCompactTerminalAddButton: z.boolean().optional(),
	terminalFontFamily: z.string().nullable().optional(),
	terminalFontSize: z.number().nullable().optional(),
	editorFontFamily: z.string().nullable().optional(),
	editorFontSize: z.number().nullable().optional(),
	worktreeBaseDir: z.string().nullable().optional(),
	openLinksInApp: z.boolean().optional(),
	defaultEditor: z.string().nullable().optional(),
});

export function createSettingsTrpcRouter(db: SettingsDb) {
	const impl = createSettingsRouter(db);

	return router({
		get: publicProcedure.query(() => impl.get()),

		update: publicProcedure
			.input(settingsUpdateSchema)
			.mutation(({ input }) => impl.update(input)),
	});
}

/** Stub router kept for backward compatibility. */
export const settingsRouter = router({});
