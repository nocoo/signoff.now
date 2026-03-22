import { contextBridge, ipcRenderer } from "electron";
import { exposeElectronTRPC } from "trpc-electron/main";

/**
 * Preload script — runs in a privileged context with access to Node.js APIs.
 *
 * Exposes safe APIs to the renderer via contextBridge:
 * 1. electronTRPC — tRPC IPC channel for type-safe RPC
 * 2. App.ipcRenderer — raw IPC for non-tRPC messages
 */

// Expose tRPC IPC channel to renderer (sets globalThis.electronTRPC)
exposeElectronTRPC();

// Expose app information and IPC to the renderer
contextBridge.exposeInMainWorld("App", {
	ipcRenderer: {
		send: (channel: string, ...args: unknown[]) =>
			ipcRenderer.send(channel, ...args),
		on: (channel: string, listener: (...args: unknown[]) => void) => {
			const wrappedListener = (
				_event: Electron.IpcRendererEvent,
				...args: unknown[]
			) => listener(...args);
			ipcRenderer.on(channel, wrappedListener);
			return () => {
				ipcRenderer.removeListener(channel, wrappedListener);
			};
		},
		invoke: (channel: string, ...args: unknown[]) =>
			ipcRenderer.invoke(channel, ...args),
	},
});
