/**
 * Tests for the terminal IPC event bridge.
 *
 * Verifies that daemon events are correctly forwarded to the renderer
 * via webContents.send().
 */

import { describe, expect, it, mock } from "bun:test";
import { createTerminalIpcBridge, TERMINAL_IPC } from "../ipc-bridge";

function createMockWindow() {
	return {
		webContents: {
			send: mock(() => {}),
		},
	};
}

describe("createTerminalIpcBridge", () => {
	it("sends terminal:data to webContents", () => {
		const win = createMockWindow();
		const bridge = createTerminalIpcBridge(
			() => win as unknown as Electron.BrowserWindow,
		);

		bridge.onData("session-1", "hello world");

		expect(win.webContents.send).toHaveBeenCalledWith(TERMINAL_IPC.DATA, {
			sessionId: "session-1",
			data: "hello world",
		});
	});

	it("sends terminal:exit to webContents", () => {
		const win = createMockWindow();
		const bridge = createTerminalIpcBridge(
			() => win as unknown as Electron.BrowserWindow,
		);

		bridge.onExit("session-2", 0, 15);

		expect(win.webContents.send).toHaveBeenCalledWith(TERMINAL_IPC.EXIT, {
			sessionId: "session-2",
			exitCode: 0,
			signal: 15,
		});
	});

	it("sends terminal:error to webContents", () => {
		const win = createMockWindow();
		const bridge = createTerminalIpcBridge(
			() => win as unknown as Electron.BrowserWindow,
		);

		bridge.onError("session-3", "spawn failed");

		expect(win.webContents.send).toHaveBeenCalledWith(TERMINAL_IPC.ERROR, {
			sessionId: "session-3",
			error: "spawn failed",
		});
	});

	it("no-ops when window is null", () => {
		const bridge = createTerminalIpcBridge(() => null);

		// Should not throw
		bridge.onData("session-4", "data");
		bridge.onExit("session-4", 1);
		bridge.onError("session-4", "err");
	});

	it("sends exit without signal when not provided", () => {
		const win = createMockWindow();
		const bridge = createTerminalIpcBridge(
			() => win as unknown as Electron.BrowserWindow,
		);

		bridge.onExit("session-5", 1);

		expect(win.webContents.send).toHaveBeenCalledWith(TERMINAL_IPC.EXIT, {
			sessionId: "session-5",
			exitCode: 1,
			signal: undefined,
		});
	});
});

describe("TERMINAL_IPC constants", () => {
	it("has the expected channel names", () => {
		expect(TERMINAL_IPC.DATA).toBe("terminal:data");
		expect(TERMINAL_IPC.EXIT).toBe("terminal:exit");
		expect(TERMINAL_IPC.ERROR).toBe("terminal:error");
	});
});
