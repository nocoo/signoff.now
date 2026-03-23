import { app, type BrowserWindow } from "electron";

/**
 * Creates the app-level setup (devtools, activate handler, external URL interception).
 *
 * Phase 3: Minimal — just opens the main window and handles activate.
 */
export function makeAppSetup(
	createMainWindow: () => BrowserWindow | Promise<BrowserWindow>,
): void {
	let mainWindow: BrowserWindow | null = null;

	const initWindow = async () => {
		mainWindow = await Promise.resolve(createMainWindow());

		// Open devtools in development
		if (!app.isPackaged) {
			mainWindow.webContents?.openDevTools?.();
		}

		return mainWindow;
	};

	// On macOS, re-open window when dock icon is clicked
	app.on("activate", () => {
		if (mainWindow === null || mainWindow.isDestroyed()) {
			initWindow();
		}
	});

	initWindow();
}
