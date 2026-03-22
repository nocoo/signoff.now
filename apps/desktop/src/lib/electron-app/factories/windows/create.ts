import path from "node:path";
import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	nativeTheme,
} from "electron";
import { DEFAULT_WINDOW } from "shared/constants";

/** Default options for creating a BrowserWindow */
const DEFAULT_OPTIONS: BrowserWindowConstructorOptions = {
	width: DEFAULT_WINDOW.WIDTH,
	height: DEFAULT_WINDOW.HEIGHT,
	minWidth: DEFAULT_WINDOW.MIN_WIDTH,
	minHeight: DEFAULT_WINDOW.MIN_HEIGHT,
	show: false,
	frame: false,
	titleBarStyle: "hidden",
	trafficLightPosition: { x: 16, y: 16 },
	backgroundColor: nativeTheme.shouldUseDarkColors ? "#252525" : "#ffffff",
	webPreferences: {
		preload: path.join(__dirname, "../preload/index.cjs"),
		sandbox: false,
		contextIsolation: true,
		nodeIntegration: false,
	},
};

/**
 * Creates a BrowserWindow with sensible defaults.
 * The window is hidden until content is loaded.
 */
export function createWindow(
	options?: Partial<BrowserWindowConstructorOptions>,
): BrowserWindow {
	const win = new BrowserWindow({
		...DEFAULT_OPTIONS,
		...options,
		webPreferences: {
			...DEFAULT_OPTIONS.webPreferences,
			...options?.webPreferences,
		},
	});

	// Intercept new-window to open in external browser
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https:") || url.startsWith("http:")) {
			import("electron").then(({ shell }) => shell.openExternal(url));
		}
		return { action: "deny" };
	});

	return win;
}
