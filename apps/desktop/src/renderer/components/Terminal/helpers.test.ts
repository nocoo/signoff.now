/**
 * Terminal renderer helpers tests — Phase 5 Commit #11.
 *
 * TDD: tests written before implementation.
 * Tests cover:
 * - Terminal config (options, font, scrollback, emoji fallback)
 * - Copy handler (trailing whitespace trimming, clipboardData path, fallback)
 * - Paste handler (Ctrl+V for non-text, bracketed paste, chunking)
 * - Keyboard handler (word navigation, Shift+Enter, Cmd+Backspace, Cmd+Left/Right)
 * - Click-to-move cursor
 * - Focus listener
 * - Resize handler setup/cleanup
 * - scrollToBottom utility
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";

// ─── Terminal Config ────────────────────────────────────────────────────────

describe("Terminal/config", () => {
	test("TERMINAL_OPTIONS has expected shape", async () => {
		const { TERMINAL_OPTIONS } = await import("./config");
		expect(TERMINAL_OPTIONS.cursorBlink).toBe(true);
		expect(TERMINAL_OPTIONS.fontSize).toBe(14);
		expect(TERMINAL_OPTIONS.cursorStyle).toBe("block");
		expect(TERMINAL_OPTIONS.allowProposedApi).toBe(true);
		expect(typeof TERMINAL_OPTIONS.fontFamily).toBe("string");
	});

	test("TERMINAL_OPTIONS.scrollback uses DEFAULT_TERMINAL_SCROLLBACK", async () => {
		const { TERMINAL_OPTIONS } = await import("./config");
		const { DEFAULT_TERMINAL_SCROLLBACK } = await import("shared/constants");
		expect(TERMINAL_OPTIONS.scrollback).toBe(DEFAULT_TERMINAL_SCROLLBACK);
	});

	test("DEFAULT_TERMINAL_FONT_FAMILY includes monospace fallback", async () => {
		const { DEFAULT_TERMINAL_FONT_FAMILY } = await import("./config");
		expect(DEFAULT_TERMINAL_FONT_FAMILY).toContain("monospace");
	});

	test("DEFAULT_TERMINAL_FONT_FAMILY includes emoji fonts", async () => {
		const { DEFAULT_TERMINAL_FONT_FAMILY } = await import("./config");
		expect(DEFAULT_TERMINAL_FONT_FAMILY).toContain("Apple Color Emoji");
		expect(DEFAULT_TERMINAL_FONT_FAMILY).toContain("Noto Color Emoji");
	});

	test("EMOJI_FONT_FAMILIES is a non-empty array", async () => {
		const { EMOJI_FONT_FAMILIES } = await import("./config");
		expect(Array.isArray(EMOJI_FONT_FAMILIES)).toBe(true);
		expect(EMOJI_FONT_FAMILIES.length).toBeGreaterThan(0);
	});

	test("withEmojiFontFallback appends missing emoji fonts", async () => {
		const { withEmojiFontFallback } = await import("./config");
		const result = withEmojiFontFallback("Menlo, monospace");
		expect(result).toContain("Apple Color Emoji");
		expect(result).toContain("Noto Color Emoji");
	});

	test("withEmojiFontFallback does not duplicate existing emoji fonts", async () => {
		const { withEmojiFontFallback, EMOJI_FONT_FAMILIES } = await import(
			"./config"
		);
		const input = `Menlo, ${EMOJI_FONT_FAMILIES.join(", ")}`;
		const result = withEmojiFontFallback(input);
		expect(result).toBe(input);
	});

	test("RESIZE_DEBOUNCE_MS is a positive number", async () => {
		const { RESIZE_DEBOUNCE_MS } = await import("./config");
		expect(typeof RESIZE_DEBOUNCE_MS).toBe("number");
		expect(RESIZE_DEBOUNCE_MS).toBeGreaterThan(0);
	});

	test("DEFAULT_TERMINAL_FONT_SIZE is 14", async () => {
		const { DEFAULT_TERMINAL_FONT_SIZE } = await import("./config");
		expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(14);
	});
});

// ─── setupCopyHandler ───────────────────────────────────────────────────────

describe("Terminal/helpers setupCopyHandler", () => {
	const originalNavigator = globalThis.navigator;

	afterEach(() => {
		globalThis.navigator = originalNavigator;
	});

	function createXtermStub(selection: string) {
		const listeners = new Map<string, EventListener>();
		const element = {
			addEventListener: mock((eventName: string, listener: EventListener) => {
				listeners.set(eventName, listener);
			}),
			removeEventListener: mock((eventName: string) => {
				listeners.delete(eventName);
			}),
		} as unknown as HTMLElement;
		const xterm = {
			element,
			getSelection: mock(() => selection),
		} as unknown as XTerm;
		return { xterm, listeners };
	}

	test("trims trailing whitespace and writes to clipboardData", async () => {
		const { setupCopyHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		setupCopyHandler(xterm);

		const preventDefault = mock(() => {});
		const setData = mock(() => {});
		const copyEvent = {
			preventDefault,
			clipboardData: { setData },
		} as unknown as ClipboardEvent;

		const copyListener = listeners.get("copy");
		expect(copyListener).toBeDefined();
		copyListener?.(copyEvent);

		expect(preventDefault).toHaveBeenCalled();
		expect(setData).toHaveBeenCalledWith("text/plain", "foo\nbar");
	});

	test("prefers clipboardData over navigator.clipboard", async () => {
		const { setupCopyHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		const writeText = mock(() => Promise.resolve());

		// @ts-expect-error - mocking navigator
		globalThis.navigator = { clipboard: { writeText } };

		setupCopyHandler(xterm);

		const preventDefault = mock(() => {});
		const setData = mock(() => {});
		const copyEvent = {
			preventDefault,
			clipboardData: { setData },
		} as unknown as ClipboardEvent;

		listeners.get("copy")?.(copyEvent);

		expect(preventDefault).toHaveBeenCalled();
		expect(setData).toHaveBeenCalledWith("text/plain", "foo\nbar");
		expect(writeText).not.toHaveBeenCalled();
	});

	test("falls back to navigator.clipboard when clipboardData missing", async () => {
		const { setupCopyHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		const writeText = mock(() => Promise.resolve());

		// @ts-expect-error - mocking navigator
		globalThis.navigator = { clipboard: { writeText } };

		setupCopyHandler(xterm);

		const copyEvent = {
			preventDefault: mock(() => {}),
			clipboardData: null,
		} as unknown as ClipboardEvent;

		listeners.get("copy")?.(copyEvent);
		expect(writeText).toHaveBeenCalledWith("foo\nbar");
	});

	test("does not throw when both clipboardData and navigator.clipboard missing", async () => {
		const { setupCopyHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");

		// @ts-expect-error - mocking navigator
		globalThis.navigator = {};

		setupCopyHandler(xterm);

		const copyEvent = {
			preventDefault: mock(() => {}),
			clipboardData: null,
		} as unknown as ClipboardEvent;

		expect(() => listeners.get("copy")?.(copyEvent)).not.toThrow();
	});

	test("cleanup removes event listener", async () => {
		const { setupCopyHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub("test");
		const cleanup = setupCopyHandler(xterm);

		expect(listeners.has("copy")).toBe(true);
		cleanup();
		// After cleanup, removeEventListener should have been called
		expect(
			(
				xterm.element as unknown as {
					removeEventListener: { mock: { calls: unknown[] } };
				}
			).removeEventListener.mock.calls.length,
		).toBeGreaterThan(0);
	});
});

// ─── setupPasteHandler ──────────────────────────────────────────────────────

describe("Terminal/helpers setupPasteHandler", () => {
	function createXtermStub() {
		const listeners = new Map<string, EventListener>();
		const textarea = {
			addEventListener: mock((eventName: string, listener: EventListener) => {
				listeners.set(eventName, listener);
			}),
			removeEventListener: mock((eventName: string) => {
				listeners.delete(eventName);
			}),
		} as unknown as HTMLTextAreaElement;
		const paste = mock(() => {});
		const xterm = {
			textarea,
			paste,
		} as unknown as XTerm;
		return { xterm, listeners, paste };
	}

	test("forwards Ctrl+V for image-only clipboard payloads", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const preventDefault = mock(() => {});
		const stopImmediatePropagation = mock(() => {});
		const pasteEvent = {
			clipboardData: {
				getData: mock(() => ""),
				types: ["Files", "image/png"],
			},
			preventDefault,
			stopImmediatePropagation,
		} as unknown as ClipboardEvent;

		listeners.get("paste")?.(pasteEvent);

		expect(onWrite).toHaveBeenCalledWith("\x16");
		expect(preventDefault).toHaveBeenCalled();
	});

	test("ignores empty clipboard payloads", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const preventDefault = mock(() => {});
		const pasteEvent = {
			clipboardData: {
				getData: mock(() => ""),
				types: [],
			},
			preventDefault,
			stopImmediatePropagation: mock(() => {}),
		} as unknown as ClipboardEvent;

		listeners.get("paste")?.(pasteEvent);

		expect(onWrite).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
	});

	test("small paste uses xterm.paste when no onWrite", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm, listeners, paste } = createXtermStub();
		setupPasteHandler(xterm, {});

		const pasteEvent = {
			clipboardData: {
				getData: mock(() => "hello world"),
				types: ["text/plain"],
			},
			preventDefault: mock(() => {}),
			stopImmediatePropagation: mock(() => {}),
		} as unknown as ClipboardEvent;

		listeners.get("paste")?.(pasteEvent);

		expect(paste).toHaveBeenCalledWith("hello world");
	});

	test("small paste with onWrite sends directly with newline normalization", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const pasteEvent = {
			clipboardData: {
				getData: mock(() => "line1\nline2"),
				types: ["text/plain"],
			},
			preventDefault: mock(() => {}),
			stopImmediatePropagation: mock(() => {}),
		} as unknown as ClipboardEvent;

		listeners.get("paste")?.(pasteEvent);

		// Should normalize \n to \r
		expect(onWrite).toHaveBeenCalledWith("line1\rline2");
	});

	test("bracketed paste wraps content with escape sequences", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, {
			onWrite,
			isBracketedPasteEnabled: () => true,
		});

		const pasteEvent = {
			clipboardData: {
				getData: mock(() => "pasted"),
				types: ["text/plain"],
			},
			preventDefault: mock(() => {}),
			stopImmediatePropagation: mock(() => {}),
		} as unknown as ClipboardEvent;

		listeners.get("paste")?.(pasteEvent);

		expect(onWrite).toHaveBeenCalledWith("\x1b[200~pasted\x1b[201~");
	});

	test("cleanup removes event listener", async () => {
		const { setupPasteHandler } = await import("./helpers");
		const { xterm } = createXtermStub();
		const cleanup = setupPasteHandler(xterm, {});

		cleanup();
		expect(
			(
				xterm.textarea as unknown as {
					removeEventListener: { mock: { calls: unknown[] } };
				}
			).removeEventListener.mock.calls.length,
		).toBeGreaterThan(0);
	});
});

// ─── setupKeyboardHandler ───────────────────────────────────────────────────

describe("Terminal/helpers setupKeyboardHandler", () => {
	const originalNavigator = globalThis.navigator;

	afterEach(() => {
		globalThis.navigator = originalNavigator;
	});

	function captureHandler() {
		const captured: { handler: ((event: KeyboardEvent) => boolean) | null } = {
			handler: null,
		};
		const xterm = {
			attachCustomKeyEventHandler: (
				next: (event: KeyboardEvent) => boolean,
			) => {
				captured.handler = next;
			},
		} as unknown as XTerm;
		return { xterm, captured };
	}

	test("maps Option+Left/Right to Meta+B/F on macOS", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		// @ts-expect-error - mocking navigator
		globalThis.navigator = { platform: "MacIntel" };

		const { xterm, captured } = captureHandler();
		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowLeft",
			altKey: true,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
		} as KeyboardEvent);

		captured.handler?.({
			type: "keydown",
			key: "ArrowRight",
			altKey: true,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
		} as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x1bb");
		expect(onWrite).toHaveBeenCalledWith("\x1bf");
	});

	test("maps Ctrl+Left/Right to Meta+B/F on Windows", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		// @ts-expect-error - mocking navigator
		globalThis.navigator = { platform: "Win32" };

		const { xterm, captured } = captureHandler();
		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowLeft",
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
		} as KeyboardEvent);

		captured.handler?.({
			type: "keydown",
			key: "ArrowRight",
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
		} as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x1bb");
		expect(onWrite).toHaveBeenCalledWith("\x1bf");
	});

	test("Shift+Enter calls onShiftEnter", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		const { xterm, captured } = captureHandler();
		const onShiftEnter = mock(() => {});
		setupKeyboardHandler(xterm, { onShiftEnter });

		const result = captured.handler?.({
			type: "keydown",
			key: "Enter",
			shiftKey: true,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			preventDefault: mock(() => {}),
		} as unknown as KeyboardEvent);

		expect(onShiftEnter).toHaveBeenCalled();
		expect(result).toBe(false);
	});

	test("Cmd+Backspace sends Ctrl+U + left arrow", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		// @ts-expect-error - mocking navigator
		globalThis.navigator = { platform: "MacIntel" };

		const { xterm, captured } = captureHandler();
		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm, { onWrite });

		const result = captured.handler?.({
			type: "keydown",
			key: "Backspace",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: mock(() => {}),
		} as unknown as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x15\x1b[D");
		expect(result).toBe(false);
	});

	test("Cmd+Left sends Ctrl+A (beginning of line)", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		// @ts-expect-error - mocking navigator
		globalThis.navigator = { platform: "MacIntel" };

		const { xterm, captured } = captureHandler();
		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowLeft",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: mock(() => {}),
		} as unknown as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x01");
	});

	test("Cmd+Right sends Ctrl+E (end of line)", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		// @ts-expect-error - mocking navigator
		globalThis.navigator = { platform: "MacIntel" };

		const { xterm, captured } = captureHandler();
		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowRight",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: mock(() => {}),
		} as unknown as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x05");
	});

	test("cleanup restores default key handler", async () => {
		const { setupKeyboardHandler } = await import("./helpers");
		const handlers: Array<(event: KeyboardEvent) => boolean> = [];
		const xterm = {
			attachCustomKeyEventHandler: (
				next: (event: KeyboardEvent) => boolean,
			) => {
				handlers.push(next);
			},
		} as unknown as XTerm;

		const cleanup = setupKeyboardHandler(xterm, {});
		cleanup();

		// After cleanup, the last attached handler should pass-through all events
		const lastHandler = handlers[handlers.length - 1];
		expect(lastHandler).toBeDefined();
		const result = lastHandler({
			type: "keydown",
			key: "a",
		} as KeyboardEvent);
		expect(result).toBe(true);
	});
});

// ─── setupClickToMoveCursor ─────────────────────────────────────────────────

describe("Terminal/helpers setupClickToMoveCursor", () => {
	test("sends right arrow keys for positive column delta", async () => {
		const { setupClickToMoveCursor } = await import("./helpers");
		const listeners = new Map<string, EventListener>();
		const element = {
			addEventListener: mock((name: string, fn: EventListener) => {
				listeners.set(name, fn);
			}),
			removeEventListener: mock(() => {}),
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				right: 800,
				bottom: 400,
			}),
		};

		const xterm = {
			element,
			buffer: {
				active: {
					viewportY: 0,
					baseY: 0,
					cursorX: 5,
					cursorY: 0,
				},
				normal: {},
			},
			cols: 80,
			rows: 24,
			hasSelection: () => false,
			_core: {
				_renderService: {
					dimensions: {
						css: { cell: { width: 10, height: 20 } },
					},
				},
			},
		};
		// Make active === normal so we're in normal buffer
		xterm.buffer.active = { ...xterm.buffer.active };
		xterm.buffer.normal = xterm.buffer.active;

		const onWrite = mock(() => {});
		setupClickToMoveCursor(xterm as unknown as XTerm, { onWrite });

		// Click at column 8 (x=85, which is col 8 at cellWidth=10)
		listeners.get("click")?.({
			button: 0,
			clientX: 85,
			clientY: 5,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
		} as unknown as MouseEvent);

		// Delta = 8 - 5 = 3, should send 3 right arrows
		expect(onWrite).toHaveBeenCalledWith("\x1b[C\x1b[C\x1b[C");
	});

	test("sends left arrow keys for negative column delta", async () => {
		const { setupClickToMoveCursor } = await import("./helpers");
		const listeners = new Map<string, EventListener>();
		const element = {
			addEventListener: mock((name: string, fn: EventListener) => {
				listeners.set(name, fn);
			}),
			removeEventListener: mock(() => {}),
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				right: 800,
				bottom: 400,
			}),
		};

		const xterm = {
			element,
			buffer: {
				active: {
					viewportY: 0,
					baseY: 0,
					cursorX: 10,
					cursorY: 0,
				},
				normal: {},
			},
			cols: 80,
			rows: 24,
			hasSelection: () => false,
			_core: {
				_renderService: {
					dimensions: {
						css: { cell: { width: 10, height: 20 } },
					},
				},
			},
		};
		xterm.buffer.active = { ...xterm.buffer.active };
		xterm.buffer.normal = xterm.buffer.active;

		const onWrite = mock(() => {});
		setupClickToMoveCursor(xterm as unknown as XTerm, { onWrite });

		// Click at column 7 (x=75, col 7 at cellWidth=10)
		listeners.get("click")?.({
			button: 0,
			clientX: 75,
			clientY: 5,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
		} as unknown as MouseEvent);

		// Delta = 7 - 10 = -3, should send 3 left arrows
		expect(onWrite).toHaveBeenCalledWith("\x1b[D\x1b[D\x1b[D");
	});

	test("does nothing in alternate buffer", async () => {
		const { setupClickToMoveCursor } = await import("./helpers");
		const listeners = new Map<string, EventListener>();
		const element = {
			addEventListener: mock((name: string, fn: EventListener) => {
				listeners.set(name, fn);
			}),
			removeEventListener: mock(() => {}),
		};

		const normalBuffer = { viewportY: 0, cursorX: 5, cursorY: 0 };
		const alternateBuffer = { viewportY: 0, cursorX: 5, cursorY: 0 };

		const xterm = {
			element,
			buffer: {
				active: alternateBuffer,
				normal: normalBuffer,
			},
			cols: 80,
			rows: 24,
			hasSelection: () => false,
		};

		const onWrite = mock(() => {});
		setupClickToMoveCursor(xterm as unknown as XTerm, { onWrite });

		listeners.get("click")?.({
			button: 0,
			clientX: 100,
			clientY: 5,
		} as unknown as MouseEvent);

		expect(onWrite).not.toHaveBeenCalled();
	});

	test("cleanup removes click listener", async () => {
		const { setupClickToMoveCursor } = await import("./helpers");
		const removeEventListener = mock(() => {});
		const element = {
			addEventListener: mock(() => {}),
			removeEventListener,
		};

		const xterm = {
			element,
			buffer: { active: {}, normal: {} },
		} as unknown as XTerm;

		const cleanup = setupClickToMoveCursor(xterm, {
			onWrite: () => {},
		});
		cleanup();

		expect(removeEventListener).toHaveBeenCalled();
	});
});

// ─── setupFocusListener ─────────────────────────────────────────────────────

describe("Terminal/helpers setupFocusListener", () => {
	test("calls onFocus when textarea receives focus", async () => {
		const { setupFocusListener } = await import("./helpers");
		const listeners = new Map<string, EventListener>();
		const textarea = {
			addEventListener: mock((name: string, fn: EventListener) => {
				listeners.set(name, fn);
			}),
			removeEventListener: mock(() => {}),
		};

		const xterm = { textarea } as unknown as XTerm;
		const onFocus = mock(() => {});

		setupFocusListener(xterm, onFocus);

		listeners.get("focus")?.({} as Event);
		expect(onFocus).toHaveBeenCalled();
	});

	test("returns null when textarea is not available", async () => {
		const { setupFocusListener } = await import("./helpers");
		const xterm = { textarea: null } as unknown as XTerm;
		const result = setupFocusListener(xterm, () => {});
		expect(result).toBeNull();
	});

	test("cleanup removes focus listener", async () => {
		const { setupFocusListener } = await import("./helpers");
		const removeEventListener = mock(() => {});
		const textarea = {
			addEventListener: mock(() => {}),
			removeEventListener,
		};
		const xterm = { textarea } as unknown as XTerm;

		const cleanup = setupFocusListener(xterm, () => {});
		cleanup?.();

		expect(removeEventListener).toHaveBeenCalled();
	});
});

// ─── scrollToBottom ─────────────────────────────────────────────────────────

describe("Terminal/helpers scrollToBottom", () => {
	test("scrolls to end of buffer", async () => {
		const { scrollToBottom } = await import("./helpers");
		const scrollToLine = mock(() => {});
		const xterm = {
			buffer: {
				active: { baseY: 100 },
			},
			scrollToLine,
		} as unknown as XTerm;

		scrollToBottom(xterm);
		expect(scrollToLine).toHaveBeenCalledWith(100);
	});
});

// ─── Renderer types ─────────────────────────────────────────────────────────

describe("Terminal/types", () => {
	test("TerminalStreamEvent type is importable", async () => {
		const mod = await import("./types");
		expect(mod).toBeDefined();
	});
});
