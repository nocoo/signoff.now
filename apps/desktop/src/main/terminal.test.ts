/**
 * Terminal system tests — Phase 5 Commit #10.
 *
 * Tests the terminal daemon infrastructure:
 * - Binary frame protocol (pty-subprocess-ipc)
 * - IPC protocol types
 * - Terminal session management types
 * - Terminal errors
 * - Transient error window
 * - Signal handlers (structure)
 * - Resolve CWD utility
 * - Terminal lib stubs
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";

// ─── Binary Frame Protocol ───────────────────────────────────────────────────

describe("terminal-host/pty-subprocess-ipc", () => {
	test("PtySubprocessIpcType enum has correct daemon→subprocess values", async () => {
		const { PtySubprocessIpcType } = await import(
			"./terminal-host/pty-subprocess-ipc"
		);
		expect(PtySubprocessIpcType.Spawn).toBe(1);
		expect(PtySubprocessIpcType.Write).toBe(2);
		expect(PtySubprocessIpcType.Resize).toBe(3);
		expect(PtySubprocessIpcType.Kill).toBe(4);
		expect(PtySubprocessIpcType.Dispose).toBe(5);
		expect(PtySubprocessIpcType.Signal).toBe(6);
	});

	test("PtySubprocessIpcType enum has correct subprocess→daemon values", async () => {
		const { PtySubprocessIpcType } = await import(
			"./terminal-host/pty-subprocess-ipc"
		);
		expect(PtySubprocessIpcType.Ready).toBe(101);
		expect(PtySubprocessIpcType.Spawned).toBe(102);
		expect(PtySubprocessIpcType.Data).toBe(103);
		expect(PtySubprocessIpcType.Exit).toBe(104);
		expect(PtySubprocessIpcType.Error).toBe(105);
	});

	test("createFrameHeader produces 5-byte header with correct layout", async () => {
		const { createFrameHeader, PtySubprocessIpcType } = await import(
			"./terminal-host/pty-subprocess-ipc"
		);
		const header = createFrameHeader(PtySubprocessIpcType.Data, 256);
		expect(header.length).toBe(5);
		expect(header.readUInt8(0)).toBe(PtySubprocessIpcType.Data);
		expect(header.readUInt32LE(1)).toBe(256);
	});

	test("createFrameHeader handles zero payload length", async () => {
		const { createFrameHeader, PtySubprocessIpcType } = await import(
			"./terminal-host/pty-subprocess-ipc"
		);
		const header = createFrameHeader(PtySubprocessIpcType.Ready, 0);
		expect(header.readUInt32LE(1)).toBe(0);
	});

	test("PtySubprocessFrameDecoder decodes single complete frame", async () => {
		const {
			PtySubprocessFrameDecoder,
			createFrameHeader,
			PtySubprocessIpcType,
		} = await import("./terminal-host/pty-subprocess-ipc");

		const decoder = new PtySubprocessFrameDecoder();
		const payload = Buffer.from("hello", "utf8");
		const header = createFrameHeader(PtySubprocessIpcType.Data, payload.length);
		const chunk = Buffer.concat([header, payload]);

		const frames = decoder.push(chunk);
		expect(frames).toHaveLength(1);
		expect(frames[0].type).toBe(PtySubprocessIpcType.Data);
		expect(frames[0].payload.toString("utf8")).toBe("hello");
	});

	test("PtySubprocessFrameDecoder decodes zero-payload frame", async () => {
		const {
			PtySubprocessFrameDecoder,
			createFrameHeader,
			PtySubprocessIpcType,
		} = await import("./terminal-host/pty-subprocess-ipc");

		const decoder = new PtySubprocessFrameDecoder();
		const header = createFrameHeader(PtySubprocessIpcType.Ready, 0);

		const frames = decoder.push(header);
		expect(frames).toHaveLength(1);
		expect(frames[0].type).toBe(PtySubprocessIpcType.Ready);
		expect(frames[0].payload.length).toBe(0);
	});

	test("PtySubprocessFrameDecoder handles split across chunks", async () => {
		const {
			PtySubprocessFrameDecoder,
			createFrameHeader,
			PtySubprocessIpcType,
		} = await import("./terminal-host/pty-subprocess-ipc");

		const decoder = new PtySubprocessFrameDecoder();
		const payload = Buffer.from("world", "utf8");
		const header = createFrameHeader(PtySubprocessIpcType.Data, payload.length);
		const full = Buffer.concat([header, payload]);

		// Split at byte 3 (mid-header)
		const chunk1 = full.subarray(0, 3);
		const chunk2 = full.subarray(3);

		const frames1 = decoder.push(chunk1);
		expect(frames1).toHaveLength(0);

		const frames2 = decoder.push(chunk2);
		expect(frames2).toHaveLength(1);
		expect(frames2[0].payload.toString("utf8")).toBe("world");
	});

	test("PtySubprocessFrameDecoder decodes multiple frames in one chunk", async () => {
		const {
			PtySubprocessFrameDecoder,
			createFrameHeader,
			PtySubprocessIpcType,
		} = await import("./terminal-host/pty-subprocess-ipc");

		const decoder = new PtySubprocessFrameDecoder();

		const p1 = Buffer.from("abc", "utf8");
		const h1 = createFrameHeader(PtySubprocessIpcType.Data, p1.length);
		const p2 = Buffer.from("xyz", "utf8");
		const h2 = createFrameHeader(PtySubprocessIpcType.Data, p2.length);
		const chunk = Buffer.concat([h1, p1, h2, p2]);

		const frames = decoder.push(chunk);
		expect(frames).toHaveLength(2);
		expect(frames[0].payload.toString("utf8")).toBe("abc");
		expect(frames[1].payload.toString("utf8")).toBe("xyz");
	});

	test("PtySubprocessFrameDecoder rejects oversized frames (>64MB)", async () => {
		const {
			PtySubprocessFrameDecoder,
			createFrameHeader,
			PtySubprocessIpcType,
		} = await import("./terminal-host/pty-subprocess-ipc");

		const decoder = new PtySubprocessFrameDecoder();
		const header = createFrameHeader(
			PtySubprocessIpcType.Data,
			65 * 1024 * 1024,
		);

		expect(() => decoder.push(header)).toThrow("frame too large");
	});

	test("SHELL_READY_MARKER is a valid OSC 777 sequence", async () => {
		const { SHELL_READY_MARKER } = await import(
			"./terminal-host/pty-subprocess-ipc"
		);
		expect(SHELL_READY_MARKER).toStartWith("\x1b]777;");
		expect(SHELL_READY_MARKER).toEndWith("\x07");
		expect(SHELL_READY_MARKER).toContain("signoff");
	});
});

// ─── Transient Error Window ──────────────────────────────────────────────────

describe("terminal-host/transient-error-window", () => {
	test("recordTransientErrorInWindow adds timestamp and returns count", async () => {
		const { recordTransientErrorInWindow } = await import(
			"./terminal-host/transient-error-window"
		);
		const timestamps: number[] = [];

		const count1 = recordTransientErrorInWindow(timestamps, 1000, 60_000);
		expect(count1).toBe(1);
		expect(timestamps).toHaveLength(1);

		const count2 = recordTransientErrorInWindow(timestamps, 2000, 60_000);
		expect(count2).toBe(2);
		expect(timestamps).toHaveLength(2);
	});

	test("recordTransientErrorInWindow drops timestamps outside window", async () => {
		const { recordTransientErrorInWindow } = await import(
			"./terminal-host/transient-error-window"
		);
		const timestamps: number[] = [];

		recordTransientErrorInWindow(timestamps, 1000, 5000);
		recordTransientErrorInWindow(timestamps, 2000, 5000);
		// Now = 7000, window = 5000 → cutoff = 2000, so t=1000 is dropped
		const count = recordTransientErrorInWindow(timestamps, 7000, 5000);
		expect(count).toBe(2); // t=2000 and t=7000
	});

	test("recordTransientErrorInWindow handles empty array", async () => {
		const { recordTransientErrorInWindow } = await import(
			"./terminal-host/transient-error-window"
		);
		const timestamps: number[] = [];
		const count = recordTransientErrorInWindow(timestamps, 500, 1000);
		expect(count).toBe(1);
	});
});

// ─── Terminal Errors ─────────────────────────────────────────────────────────

describe("main/lib/terminal/errors", () => {
	test("TerminalKilledError has correct name and message", async () => {
		const { TerminalKilledError, TERMINAL_SESSION_KILLED_MESSAGE } =
			await import("./lib/terminal/errors");
		const err = new TerminalKilledError();
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("TerminalKilledError");
		expect(err.message).toBe(TERMINAL_SESSION_KILLED_MESSAGE);
	});

	test("TERMINAL_SESSION_KILLED_MESSAGE is a non-empty string", async () => {
		const { TERMINAL_SESSION_KILLED_MESSAGE } = await import(
			"./lib/terminal/errors"
		);
		expect(typeof TERMINAL_SESSION_KILLED_MESSAGE).toBe("string");
		expect(TERMINAL_SESSION_KILLED_MESSAGE.length).toBeGreaterThan(0);
	});
});

// ─── IPC Protocol Types ──────────────────────────────────────────────────────

describe("main/lib/terminal-host/types", () => {
	test("PROTOCOL_VERSION is a positive integer", async () => {
		const { PROTOCOL_VERSION } = await import("./lib/terminal-host/types");
		expect(typeof PROTOCOL_VERSION).toBe("number");
		expect(PROTOCOL_VERSION).toBeGreaterThan(0);
		expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
	});

	test("DEFAULT_MODES has all 14 mode fields", async () => {
		const { DEFAULT_MODES } = await import("./lib/terminal-host/types");
		const expectedFields = [
			"applicationCursorKeys",
			"bracketedPaste",
			"mouseTrackingX10",
			"mouseTrackingNormal",
			"mouseTrackingHighlight",
			"mouseTrackingButtonEvent",
			"mouseTrackingAnyEvent",
			"focusReporting",
			"mouseUtf8",
			"mouseSgr",
			"alternateScreen",
			"cursorVisible",
			"originMode",
			"autoWrap",
		];
		for (const field of expectedFields) {
			expect(field in DEFAULT_MODES).toBe(true);
		}
		expect(Object.keys(DEFAULT_MODES)).toHaveLength(14);
	});

	test("DEFAULT_MODES cursor visible and auto wrap are true by default", async () => {
		const { DEFAULT_MODES } = await import("./lib/terminal-host/types");
		expect(DEFAULT_MODES.cursorVisible).toBe(true);
		expect(DEFAULT_MODES.autoWrap).toBe(true);
	});

	test("DEFAULT_MODES all other modes are false by default", async () => {
		const { DEFAULT_MODES } = await import("./lib/terminal-host/types");
		expect(DEFAULT_MODES.applicationCursorKeys).toBe(false);
		expect(DEFAULT_MODES.bracketedPaste).toBe(false);
		expect(DEFAULT_MODES.alternateScreen).toBe(false);
		expect(DEFAULT_MODES.focusReporting).toBe(false);
	});
});

// ─── Terminal Lib Stubs ──────────────────────────────────────────────────────

describe("main/lib/terminal", () => {
	test("reconcileDaemonSessions is exported and callable", async () => {
		const { reconcileDaemonSessions } = await import("./lib/terminal");
		expect(typeof reconcileDaemonSessions).toBe("function");
		// Should not throw
		reconcileDaemonSessions();
	});

	test("prewarmTerminalRuntime is exported and callable", async () => {
		const { prewarmTerminalRuntime } = await import("./lib/terminal");
		expect(typeof prewarmTerminalRuntime).toBe("function");
		prewarmTerminalRuntime();
	});

	test("restartDaemon returns success", async () => {
		const { restartDaemon } = await import("./lib/terminal");
		const result = await restartDaemon();
		expect(result).toEqual({ success: true });
	});
});

// ─── Terminal Session Types ──────────────────────────────────────────────────

describe("main/lib/terminal/types", () => {
	test("SessionResult type is importable", async () => {
		const mod = await import("./lib/terminal/types");
		// Types are compile-time only, but the module should resolve
		expect(mod).toBeDefined();
	});
});

// ─── Resolve CWD ─────────────────────────────────────────────────────────────

describe("trpc/routers/terminal/utils/resolve-cwd", () => {
	test("resolveCwd returns worktreePath when no override", async () => {
		const { resolveCwd } = await import(
			"../lib/trpc/routers/terminal/utils/resolve-cwd"
		);
		// Use a directory that always exists
		const result = resolveCwd(undefined, "/tmp");
		expect(result).toBe("/tmp");
	});

	test("resolveCwd returns homedir when nothing provided", async () => {
		const { resolveCwd } = await import(
			"../lib/trpc/routers/terminal/utils/resolve-cwd"
		);
		const result = resolveCwd(undefined, undefined);
		expect(result).toBe(homedir());
	});

	test("resolveCwd uses absolute cwdOverride when it exists", async () => {
		const { resolveCwd } = await import(
			"../lib/trpc/routers/terminal/utils/resolve-cwd"
		);
		const result = resolveCwd("/tmp", "/some/other/path");
		expect(result).toBe("/tmp");
	});

	test("resolveCwd falls back to worktreePath for non-existent absolute override", async () => {
		const { resolveCwd } = await import(
			"../lib/trpc/routers/terminal/utils/resolve-cwd"
		);
		const result = resolveCwd("/nonexistent/path/12345", "/tmp");
		expect(result).toBe("/tmp");
	});

	test("resolveCwd falls back to homedir when both paths are invalid", async () => {
		const { resolveCwd } = await import(
			"../lib/trpc/routers/terminal/utils/resolve-cwd"
		);
		const result = resolveCwd("/nonexistent/abc", "/nonexistent/xyz");
		expect(result).toBe(homedir());
	});
});

// ─── Signal Handlers (module structure) ──────────────────────────────────────

describe("terminal-host/signal-handlers", () => {
	test("setupTerminalHostSignalHandlers is exported and callable", async () => {
		const { setupTerminalHostSignalHandlers } = await import(
			"./terminal-host/signal-handlers"
		);
		expect(typeof setupTerminalHostSignalHandlers).toBe("function");
		// We don't call it in tests because it registers process-level handlers
	});
});
