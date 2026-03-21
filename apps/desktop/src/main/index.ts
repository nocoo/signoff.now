import { readFileSync } from "node:fs";
import path from "node:path";
import { app, protocol } from "electron";
import { makeAppSetup } from "lib/electron-app/factories/app/setup";
import {
	ensureProjectIconsDir,
	getProjectIconPath,
} from "main/lib/project-icons";
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

	// Create the main window
	makeAppSetup(() => MainWindow());
});

// ─── 6. Quit when all windows closed (except macOS) ─────────────────────────
app.on("window-all-closed", () => {
	if (PLATFORM !== "darwin") {
		app.quit();
	}
});
