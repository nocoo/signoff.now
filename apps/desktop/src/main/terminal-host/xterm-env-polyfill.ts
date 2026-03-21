/**
 * Polyfill for @xterm/headless compatibility in Node/Bun test environments.
 *
 * @xterm/headless checks for `window` to determine if it's in a browser.
 * In test environments (Bun), there is no `window` global, causing failures.
 * This polyfill sets `globalThis.window = globalThis` so @xterm/headless
 * can initialize without errors.
 */
if (typeof globalThis.window === "undefined") {
	// biome-ignore lint/suspicious/noExplicitAny: polyfill requires any cast
	(globalThis as any).window = globalThis;
}
