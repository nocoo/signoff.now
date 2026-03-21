import type { BrowserWindow } from "electron";
import { createWindow } from "lib/electron-app/factories/windows/create";
import { registerRoute } from "lib/window-loader";

/**
 * Creates the main application window.
 *
 * Phase 3: Minimal — creates a window and shows it when ready.
 * Phase 4+ will add: tRPC IPC handler, window state restore, menu setup.
 */
export function MainWindow(): BrowserWindow {
	const win = createWindow();

	registerRoute(win, "/");

	win.once("ready-to-show", () => {
		win.show();
	});

	return win;
}
