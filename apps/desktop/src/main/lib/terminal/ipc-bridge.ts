/**
 * Terminal IPC event bridge — main → renderer data channel.
 *
 * Bridges daemon socket events to the renderer via webContents.send().
 * The renderer listens via window.App.ipcRenderer.on() (see preload/index.ts).
 */

import type { BrowserWindow } from "electron";

/** IPC channel names for terminal events. */
export const TERMINAL_IPC = {
	/** PTY output data: main → renderer */
	DATA: "terminal:data",
	/** PTY session exit: main → renderer */
	EXIT: "terminal:exit",
	/** PTY error: main → renderer */
	ERROR: "terminal:error",
} as const;

/**
 * Creates a bridge that forwards terminal daemon events to the renderer.
 *
 * @param getWindow - Returns the main BrowserWindow (null if not yet created)
 */
export function createTerminalIpcBridge(getWindow: () => BrowserWindow | null) {
	return {
		onData(sessionId: string, data: string) {
			getWindow()?.webContents.send(TERMINAL_IPC.DATA, {
				sessionId,
				data,
			});
		},
		onExit(sessionId: string, exitCode: number, signal?: number) {
			getWindow()?.webContents.send(TERMINAL_IPC.EXIT, {
				sessionId,
				exitCode,
				signal,
			});
		},
		onError(sessionId: string, error: string) {
			getWindow()?.webContents.send(TERMINAL_IPC.ERROR, {
				sessionId,
				error,
			});
		},
	};
}
