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
 * Vite plugin that copies `src/resources/public` into the renderer output.
 * This makes files like `theme-boot.js` available at the root of the built app.
 */
export function copyResourcesPlugin(): Plugin {
	return {
		name: "copy-resources",
		generateBundle() {
			// In production builds, electron-vite handles resource copying
			// via electron-builder's extraResources config.
			// This plugin is a placeholder for custom copy logic if needed.
		},
	};
}

/**
 * Resolves a path relative to the project root.
 */
export function projectPath(...segments: string[]): string {
	return path.resolve(__dirname, "..", ...segments);
}
