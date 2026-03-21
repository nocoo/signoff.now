import path from "node:path";
import type { Plugin } from "vite";

/**
 * Returns the dev server URL for the renderer process.
 */
export function devPath(port: number): string {
	return `http://localhost:${port}`;
}

/**
 * Produces define entries for Vite's `define` option.
 * Wraps each value in JSON.stringify so it becomes a string literal in the bundle.
 */
export function defineEnv(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		result[`process.env.${key}`] = JSON.stringify(value ?? "");
	}
	return result;
}

/**
 * Vite plugin that copies build-specific resources for the main process.
 *
 * Note: renderer public files (theme-boot.js) are handled by Vite's
 * publicDir option in electron.vite.config.ts, not this plugin.
 */
export function copyResourcesPlugin(): Plugin {
	return {
		name: "copy-resources",
		generateBundle() {
			// Main process resources (e.g., tray icons, native helpers) can be
			// emitted here if needed. Renderer public assets are served via
			// Vite's publicDir (src/resources/public) and don't need this plugin.
		},
	};
}

/**
 * Resolves a path relative to the project root.
 */
export function projectPath(...segments: string[]): string {
	return path.resolve(__dirname, "..", ...segments);
}
