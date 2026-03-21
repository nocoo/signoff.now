import { platform } from "node:os";

/**
 * Desktop app constants.
 * Pure values — no Electron imports, safe for all environments including tests.
 */

/** Current platform identifier */
export const PLATFORM = platform();

/** Custom protocol scheme for deep linking */
export const PROTOCOL_SCHEME = "signoff";

/** Custom protocol for project icons */
export const ICON_PROTOCOL = "signoff-icon";

/** Custom protocol for system fonts */
export const FONT_PROTOCOL = "signoff-font";

/** Name of the app's hidden directory in the user's home folder */
export const SIGNOFF_DIR_NAME = ".signoff";

/** Directory names within the signoff home directory */
export const DIR_NAMES = {
	/** Stores project icon files */
	PROJECT_ICONS: "project-icons",
	/** Stores local database files */
	DATA: "data",
	/** Stores log files */
	LOGS: "logs",
	/** Stores temporary files */
	TEMP: "temp",
} as const;

/** Default window dimensions */
export const DEFAULT_WINDOW = {
	WIDTH: 1280,
	HEIGHT: 800,
	MIN_WIDTH: 680,
	MIN_HEIGHT: 400,
} as const;

/** File names for persistent state */
export const STATE_FILES = {
	/** App state (lowdb JSON) */
	APP_STATE: "app-state.json",
	/** Window state (bounds, maximized) */
	WINDOW_STATE: "window-state.json",
} as const;
