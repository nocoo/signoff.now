import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getAppStatePath } from "main/lib/app-environment";

/**
 * Default app state shape.
 *
 * Stored as a JSON file for lightweight persistence (lowdb-style).
 * This is for app-level state that doesn't fit in SQLite (e.g. last opened project).
 */
export interface AppState {
	/** ID of the last active project */
	lastActiveProjectId: string | null;
	/** Whether the onboarding flow has been completed */
	onboardingCompleted: boolean;
	/** Timestamp of last update check */
	lastUpdateCheck: number | null;
}

const DEFAULT_STATE: AppState = {
	lastActiveProjectId: null,
	onboardingCompleted: false,
	lastUpdateCheck: null,
};

let _state: AppState | null = null;

/**
 * Reads the app state from disk, or returns defaults if not found.
 */
export function getAppState(): AppState {
	if (_state) return _state;

	const statePath = getAppStatePath();
	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, "utf-8");
			_state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
		} catch {
			_state = { ...DEFAULT_STATE };
		}
	} else {
		_state = { ...DEFAULT_STATE };
	}
	return _state as AppState;
}

/**
 * Updates the app state and persists it to disk.
 */
export function updateAppState(patch: Partial<AppState>): AppState {
	const current = getAppState();
	_state = { ...current, ...patch };
	const statePath = getAppStatePath();
	writeFileSync(statePath, JSON.stringify(_state, null, "\t"), "utf-8");
	return _state;
}

/**
 * Initializes app state by reading from disk.
 * Called during app boot.
 */
export function initAppState(): AppState {
	_state = null; // Force re-read from disk
	return getAppState();
}
