import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { SIGNOFF_HOME_DIR } from "main/lib/app-environment";
import { DIR_NAMES, ICON_PROTOCOL } from "shared/constants";

/**
 * Returns the path to the project icons directory.
 */
export function getProjectIconsDir(): string {
	return path.join(SIGNOFF_HOME_DIR, DIR_NAMES.PROJECT_ICONS);
}

/**
 * Ensures the project icons directory exists. Creates it if missing.
 */
export function ensureProjectIconsDir(): void {
	const dir = getProjectIconsDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Returns the file path for a given project's icon, or null if it doesn't exist.
 */
export function getProjectIconPath(projectId: string): string | null {
	const iconPath = path.join(getProjectIconsDir(), `${projectId}.png`);
	return existsSync(iconPath) ? iconPath : null;
}

/**
 * Returns the custom protocol URL for a project icon.
 * Used in the renderer to load icons via the custom protocol handler.
 */
export function getProjectIconProtocolUrl(projectId: string): string {
	return `${ICON_PROTOCOL}://icon/${projectId}.png`;
}

/**
 * Saves a project icon from a Buffer to disk.
 */
export function saveProjectIconFromBuffer(
	projectId: string,
	buffer: Buffer,
): string {
	const iconPath = path.join(getProjectIconsDir(), `${projectId}.png`);
	writeFileSync(iconPath, buffer);
	return iconPath;
}

/**
 * Reads a project icon file and returns its contents as a Buffer, or null.
 */
export function readProjectIcon(projectId: string): Buffer | null {
	const iconPath = getProjectIconPath(projectId);
	if (!iconPath) return null;
	return readFileSync(iconPath);
}

/**
 * Deletes a project icon file if it exists.
 */
export function deleteProjectIcon(projectId: string): void {
	const iconPath = path.join(getProjectIconsDir(), `${projectId}.png`);
	if (existsSync(iconPath)) {
		rmSync(iconPath);
	}
}
