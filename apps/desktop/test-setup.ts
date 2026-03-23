/**
 * Test setup for @signoff/desktop.
 *
 * Loaded via bunfig.toml [test] preload before every test file.
 * Mocks Electron APIs and browser globals that aren't available in Bun.
 */
import { mock } from "bun:test";

// ─── Mock: electron ──────────────────────────────────────────────────────────
mock.module("electron", () => ({
	app: {
		getPath: (name: string) => `/tmp/signoff-test/${name}`,
		getName: () => "signoff-test",
		getVersion: () => "0.0.0-test",
		setAsDefaultProtocolClient: () => true,
		requestSingleInstanceLock: () => true,
		whenReady: () => Promise.resolve(),
		on: () => {},
		quit: () => {},
		isPackaged: false,
	},
	dialog: {
		showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
		showMessageBox: () => Promise.resolve({ response: 0 }),
	},
	BrowserWindow: class MockBrowserWindow {
		loadURL() {
			return Promise.resolve();
		}
		loadFile() {
			return Promise.resolve();
		}
		on() {
			return this;
		}
		once() {
			return this;
		}
		show() {}
		close() {}
		destroy() {}
		webContents = {
			on: () => {},
			send: () => {},
			openDevTools: () => {},
			setWindowOpenHandler: () => {},
		};
	},
	ipcMain: {
		on: () => {},
		handle: () => {},
		removeHandler: () => {},
	},
	shell: {
		openExternal: () => Promise.resolve(),
	},
	clipboard: {
		writeText: () => {},
		readText: () => "",
	},
	screen: {
		getPrimaryDisplay: () => ({
			workAreaSize: { width: 1920, height: 1080 },
		}),
	},
	protocol: {
		registerSchemesAsPrivileged: () => {},
		handle: () => {},
	},
	nativeTheme: {
		themeSource: "system",
		shouldUseDarkColors: false,
		on: () => {},
	},
	contextBridge: {
		exposeInMainWorld: () => {},
	},
}));

// ─── Mock: trpc-electron ─────────────────────────────────────────────────────
mock.module("trpc-electron/main", () => ({
	createIPCHandler: () => {},
	exposeElectronTRPC: () => {},
}));

mock.module("trpc-electron/preload", () => ({
	exposeElectronTRPC: () => {},
}));

// ─── Mock: node-pty (native module not available in Bun) ─────────────────────
mock.module("node-pty", () => ({
	spawn: () => ({
		pid: 12345,
		onData: () => {},
		onExit: () => {},
		write: () => {},
		resize: () => {},
		kill: () => {},
		pause: () => {},
		resume: () => {},
	}),
}));

// ─── Mock: better-sqlite3 (native module not available in Bun) ───────────────
mock.module("better-sqlite3", () => {
	class MockDatabase {
		pragma() {
			return "";
		}
		exec() {}
		prepare() {
			return {
				run: () => ({ changes: 0 }),
				get: () => undefined,
				all: () => [],
			};
		}
		close() {}
	}
	return { default: MockDatabase };
});

// NOTE: @signoff/local-db is NOT mocked — it's a pure TypeScript schema package
// that works directly in Bun. Only native modules need mocking.

// ─── Mock: main/lib/local-db (better-sqlite3 not available in Bun) ───────────
mock.module("./src/main/lib/local-db", () => ({
	db: null,
	getDb: () => null,
	getSqlite: () => null,
	initLocalDb: () => null,
	closeLocalDb: () => {},
}));

// ─── Browser globals ─────────────────────────────────────────────────────────
if (typeof globalThis.document === "undefined") {
	(globalThis as any).document = {
		createElement: () => ({
			setAttribute: () => {},
			appendChild: () => {},
			style: {},
		}),
		getElementById: () => null,
		querySelector: () => null,
		body: {
			appendChild: () => {},
		},
	};
}

// ─── electronTRPC global (used by trpc-electron renderer) ────────────────────
if (typeof globalThis.electronTRPC === "undefined") {
	(globalThis as any).electronTRPC = {
		sendMessage: () => {},
		onMessage: () => () => {},
	};
}
