import { readFileSync } from "node:fs";
import path from "node:path";
import { app, protocol, shell } from "electron";
import { makeAppSetup } from "lib/electron-app/factories/app/setup";
import type { AppRouterDeps } from "lib/trpc/routers";
import { ensureSignoffHomeDirExists } from "main/lib/app-environment";
import { initAppState } from "main/lib/app-state";
import { closeLocalDb, getDb, initLocalDb } from "main/lib/local-db";
import { buildApplicationMenu } from "main/lib/menu";
import {
	ensureProjectIconsDir,
	getProjectIconPath,
} from "main/lib/project-icons";
import {
	getTerminalManager,
	prewarmTerminalRuntime,
	reconcileDaemonSessions,
} from "main/lib/terminal";
import { createTerminalIpcBridge } from "main/lib/terminal/ipc-bridge";
import { closeAllFsHostServices } from "main/lib/workspace-fs";
import { createFsAdapter } from "main/lib/workspace-fs/adapter";
import {
	FONT_PROTOCOL,
	ICON_PROTOCOL,
	PLATFORM,
	PROTOCOL_SCHEME,
} from "shared/constants";
import { MainWindow } from "./windows/main";

// ─── 1. Register custom protocols as privileged (MUST be before app.whenReady) ─
protocol.registerSchemesAsPrivileged([
	{
		scheme: ICON_PROTOCOL,
		privileges: { bypassCSP: true, supportFetchAPI: true },
	},
	{
		scheme: FONT_PROTOCOL,
		privileges: { bypassCSP: true, supportFetchAPI: true },
	},
]);

// ─── 2. Register as default protocol client for deep linking ─────────────────
app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);

// ─── 3. Single instance lock ─────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

// ─── 4. Error handlers ──────────────────────────────────────────────────────
process.on("uncaughtException", (error) => {
	console.error("[main] Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
	console.error("[main] Unhandled rejection:", reason);
});

// ─── 5. App ready ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
	// Ensure all signoff directories exist
	ensureSignoffHomeDirExists();

	// Initialize local SQLite database (WAL mode + Drizzle)
	initLocalDb();

	// Initialize app state (lowdb-style JSON)
	initAppState();

	// Register icon protocol handler
	protocol.handle(ICON_PROTOCOL, (request) => {
		const url = new URL(request.url);
		const filename = path.basename(url.pathname);
		const projectId = filename.replace(".png", "");
		const iconPath = getProjectIconPath(projectId);

		if (iconPath) {
			const data = readFileSync(iconPath);
			return new Response(data, {
				headers: { "Content-Type": "image/png" },
			});
		}
		return new Response(null, { status: 404 });
	});

	// Register font protocol handler (macOS only)
	if (PLATFORM === "darwin") {
		protocol.handle(FONT_PROTOCOL, (request) => {
			const url = new URL(request.url);
			const fontPath = `/System/Library/Fonts/${path.basename(url.pathname)}`;
			try {
				const data = readFileSync(fontPath);
				return new Response(data, {
					headers: { "Content-Type": "font/otf" },
				});
			} catch {
				return new Response(null, { status: 404 });
			}
		});
	}

	// Ensure project icons directory exists
	ensureProjectIconsDir();

	// Initialize terminal manager and pre-warm daemon
	const terminalManager = getTerminalManager();
	prewarmTerminalRuntime();
	reconcileDaemonSessions();

	// Build native application menu
	buildApplicationMenu();

	// Create the main window and wire IPC bridge for terminal events
	let mainWindow: Electron.BrowserWindow | null = null;
	const ipcBridge = createTerminalIpcBridge(() => mainWindow);
	terminalManager.setIpcBridge(ipcBridge);

	// Construct tRPC router dependencies
	const deps: AppRouterDeps = {
		getDb,
		// simple-git factory: creates instance for a given cwd
		// biome-ignore lint/suspicious/noExplicitAny: simple-git dynamic import
		getGit: (cwd?: string) => require("simple-git").simpleGit(cwd),
		// @signoff/workspace-fs operations — adapter bridges router convention to FsHostService
		fsOps: createFsAdapter(),
		// Hotkey store (persistent via SQLite settings.customHotkeys)
		hotkeyStore: createPersistentHotkeyStore(),
		// Settings db operations
		settingsDb: createSettingsDbOps(),
		// Terminal manager for PTY session operations
		terminalManager,
		// BrowserWindow provider (lazily assigned after window creation)
		getWindow: () => mainWindow,
		// App info provider
		getAppInfo: () => ({
			version: app.getVersion(),
			platform: process.platform,
			dataPath: app.getPath("userData"),
		}),
		// Shell operations for opening files/URLs externally
		shellOps: {
			showItemInFolder: shell.showItemInFolder,
			openExternal: shell.openExternal,
		},
	};

	makeAppSetup(() => {
		mainWindow = MainWindow(deps);
		return mainWindow;
	});
});

// ─── 6. Quit when all windows closed (except macOS) ─────────────────────────
app.on("window-all-closed", () => {
	if (PLATFORM !== "darwin") {
		app.quit();
	}
});

// ─── 7. Cleanup on quit ─────────────────────────────────────────────────────
app.on("will-quit", () => {
	closeLocalDb();
	closeAllFsHostServices();
	getTerminalManager()
		.dispose()
		.catch((err) => {
			console.error("[main] Terminal manager dispose error:", err);
		});
});

// ─── Dependency factories ──────────────────────────────────────────────────

import { settings } from "@signoff/local-db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "lib/trpc/routers/settings";

/** Creates a settings DB adapter that reads/writes the settings table. */
function createSettingsDbOps() {
	return {
		async get() {
			const db = getDb();
			const row = db.select().from(settings).where(eq(settings.id, 1)).get();
			return row ?? null;
		},
		async update(values: Record<string, unknown>) {
			const db = getDb();
			// Upsert: try update, if no row exists insert defaults + values
			const existing = db
				.select()
				.from(settings)
				.where(eq(settings.id, 1))
				.get();
			if (existing) {
				db.update(settings).set(values).where(eq(settings.id, 1)).run();
			} else {
				db.insert(settings)
					.values({ id: 1, ...values })
					.run();
			}
			return (
				db.select().from(settings).where(eq(settings.id, 1)).get() ?? {
					...DEFAULT_SETTINGS,
					...values,
				}
			);
		},
	};
}

/**
 * Persistent hotkey store backed by the settings.customHotkeys JSON column.
 *
 * Stores only user overrides (action → keys mapping). At read time, merges
 * overrides on top of DEFAULT_BINDINGS so new defaults are picked up
 * automatically.
 */
function createPersistentHotkeyStore() {
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

	/** Read custom overrides from SQLite settings row. */
	function getOverrides(): Record<string, string> {
		try {
			const db = getDb();
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

	/** Persist custom overrides to SQLite settings row. */
	function setOverrides(overrides: Record<string, string>): void {
		const db = getDb();
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

	/** Merge defaults with persisted overrides. */
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
