/**
 * Terminal renderer helpers — pure utility functions for xterm event handling.
 *
 * 🔴 Trimmed from superset: getDefaultTerminalTheme, getDefaultTerminalBg,
 * createTerminalInstance, loadRenderer, getPreferredRenderer, link-providers,
 * suppressQueryResponses, toast, theme store deps. These require the full
 * theme system, link providers, and tRPC client which are Phase 6+ concerns.
 *
 * Kept: setupCopyHandler, setupPasteHandler, setupKeyboardHandler,
 * setupFocusListener, setupClickToMoveCursor, scrollToBottom.
 * These are pure event-handler factories that only depend on xterm types.
 */

import type { Terminal as XTerm } from "@xterm/xterm";

// =============================================================================
// Types
// =============================================================================

export interface KeyboardHandlerOptions {
	/** Callback for Shift+Enter (sends ESC+CR) */
	onShiftEnter?: () => void;
	/** Callback for the configured clear terminal shortcut */
	onClear?: () => void;
	onWrite?: (data: string) => void;
}

export interface PasteHandlerOptions {
	/** Callback when text is pasted */
	onPaste?: (text: string) => void;
	/** Optional direct write callback to bypass xterm's paste burst */
	onWrite?: (data: string) => void;
	/** Whether bracketed paste mode is enabled */
	isBracketedPasteEnabled?: () => boolean;
}

export interface ClickToMoveOptions {
	/** Callback to write data to the terminal PTY */
	onWrite: (data: string) => void;
}

// =============================================================================
// scrollToBottom
// =============================================================================

/**
 * Scroll the terminal to the bottom of the buffer.
 */
export function scrollToBottom(xterm: XTerm): void {
	xterm.scrollToLine(xterm.buffer.active.baseY);
}

// =============================================================================
// setupCopyHandler
// =============================================================================

