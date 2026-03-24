/**
 * Root tRPC app router assembly.
 *
 * Accepts runtime dependencies and wires all sub-routers.
 * Every router uses a factory pattern for dependency injection.
 */

import { router } from "lib/trpc";
import { createAutoUpdateRouter } from "./auto-update";
import { createChangesTrpcRouter } from "./changes";
import type { AppInfo } from "./config";
import { createConfigRouter } from "./config";
import type { ShellOps } from "./external";
import { createExternalRouter } from "./external";
import { createFilesystemTrpcRouter } from "./filesystem";
import { createGitInfoTrpcRouter } from "./gitinfo";
import { createHotkeysTrpcRouter } from "./hotkeys";
import { createMenuRouter } from "./menu";
import { createProjectsTrpcRouter } from "./projects";
import { createPulseTrpcRouter } from "./pulse";
import { createSettingsTrpcRouter } from "./settings";
import { createTerminalRouter } from "./terminal";
import { createWindowRouter } from "./window";
import { createWorkspacesTrpcRouter } from "./workspaces";

// ── Dependency interface ──────────────────────────────

/** Dependencies injected into createAppRouter at startup. */
export interface AppRouterDeps {
	/** Returns the Drizzle ORM database instance. */
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type varies across test/production
	getDb: () => any;
	/** Factory that returns a simple-git instance for the given cwd. */
	// biome-ignore lint/suspicious/noExplicitAny: simple-git instance type varies
	getGit: (cwd?: string) => any;
	/** Filesystem operations from @signoff/workspace-fs. */
	// biome-ignore lint/suspicious/noExplicitAny: workspace-fs interface varies
	fsOps: any;
	/** Hotkey store for list/get/update/reset operations. */
	// biome-ignore lint/suspicious/noExplicitAny: hotkey store interface varies
	hotkeyStore: any;
	/** Settings database operations. */
	// biome-ignore lint/suspicious/noExplicitAny: settings db interface varies
	settingsDb: any;
	/** Terminal daemon manager for PTY session operations. */
	// biome-ignore lint/suspicious/noExplicitAny: TerminalManager type varies across test/production
	terminalManager: any;
	/** Returns the main BrowserWindow (null if not yet created). */
	// biome-ignore lint/suspicious/noExplicitAny: BrowserWindow type from electron
	getWindow: () => any;
	/** Returns app info (version, platform, dataPath). */
	getAppInfo: () => AppInfo;
	/** Shell operations for opening files/URLs externally. */
	shellOps: ShellOps;
}

// ── Router assembly ───────────────────────────────────

/**
 * Creates the root app router by assembling all sub-routers.
 *
 * This is the single source of truth for the tRPC API surface.
 * The router type is inferred and shared with the renderer via `AppRouter`.
 */
export function createAppRouter(deps: AppRouterDeps) {
	return router({
		projects: createProjectsTrpcRouter(deps.getDb),
		workspaces: createWorkspacesTrpcRouter(deps.getDb),
		changes: createChangesTrpcRouter(deps.getGit),
		filesystem: createFilesystemTrpcRouter(deps.fsOps),
		gitinfo: createGitInfoTrpcRouter(deps.getDb),
		pulse: createPulseTrpcRouter(deps.getDb),
		settings: createSettingsTrpcRouter(deps.settingsDb),
		hotkeys: createHotkeysTrpcRouter(deps.hotkeyStore),
		terminal: createTerminalRouter(deps.terminalManager),
		window: createWindowRouter(deps.getWindow),
		menu: createMenuRouter(deps.getWindow),
		config: createConfigRouter(deps.getAppInfo),
		external: createExternalRouter(deps.shellOps),
		autoUpdate: createAutoUpdateRouter(),
	});
}

/** The type of the root app router — used by the renderer for type-safe calls */
export type AppRouter = ReturnType<typeof createAppRouter>;
