/**
 * Integration tests for the persistent hotkey store.
 *
 * Exercises the store factory with a real in-memory SQLite database
 * to verify hotkey customizations survive across store invocations.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as schema from "@signoff/local-db";
import { settings } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createHotkeysRouter } from "./index";

const CREATE_SETTINGS_SQL = `
CREATE TABLE IF NOT EXISTS settings (
	id integer PRIMARY KEY DEFAULT 1 NOT NULL,
	last_active_workspace_id text,
	terminal_presets text,
	terminal_presets_initialized integer,
	confirm_on_quit integer,
	terminal_link_behavior text,
	persist_terminal integer DEFAULT 1,
	auto_apply_default_preset integer,
	branch_prefix_mode text,
	branch_prefix_custom text,
	delete_local_branch integer,
	file_open_mode text,
	show_presets_bar integer,
	use_compact_terminal_add_button integer,
	terminal_font_family text,
	terminal_font_size integer,
	editor_font_family text,
	editor_font_size integer,
	worktree_base_dir text,
	open_links_in_app integer,
	default_editor text,
	custom_hotkeys text
);
`;

const DEFAULT_BINDINGS = [
	{
		action: "quickOpen",
		keys: "Cmd+P",
		label: "Quick Open",
		category: "general",
	},
	{
		action: "openSettings",
		keys: "Cmd+,",
		label: "Open Settings",
		category: "general",
	},
	{
		action: "toggleSidebar",
		keys: "Cmd+B",
		label: "Toggle Sidebar",
		category: "general",
	},
	{
		action: "newTerminal",
		keys: "Cmd+T",
		label: "New Terminal",
		category: "terminal",
	},
	{ action: "closeTab", keys: "Cmd+W", label: "Close Tab", category: "tabs" },
	{
		action: "nextTab",
		keys: "Cmd+Shift+]",
		label: "Next Tab",
		category: "tabs",
	},
	{
		action: "prevTab",
		keys: "Cmd+Shift+[",
		label: "Previous Tab",
		category: "tabs",
	},
	{
		action: "splitPane",
		keys: "Cmd+\\",
		label: "Split Pane",
		category: "editor",
	},
	{
		action: "stageAll",
		keys: "Cmd+Shift+A",
		label: "Stage All",
		category: "git",
	},
	{
		action: "commitChanges",
		keys: "Cmd+Enter",
		label: "Commit",
		category: "git",
	},
];

type Binding = (typeof DEFAULT_BINDINGS)[number];

/**
 * Creates a persistent hotkey store backed by an in-memory SQLite database.
 * Mirrors the production implementation in main/index.ts but accepts an
 * injected DB for testability.
 */
function createTestPersistentHotkeyStore(
	db: ReturnType<typeof drizzle<typeof schema>>,
) {
	function getOverrides(): Record<string, string> {
		try {
			const row = db
				.select({ customHotkeys: settings.customHotkeys })
				.from(settings)
				.where(eq(settings.id, 1))
				.get();
			return (row?.customHotkeys as Record<string, string>) ?? {};
		} catch {
			return {};
		}
	}

	function setOverrides(overrides: Record<string, string>): void {
		const existing = db.select().from(settings).where(eq(settings.id, 1)).get();
		if (existing) {
			db.update(settings)
				.set({ customHotkeys: overrides })
				.where(eq(settings.id, 1))
				.run();
		} else {
			db.insert(settings).values({ id: 1, customHotkeys: overrides }).run();
		}
	}

	function resolvedBindings(): Binding[] {
		const overrides = getOverrides();
		return DEFAULT_BINDINGS.map((b) =>
			overrides[b.action] ? { ...b, keys: overrides[b.action] } : b,
		);
	}

	return {
		async list() {
			return resolvedBindings();
		},
		async get(action: string) {
			return resolvedBindings().find((b) => b.action === action) ?? null;
		},
		async update(action: string, keys: string) {
			const overrides = getOverrides();
			overrides[action] = keys;
			setOverrides(overrides);
			return resolvedBindings().find((b) => b.action === action) ?? null;
		},
		async reset(action: string) {
			const overrides = getOverrides();
			delete overrides[action];
			setOverrides(overrides);
			return resolvedBindings().find((b) => b.action === action) ?? null;
		},
		async resetAll() {
			setOverrides({});
			return resolvedBindings();
		},
	};
}

