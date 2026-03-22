/**
 * Root tRPC app router assembly.
 *
 * Accepts runtime dependencies and wires factory-created routers
 * for projects, workspaces, changes, filesystem, settings, and hotkeys.
 * Remaining routers (window, menu, terminal, config, external, autoUpdate)
 * are still stubs pending future implementation.
 */

import { router } from "lib/trpc";
import { autoUpdateRouter } from "./auto-update";
import { createChangesTrpcRouter } from "./changes";
import { configRouter } from "./config";
import { externalRouter } from "./external";
import { createFilesystemTrpcRouter } from "./filesystem";
import { createHotkeysTrpcRouter } from "./hotkeys";
import { menuRouter } from "./menu";
import { createProjectsTrpcRouter } from "./projects";
import { createSettingsTrpcRouter } from "./settings";
import { createTerminalRouter } from "./terminal";
import { windowRouter } from "./window";
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
		// Factory-created routers with real implementations
		projects: createProjectsTrpcRouter(deps.getDb),
		workspaces: createWorkspacesTrpcRouter(deps.getDb),
		changes: createChangesTrpcRouter(deps.getGit),
		filesystem: createFilesystemTrpcRouter(deps.fsOps),
		settings: createSettingsTrpcRouter(deps.settingsDb),
		hotkeys: createHotkeysTrpcRouter(deps.hotkeyStore),
		terminal: createTerminalRouter(deps.terminalManager),

		// Stub routers — pending future implementation
		window: windowRouter,
		menu: menuRouter,
		config: configRouter,
		external: externalRouter,
		autoUpdate: autoUpdateRouter,
	});
}

/** The type of the root app router — used by the renderer for type-safe calls */
export type AppRouter = ReturnType<typeof createAppRouter>;
