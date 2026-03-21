import type { BrowserWindow } from "electron";
import { createWindow } from "lib/electron-app/factories/windows/create";
import { createAppRouter } from "lib/trpc/routers";
import { registerRoute } from "lib/window-loader";
import { createIPCHandler } from "trpc-electron/main";

/**
 * Creates the main application window with tRPC IPC handler.
 *
 * Phase 4: Adds tRPC IPC handler for type-safe renderer ↔ main communication.
 * Phase 4+ will add: window state restore, menu setup, notification server.
 */
export function MainWindow(): BrowserWindow {
	const win = createWindow();

	// Create the tRPC router and attach IPC handler to this window
	const appRouter = createAppRouter();
	createIPCHandler({
		router: appRouter,
		windows: [win],
	});

	registerRoute(win, "/");

	win.once("ready-to-show", () => {
		win.show();
	});

	return win;
}