/**
 * Setup copy handler for xterm to trim trailing whitespace from copied text.
 *
 * Terminal emulators fill lines with whitespace to pad to the terminal width.
 * When copying text, this results in unwanted trailing spaces on each line.
 * This handler intercepts copy events and trims trailing whitespace from each
 * line before writing to the clipboard.
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupCopyHandler(xterm: XTerm): () => void {
	const element = xterm.element;
	if (!element) return () => {};

	const handleCopy = (event: ClipboardEvent) => {
		const selection = xterm.getSelection();
		if (!selection) return;

		// Trim trailing whitespace from each line while preserving intentional newlines
		const trimmedText = selection
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n");

		// On Linux/Wayland in Electron, clipboardData can be null for copy events.
		// Only cancel default behavior when we can write directly to event clipboardData.
		if (event.clipboardData) {
			event.preventDefault();
			event.clipboardData.setData("text/plain", trimmedText);
			return;
		}

		// Fallback path when clipboardData is unavailable.
		void navigator.clipboard?.writeText(trimmedText).catch(() => {});
	};

	element.addEventListener("copy", handleCopy);

	return () => {
		element.removeEventListener("copy", handleCopy);
	};
}

// =============================================================================
// setupPasteHandler
// =============================================================================

/**
 * Setup paste handler for xterm with bracketed paste mode support.
 *
 * Handles:
 * - Image/non-text clipboard payloads → forwards Ctrl+V
 * - Small pastes → direct xterm.paste() or onWrite()
 * - Large pastes → chunked to avoid overwhelming PTY pipeline
 * - Bracketed paste mode → wraps with \x1b[200~ / \x1b[201~
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupPasteHandler(
	xterm: XTerm,
	options: PasteHandlerOptions = {},
): () => void {
	const textarea = xterm.textarea;
	if (!textarea) return () => {};

	let cancelActivePaste: (() => void) | null = null;

	const shouldForwardCtrlVForNonTextPaste = (
		event: ClipboardEvent,
		text: string,
	): boolean => {
		if (text) return false;
		const types = Array.from(event.clipboardData?.types ?? []);
		if (types.length === 0) return false;
		return types.some((type) => type !== "text/plain");
	};

	const handlePaste = (event: ClipboardEvent) => {
		const text = event.clipboardData?.getData("text/plain") ?? "";
		if (!text) {
			// Match terminal behavior like iTerm's "Paste or send ^V":
			// when clipboard has non-text payloads but no plain text, forward Ctrl+V.
			if (options.onWrite && shouldForwardCtrlVForNonTextPaste(event, text)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				options.onWrite("\x16");
			}
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();

		options.onPaste?.(text);

		// Cancel any in-flight chunked paste to avoid overlapping writes.
		cancelActivePaste?.();
		cancelActivePaste = null;

		const MAX_SYNC_PASTE_CHARS = 16_384;

		// If no direct write callback, fall back to xterm's paste()
		if (!options.onWrite) {
			const CHUNK_CHARS = 4096;
			const CHUNK_DELAY_MS = 5;

			if (text.length <= MAX_SYNC_PASTE_CHARS) {
				xterm.paste(text);
				return;
			}

			let cancelled = false;
			let offset = 0;

			const pasteNext = () => {
				if (cancelled) return;
				const chunk = text.slice(offset, offset + CHUNK_CHARS);
				offset += CHUNK_CHARS;
				xterm.paste(chunk);
				if (offset < text.length) {
					setTimeout(pasteNext, CHUNK_DELAY_MS);
				}
			};

			cancelActivePaste = () => {
				cancelled = true;
			};

			pasteNext();
			return;
		}

		// Direct write path: replicate xterm's paste normalization
		const preparedText = text.replace(/\r?\n/g, "\r");
		const bracketedPasteEnabled = options.isBracketedPasteEnabled?.() ?? false;

		if (preparedText.length <= MAX_SYNC_PASTE_CHARS) {
			options.onWrite(
				bracketedPasteEnabled
					? `\x1b[200~${preparedText}\x1b[201~`
					: preparedText,
			);
			return;
		}

		// Large paste: chunked writes
		let cancelled = false;
		let offset = 0;
		const CHUNK_CHARS = 16_384;
		const CHUNK_DELAY_MS = 0;

		const pasteNext = () => {
			if (cancelled) return;
			const chunk = preparedText.slice(offset, offset + CHUNK_CHARS);
			offset += CHUNK_CHARS;

			if (bracketedPasteEnabled) {
				options.onWrite?.(`\x1b[200~${chunk}\x1b[201~`);
			} else {
				options.onWrite?.(chunk);
			}

			if (offset < preparedText.length) {
				setTimeout(pasteNext, CHUNK_DELAY_MS);
			}
		};

		cancelActivePaste = () => {
			cancelled = true;
		};

		pasteNext();
	};

	textarea.addEventListener("paste", handlePaste, { capture: true });

	return () => {
		cancelActivePaste?.();
		cancelActivePaste = null;
		textarea.removeEventListener("paste", handlePaste, { capture: true });
	};
}

// =============================================================================
// setupKeyboardHandler
// =============================================================================

/**
 * Setup keyboard handling for xterm including:
 * - Shift+Enter: Sends ESC+CR sequence
 * - Cmd+Backspace: Sends Ctrl+U + left arrow (clear line)
 * - Cmd+Left/Right: Sends Ctrl+A/E (beginning/end of line)
 * - Option+Left/Right (macOS) / Ctrl+Left/Right (Win): word navigation
 *
 * 🔴 Trimmed: App hotkey forwarding, clear terminal shortcut (require hotkey store).
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupKeyboardHandler(
	xterm: XTerm,
	options: KeyboardHandlerOptions = {},
): () => void {
	const platform =
		typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
	const isMac = platform.includes("mac");
	const isWindows = platform.includes("win");

	const handler = (event: KeyboardEvent): boolean => {
		const isShiftEnter =
			event.key === "Enter" &&
			event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey;

		if (isShiftEnter) {
			if (event.type === "keydown" && options.onShiftEnter) {
				event.preventDefault();
				options.onShiftEnter();
			}
			return false;
		}

		const isCmdBackspace =
			event.key === "Backspace" &&
			event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey;

		if (isCmdBackspace) {
			if (event.type === "keydown" && options.onWrite) {
				event.preventDefault();
				options.onWrite("\x15\x1b[D"); // Ctrl+U + left arrow
			}
			return false;
		}

		// Cmd+Left: beginning of line (Ctrl+A)
		const isCmdLeft =
			event.key === "ArrowLeft" &&
			event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey;

		if (isCmdLeft) {
			if (event.type === "keydown" && options.onWrite) {
				event.preventDefault();
				options.onWrite("\x01");
			}
			return false;
		}

		// Cmd+Right: end of line (Ctrl+E)
		const isCmdRight =
			event.key === "ArrowRight" &&
			event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey;

		if (isCmdRight) {
			if (event.type === "keydown" && options.onWrite) {
				event.preventDefault();
				options.onWrite("\x05");
			}
			return false;
		}

		// Option+Left (macOS): backward word (Meta+B)
		const isOptionLeft =
			event.key === "ArrowLeft" &&
			event.altKey &&
			isMac &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey;

		if (isOptionLeft) {
			if (event.type === "keydown" && options.onWrite) {
				options.onWrite("\x1bb");
			}
			return false;
		}

		// Option+Right (macOS): forward word (Meta+F)
		const isOptionRight =
			event.key === "ArrowRight" &&
			event.altKey &&
			isMac &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey;

		if (isOptionRight) {
			if (event.type === "keydown" && options.onWrite) {
				options.onWrite("\x1bf");
			}
			return false;
		}

		// Ctrl+Left (Windows): backward word (Meta+B)
		const isCtrlLeft =
			event.key === "ArrowLeft" &&
			event.ctrlKey &&
			isWindows &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey;

		if (isCtrlLeft) {
			if (event.type === "keydown" && options.onWrite) {
				options.onWrite("\x1bb");
			}
			return false;
		}

		// Ctrl+Right (Windows): forward word (Meta+F)
		const isCtrlRight =
			event.key === "ArrowRight" &&
			event.ctrlKey &&
			isWindows &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey;

		if (isCtrlRight) {
			if (event.type === "keydown" && options.onWrite) {
				options.onWrite("\x1bf");
			}
			return false;
		}

		return true;
	};

	xterm.attachCustomKeyEventHandler(handler);

	return () => {
		xterm.attachCustomKeyEventHandler(() => true);
	};
}

// =============================================================================
// setupFocusListener
// =============================================================================

/**
 * Setup a focus listener on the terminal's internal textarea.
 * Returns a cleanup function, or null if textarea is not available.
 */
