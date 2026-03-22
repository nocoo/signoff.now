import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getWindowStatePath } from "main/lib/app-environment";
import { DEFAULT_WINDOW } from "shared/constants";

/**
 * Persisted window state — bounds and maximized flag.
 */
export interface WindowState {
	x: number | undefined;
	y: number | undefined;
	width: number;
	height: number;
	isMaximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = {
	x: undefined,
	y: undefined,
	width: DEFAULT_WINDOW.WIDTH,
	height: DEFAULT_WINDOW.HEIGHT,
	isMaximized: false,
};

/**
 * Reads the saved window state from disk.
 * Returns defaults if no state file exists or parsing fails.
 */
export function loadWindowState(): WindowState {
	const statePath = getWindowStatePath();
	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, "utf-8");
			return { ...DEFAULT_WINDOW_STATE, ...JSON.parse(raw) };
		} catch {
			return { ...DEFAULT_WINDOW_STATE };
		}
	}
	return { ...DEFAULT_WINDOW_STATE };
}

/**
 * Saves window state to disk.
 * Should be called on window move, resize, maximize, and unmaximize events.
 */
export function saveWindowState(state: WindowState): void {
	const statePath = getWindowStatePath();
	writeFileSync(statePath, JSON.stringify(state, null, "\t"), "utf-8");
}

/**
 * Extracts the current window state from a BrowserWindow-like bounds object.
 */
export function extractWindowState(bounds: {
	x: number;
	y: number;
	width: number;
	height: number;
	isMaximized: boolean;
}): WindowState {
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		isMaximized: bounds.isMaximized,
	};
}
