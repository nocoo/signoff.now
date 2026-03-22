import type { BrowserWindow } from "electron";
import { createWindow } from "lib/electron-app/factories/windows/create";
import type { AppRouterDeps } from "lib/trpc/routers";
import { createAppRouter } from "lib/trpc/routers";
import { registerRoute } from "lib/window-loader";
import {
	extractWindowState,
	loadWindowState,
	saveWindowState,
} from "main/lib/window-state";
import { createIPCHandler } from "trpc-electron/main";

/**
 * Creates the main application window with tRPC IPC handler and window state.
 *
 * Accepts runtime dependencies for tRPC router creation.
 */
export function MainWindow(deps: AppRouterDeps): BrowserWindow {
	// Restore saved window state
	const windowState = loadWindowState();

	const win = createWindow({
		x: windowState.x,
		y: windowState.y,
		width: windowState.width,
		height: windowState.height,
	});

	if (windowState.isMaximized) {
		win.maximize();
	}

	// Create the tRPC router and attach IPC handler to this window
	const appRouter = createAppRouter(deps);
	createIPCHandler({
		router: appRouter,
		windows: [win],
	});

	// Persist window state on changes
	const persistState = () => {
		if (!win.isDestroyed()) {
			const bounds = win.getBounds();
			saveWindowState(
				extractWindowState({
					...bounds,
					isMaximized: win.isMaximized(),
				}),
			);
		}
	};

	win.on("resize", persistState);
	win.on("move", persistState);
	win.on("maximize", persistState);
	win.on("unmaximize", persistState);

	registerRoute(win, "/");

	win.once("ready-to-show", () => {
		win.show();
	});

	return win;
}