export function setupFocusListener(
	xterm: XTerm,
	onFocus: () => void,
): (() => void) | null {
	const textarea = xterm.textarea;
	if (!textarea) return null;

	textarea.addEventListener("focus", onFocus);

	return () => {
		textarea.removeEventListener("focus", onFocus);
	};
}

// =============================================================================
// setupClickToMoveCursor
// =============================================================================

/**
 * Convert mouse event coordinates to terminal cell coordinates.
 * Returns null if coordinates cannot be determined.
 */
function getTerminalCoordsFromEvent(
	xterm: XTerm,
	event: MouseEvent,
): { col: number; row: number } | null {
	const element = xterm.element;
	if (!element) return null;

	const rect = element.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;

	// Note: xterm.js does not expose a public API for mouse-to-coords conversion.
	// We access internal _core._renderService.dimensions (fragile, may break).
	const dimensions = (
		xterm as unknown as {
			_core?: {
				_renderService?: {
					dimensions?: { css: { cell: { width: number; height: number } } };
				};
			};
		}
	)._core?._renderService?.dimensions;
	if (!dimensions?.css?.cell) return null;

	const cellWidth = dimensions.css.cell.width;
	const cellHeight = dimensions.css.cell.height;

	if (cellWidth <= 0 || cellHeight <= 0) return null;

	const col = Math.max(0, Math.min(xterm.cols - 1, Math.floor(x / cellWidth)));
	const row = Math.max(0, Math.min(xterm.rows - 1, Math.floor(y / cellHeight)));

	return { col, row };
}

/**
 * Setup click-to-move cursor functionality.
 * Clicking on the current prompt line moves the cursor to that position
 * by sending the appropriate number of arrow key sequences.
 *
 * Limitations:
 * - Only works on the current line (same row as cursor)
 * - Only works at the shell prompt (not in full-screen apps)
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupClickToMoveCursor(
	xterm: XTerm,
	options: ClickToMoveOptions,
): () => void {
	const handleClick = (event: MouseEvent) => {
		// Don't interfere with full-screen apps (they use alternate buffer)
		if (xterm.buffer.active !== xterm.buffer.normal) return;
		if (event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
			return;
		if (xterm.hasSelection()) return;

		const coords = getTerminalCoordsFromEvent(xterm, event);
		if (!coords) return;

		const buffer = xterm.buffer.active;
		const clickBufferRow = coords.row + buffer.viewportY;

		// Only move cursor on the same line (editable prompt area)
		if (clickBufferRow !== buffer.cursorY + buffer.viewportY) return;

		const delta = coords.col - buffer.cursorX;
		if (delta === 0) return;

		// Right arrow: \x1b[C, Left arrow: \x1b[D
		const arrowKey = delta > 0 ? "\x1b[C" : "\x1b[D";
		options.onWrite(arrowKey.repeat(Math.abs(delta)));
	};

	xterm.element?.addEventListener("click", handleClick);

	return () => {
		xterm.element?.removeEventListener("click", handleClick);
	};
}
