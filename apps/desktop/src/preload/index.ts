import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script — runs in a privileged context with access to Node.js APIs.
 *
 * Exposes safe APIs to the renderer via contextBridge.
 * Phase 3: Minimal — just App info and ipcRenderer.
 * Phase 4+ will add: exposeElectronTRPC() for tRPC IPC.
 */

// Expose app information and IPC to the renderer
contextBridge.exposeInMainWorld("App", {
	ipcRenderer: {
		send: (channel: string, ...args: unknown[]) =>
			ipcRenderer.send(channel, ...args),
		on: (channel: string, listener: (...args: unknown[]) => void) => {
			ipcRenderer.on(channel, (_event, ...args) => listener(...args));
			return () => {
				ipcRenderer.removeListener(channel, listener);
			};
		},
		invoke: (channel: string, ...args: unknown[]) =>
			ipcRenderer.invoke(channel, ...args),
	},
});
