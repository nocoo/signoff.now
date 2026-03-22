/**
 * Terminal component barrel export.
 */

export {
	DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE,
	EMOJI_FONT_FAMILIES,
	RESIZE_DEBOUNCE_MS,
	TERMINAL_OPTIONS,
	withEmojiFontFallback,
} from "./config";
export type {
	ClickToMoveOptions,
	KeyboardHandlerOptions,
	PasteHandlerOptions,
} from "./helpers";
export {
	scrollToBottom,
	setupClickToMoveCursor,
	setupCopyHandler,
	setupFocusListener,
	setupKeyboardHandler,
	setupPasteHandler,
} from "./helpers";
export { TerminalView } from "./Terminal";
export type {
	CreateOrAttachCallbacks,
	CreateOrAttachInput,
	CreateOrAttachMutate,
	CreateOrAttachResult,
	TerminalClearScrollbackInput,
	TerminalClearScrollbackMutate,
	TerminalDetachInput,
	TerminalDetachMutate,
	TerminalExitReason,
	TerminalProps,
	TerminalResizeInput,
	TerminalResizeMutate,
	TerminalStreamEvent,
	TerminalWriteCallbacks,
	TerminalWriteInput,
	TerminalWriteMutate,
} from "./types";
