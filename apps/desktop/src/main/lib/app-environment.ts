import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DIR_NAMES, SIGNOFF_DIR_NAME, STATE_FILES } from "shared/constants";

/**
 * The root directory for all Signoff desktop app data.
 * Located at `~/.signoff/`
 */
export const SIGNOFF_HOME_DIR = path.join(homedir(), SIGNOFF_DIR_NAME);

/**
 * Ensures the signoff home directory and its subdirectories exist.
 * Creates them recursively if they don't exist.
 */
export function ensureSignoffHomeDirExists(): void {
	const dirs = [
		SIGNOFF_HOME_DIR,
		path.join(SIGNOFF_HOME_DIR, DIR_NAMES.PROJECT_ICONS),
		path.join(SIGNOFF_HOME_DIR, DIR_NAMES.DATA),
		path.join(SIGNOFF_HOME_DIR, DIR_NAMES.LOGS),
		path.join(SIGNOFF_HOME_DIR, DIR_NAMES.TEMP),
	];
	for (const dir of dirs) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
}

/** Path to the app state JSON file */
export function getAppStatePath(): string {
	return path.join(SIGNOFF_HOME_DIR, DIR_NAMES.DATA, STATE_FILES.APP_STATE);
}

/** Path to the window state JSON file */
export function getWindowStatePath(): string {
	return path.join(SIGNOFF_HOME_DIR, DIR_NAMES.DATA, STATE_FILES.WINDOW_STATE);
}

/** Path to the local database directory */
export function getDbDir(): string {
	return path.join(SIGNOFF_HOME_DIR, DIR_NAMES.DATA);
}
