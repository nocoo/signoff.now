import path from "node:path";
import type { BrowserWindow } from "electron";

const isDev = process.env.NODE_ENV === "development";

/**
 * Registers a route (URL) for a BrowserWindow.
 *
 * In development, loads from the Vite dev server.
 * In production, loads the built HTML file.
 */
export function registerRoute(win: BrowserWindow, route = "/"): Promise<void> {
	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		const url = `${process.env.ELECTRON_RENDERER_URL}${route === "/" ? "" : route}`;
		return win.loadURL(url);
	}
	return win.loadFile(
		path.join(__dirname, "../renderer/index.html"),
		route !== "/" ? { hash: route } : undefined,
	);
}
