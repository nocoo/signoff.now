import { router } from "lib/trpc";
import { autoUpdateRouter } from "./auto-update";
import { changesRouter } from "./changes";
import { configRouter } from "./config";
import { externalRouter } from "./external";
import { filesystemRouter } from "./filesystem";
import { hotkeysRouter } from "./hotkeys";
import { menuRouter } from "./menu";
import { projectsRouter } from "./projects";
import { settingsRouter } from "./settings";
import { terminalRouter } from "./terminal";
import { windowRouter } from "./window";
import { workspacesRouter } from "./workspaces";

/**
 * Creates the root app router by assembling all sub-routers.
 *
 * This is the single source of truth for the tRPC API surface.
 * The router type is inferred and shared with the renderer via `AppRouter`.
 */
export function createAppRouter() {
	return router({
		window: windowRouter,
		menu: menuRouter,
		projects: projectsRouter,
		workspaces: workspacesRouter,
		terminal: terminalRouter,
		changes: changesRouter,
		filesystem: filesystemRouter,
		settings: settingsRouter,
		config: configRouter,
		hotkeys: hotkeysRouter,
		external: externalRouter,
		autoUpdate: autoUpdateRouter,
	});
}

/** The type of the root app router — used by the renderer for type-safe calls */
export type AppRouter = ReturnType<typeof createAppRouter>;