describe("persistent hotkey store", () => {
	let sqlite: Database;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	let store: ReturnType<typeof createTestPersistentHotkeyStore>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.exec("PRAGMA journal_mode = WAL");
		sqlite.exec(CREATE_SETTINGS_SQL);
		sqlite.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");
		db = drizzle(sqlite, { schema });
		store = createTestPersistentHotkeyStore(db);
	});

	afterEach(() => {
		sqlite.close();
	});

	// ── list ────────────────────────────────────────────

	it("returns all default bindings when no overrides exist", async () => {
		const result = await store.list();
		expect(result).toHaveLength(DEFAULT_BINDINGS.length);
		expect(result[0].action).toBe("quickOpen");
		expect(result[0].keys).toBe("Cmd+P");
	});

	// ── update + persistence ───────────────────────────

	it("persists updated key binding to SQLite", async () => {
		await store.update("quickOpen", "Ctrl+K");

		// Verify in-store
		const binding = await store.get("quickOpen");
		expect(binding?.keys).toBe("Ctrl+K");

		// Verify directly in SQLite
		const row = db
			.select({ customHotkeys: settings.customHotkeys })
			.from(settings)
			.where(eq(settings.id, 1))
			.get();
		const overrides = row?.customHotkeys as Record<string, string>;
		expect(overrides.quickOpen).toBe("Ctrl+K");
	});

	it("preserves other bindings when updating one", async () => {
		await store.update("quickOpen", "Ctrl+K");

		const all = await store.list();
		const openSettings = all.find((b) => b.action === "openSettings");
		expect(openSettings?.keys).toBe("Cmd+,"); // unchanged
	});

	it("survives store recreation from same DB", async () => {
		await store.update("newTerminal", "Ctrl+Shift+T");

		// Create a new store instance pointing at the same DB
		const store2 = createTestPersistentHotkeyStore(db);
		const binding = await store2.get("newTerminal");
		expect(binding?.keys).toBe("Ctrl+Shift+T");
	});

	// ── reset single ──────────────────────────────────

	it("resets a single binding to default", async () => {
		await store.update("quickOpen", "Ctrl+K");
		await store.reset("quickOpen");

		const binding = await store.get("quickOpen");
		expect(binding?.keys).toBe("Cmd+P"); // back to default
	});

	it("reset removes the override from SQLite", async () => {
		await store.update("quickOpen", "Ctrl+K");
		await store.update("newTerminal", "Ctrl+Shift+T");
		await store.reset("quickOpen");

		const row = db
			.select({ customHotkeys: settings.customHotkeys })
			.from(settings)
			.where(eq(settings.id, 1))
			.get();
		const overrides = row?.customHotkeys as Record<string, string>;
		expect(overrides.quickOpen).toBeUndefined();
		expect(overrides.newTerminal).toBe("Ctrl+Shift+T");
	});

	// ── resetAll ──────────────────────────────────────

	it("resets all bindings to defaults", async () => {
		await store.update("quickOpen", "Ctrl+K");
		await store.update("newTerminal", "Ctrl+Shift+T");
		await store.resetAll();

		const all = await store.list();
		expect(all.find((b) => b.action === "quickOpen")?.keys).toBe("Cmd+P");
		expect(all.find((b) => b.action === "newTerminal")?.keys).toBe("Cmd+T");

		// SQLite overrides should be empty
		const row = db
			.select({ customHotkeys: settings.customHotkeys })
			.from(settings)
			.where(eq(settings.id, 1))
			.get();
		const overrides = row?.customHotkeys as Record<string, string>;
		expect(Object.keys(overrides)).toHaveLength(0);
	});

	// ── get ────────────────────────────────────────────

	it("returns null for unknown action", async () => {
		const result = await store.get("nonexistent");
		expect(result).toBeNull();
	});

	// ── integration with router factory ────────────────

	it("works through createHotkeysRouter", async () => {
		const router = createHotkeysRouter(store);

		await router.update({ action: "closeTab", keys: "Alt+W" });
		const binding = await router.get({ action: "closeTab" });
		expect(binding?.keys).toBe("Alt+W");

		await router.reset({ action: "closeTab" });
		const reset = await router.get({ action: "closeTab" });
		expect(reset?.keys).toBe("Cmd+W");
	});

	// ── graceful fallback ──────────────────────────────

	it("returns defaults when settings row does not exist", async () => {
		// Delete the settings row
		sqlite.exec("DELETE FROM settings");

		const all = await store.list();
		expect(all).toHaveLength(DEFAULT_BINDINGS.length);
		expect(all[0].keys).toBe("Cmd+P"); // default
	});
});
