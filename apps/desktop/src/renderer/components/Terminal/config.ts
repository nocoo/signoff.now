/**
 * Terminal configuration — xterm options, font families, and constants.
 *
 * 🔴 Trimmed from superset: DEBUG_TERMINAL flag removed (no localStorage
 * in headless env), SUPERSET_TERMINAL_DEBUG renamed. Theme config deferred
 * to Phase 6+ when theme store is wired.
 */

import type { ITerminalOptions } from "@xterm/xterm";
import { DEFAULT_TERMINAL_SCROLLBACK } from "shared/constants";

// System emoji fonts used as fallbacks so emoji glyphs render correctly
// in monospace terminal fonts that lack emoji coverage.
export const EMOJI_FONT_FAMILIES = [
	"Apple Color Emoji",
	"Segoe UI Emoji",
	"Noto Color Emoji",
];

// Nerd Fonts first for shell theme compatibility (Oh My Posh, Powerlevel10k, etc.)
export const DEFAULT_TERMINAL_FONT_FAMILY = [
	"MesloLGM Nerd Font",
	"MesloLGM NF",
	"MesloLGS NF",
	"MesloLGS Nerd Font",
	"Hack Nerd Font",
	"FiraCode Nerd Font",
	"JetBrainsMono Nerd Font",
	"CaskaydiaCove Nerd Font",
	"Menlo",
	"Monaco",
	'"Courier New"',
	"monospace",
	...EMOJI_FONT_FAMILIES,
].join(", ");

/**
 * Ensures emoji font families are present as fallbacks in a font family string.
 * Used when applying user-provided custom font settings to guarantee emoji rendering.
 */
export function withEmojiFontFallback(fontFamily: string): string {
	const lower = fontFamily.toLowerCase();
	const missing = EMOJI_FONT_FAMILIES.filter(
		(f) => !lower.includes(f.toLowerCase()),
	);
	if (missing.length === 0) return fontFamily;
	return `${fontFamily}, ${missing.join(", ")}`;
}

export const DEFAULT_TERMINAL_FONT_SIZE = 14;

export const TERMINAL_OPTIONS: ITerminalOptions = {
	cursorBlink: true,
	fontSize: DEFAULT_TERMINAL_FONT_SIZE,
	fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
	theme: undefined,
	allowProposedApi: true,
	scrollback: DEFAULT_TERMINAL_SCROLLBACK,
	// Allow Option+key to type special characters on international keyboards
	macOptionIsMeta: false,
	cursorStyle: "block",
	cursorInactiveStyle: "outline",
	screenReaderMode: false,
	// Hide built-in scrollbar so terminal content uses full pane width
	scrollbar: {
		showScrollbar: false,
	},
};

export const RESIZE_DEBOUNCE_MS = 150;
