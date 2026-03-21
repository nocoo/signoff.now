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
}));

mock.module("trpc-electron/preload", () => ({
	exposeElectronTRPC: () => {},
}));

// ─── Mock: @signoff/local-db ─────────────────────────────────────────────────
mock.module("@signoff/local-db", () => ({
	projects: {},
	worktrees: {},
	workspaces: {},
	workspaceSections: {},
	settings: {},
}));

// ─── Mock: main/lib/local-db (better-sqlite3 not available in Bun) ───────────
mock.module("./src/main/lib/local-db", () => ({
	db: null,
	initLocalDb: () => {},
}));

// ─── Browser globals ─────────────────────────────────────────────────────────
if (typeof globalThis.document === "undefined") {
	// biome-ignore lint/suspicious/noExplicitAny: test polyfill
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
	// biome-ignore lint/suspicious/noExplicitAny: test polyfill
	(globalThis as any).electronTRPC = {
		sendMessage: () => {},
		onMessage: () => () => {},
	};
}
