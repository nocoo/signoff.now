/**
 * L2 Integration Test — full tRPC router layer with real I/O.
 *
 * Covers the 7 routers NOT tested in e2e-smoke.test.ts:
 *   1. Changes   — real git repo (simple-git)
 *   2. Filesystem — real temp directory (mock FsOperations backed by node:fs)
 *   3. Config     — pure value injection
 *   4. External   — mock shell ops
 *   5. AutoUpdate — graceful degradation (no electron-updater)
 *   6. Menu       — mock BrowserWindow
 *   7. Window     — mock BrowserWindow
 *
 * All routers use their factory pattern (dependency injection), no Electron
 * runtime required.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import simpleGit from "simple-git";
import { createAutoUpdateRouter } from "../auto-update";
import { createChangesRouter } from "../changes";
import { createConfigRouter } from "../config";
import { createExternalRouter } from "../external";
import { createFilesystemRouter } from "../filesystem";
import {
	createMenuRouter,
	MENU_ACTION_IPC_CHANNEL,
	MENU_ACTIONS,
} from "../menu";
import { createWindowRouter } from "../window";

// ── Shared temp dirs ──────────────────────────────────

const TEST_ROOT = join(tmpdir(), `signoff-l2-${Date.now()}`);
const GIT_REPO = join(TEST_ROOT, "git-repo");
const FS_ROOT = join(TEST_ROOT, "fs-workspace");

// ── Setup / Teardown ──────────────────────────────────

beforeAll(async () => {
	mkdirSync(GIT_REPO, { recursive: true });
	mkdirSync(FS_ROOT, { recursive: true });

	// Initialize real git repo with an initial commit
	const git = simpleGit(GIT_REPO);
	await git.init();
	// simple-git returns thenables — await is correct despite biome nursery warning
	// biome-ignore lint/nursery/useAwaitThenable: simple-git returns thenable
	await git.addConfig("user.email", "test@signoff.dev");
	// biome-ignore lint/nursery/useAwaitThenable: simple-git returns thenable
	await git.addConfig("user.name", "L2 Test");

	writeFileSync(join(GIT_REPO, "README.md"), "# L2 Test Repo\n");
	await git.add("README.md");
	// biome-ignore lint/nursery/useAwaitThenable: simple-git returns thenable
	await git.commit("initial commit");
});

afterAll(() => {
	if (existsSync(TEST_ROOT)) {
		rmSync(TEST_ROOT, { recursive: true });
	}
});

// ═══════════════════════════════════════════════════════
// 1. Changes Router — real git operations
// ═══════════════════════════════════════════════════════

describe("changes router (real git)", () => {
	const changesRouter = createChangesRouter((cwd?: string) =>
		simpleGit(cwd ?? GIT_REPO),
	);

	test("status returns branch and empty file list on clean repo", async () => {
		const result = await changesRouter.status({ workspacePath: GIT_REPO });

		expect(typeof result.branch).toBe("string");
		expect(result.branch).toBeTruthy();
		expect(result.files).toBeArray();
		expect(result.files).toHaveLength(0);
	});

	test("status detects untracked files", async () => {
		writeFileSync(join(GIT_REPO, "untracked.ts"), "export {};\n");

		const result = await changesRouter.status({ workspacePath: GIT_REPO });
		const untracked = result.files.find((f) => f.path === "untracked.ts");

		expect(untracked).toBeDefined();
		expect(untracked!.status).toBe("untracked");
		expect(untracked!.staged).toBe(false);
	});

	test("stage moves files to staged state", async () => {
		await changesRouter.stage({
			workspacePath: GIT_REPO,
			filePaths: ["untracked.ts"],
		});

		const result = await changesRouter.status({ workspacePath: GIT_REPO });
		const staged = result.files.find((f) => f.path === "untracked.ts");

		expect(staged).toBeDefined();
		expect(staged!.staged).toBe(true);
	});

	test("unstage moves files back to unstaged", async () => {
		await changesRouter.unstage({
			workspacePath: GIT_REPO,
			filePaths: ["untracked.ts"],
		});

		const result = await changesRouter.status({ workspacePath: GIT_REPO });
		const file = result.files.find((f) => f.path === "untracked.ts");

		expect(file).toBeDefined();
		expect(file!.staged).toBe(false);
	});

	test("diff returns diff text for modified tracked file", async () => {
		// Modify a tracked file to get a real diff
		writeFileSync(join(GIT_REPO, "README.md"), "# L2 Test Repo\n\nUpdated.\n");

		const result = await changesRouter.diff({
			workspacePath: GIT_REPO,
			filePath: "README.md",
		});

		expect(result.filePath).toBe("README.md");
		expect(result.diff).toContain("Updated");
	});

	test("diff with staged flag returns staged diff", async () => {
		const git = simpleGit(GIT_REPO);
		await git.add("README.md");

		const result = await changesRouter.diff({
			workspacePath: GIT_REPO,
			filePath: "README.md",
			staged: true,
		});

		expect(result.diff).toContain("Updated");
	});

	test("commit creates a commit and returns hash", async () => {
		// Stage untracked.ts too
		await changesRouter.stage({
			workspacePath: GIT_REPO,
			filePaths: ["untracked.ts"],
		});

		const result = await changesRouter.commit({
			workspacePath: GIT_REPO,
			message: "test: add untracked and update readme",
		});

		expect(result.hash).toBeTruthy();
		expect(typeof result.hash).toBe("string");

		// Verify clean status after commit
		const status = await changesRouter.status({ workspacePath: GIT_REPO });
		expect(status.files).toHaveLength(0);
	});

	test("log returns commit history", async () => {
		const result = await changesRouter.log({
			workspacePath: GIT_REPO,
			limit: 10,
		});

		expect(result.latest).toBeDefined();
		expect(result.latest!.message).toBe(
			"test: add untracked and update readme",
		);
		expect(result.latest!.author_name).toBeTruthy();
		expect(result.all.length).toBeGreaterThanOrEqual(2);
		expect(result.total).toBeGreaterThanOrEqual(2);
	});

	test("log respects limit parameter", async () => {
		const result = await changesRouter.log({
			workspacePath: GIT_REPO,
			limit: 1,
		});

		expect(result.all).toHaveLength(1);
	});

	test("discard reverts unstaged changes", async () => {
		// Create a modification
		writeFileSync(join(GIT_REPO, "README.md"), "# DISCARDED\n");
		const before = await changesRouter.status({ workspacePath: GIT_REPO });
		expect(before.files.length).toBeGreaterThan(0);

		// Discard
		await changesRouter.discard({
			workspacePath: GIT_REPO,
			filePaths: ["README.md"],
		});

		const content = readFileSync(join(GIT_REPO, "README.md"), "utf-8");
		expect(content).not.toContain("DISCARDED");

		const after = await changesRouter.status({ workspacePath: GIT_REPO });
		const readme = after.files.find((f) => f.path === "README.md");
		expect(readme).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════
// 2. Filesystem Router — real temp directory
// ═══════════════════════════════════════════════════════

describe("filesystem router (real fs)", () => {
	/**
	 * Build a real FsOperations adapter that delegates to node:fs.
	 * This matches the interface the router calls: listDirectory, readFile,
	 * writeFile, createDirectory, deletePath, movePath, getMetadata.
	 */
	const realFsOps = {
		async listDirectory(input: { path: string }) {
			const entries = readdirSync(input.path, { withFileTypes: true });
			return entries.map((e) => ({
				name: e.name,
				isDirectory: e.isDirectory(),
				isSymlink: e.isSymbolicLink(),
				size: e.isFile() ? statSync(join(input.path, e.name)).size : 0,
			}));
		},
		async readFile(input: { path: string }) {
			return {
				content: readFileSync(input.path, "utf-8"),
				encoding: "utf-8",
			};
		},
		async writeFile(input: { path: string; content: string }) {
			writeFileSync(input.path, input.content);
		},
		async createDirectory(input: { path: string }) {
			mkdirSync(input.path, { recursive: true });
		},
		async deletePath(input: { path: string }) {
			rmSync(input.path, { recursive: true, force: true });
		},
		async movePath(input: { sourcePath: string; destinationPath: string }) {
			const { renameSync } = await import("node:fs");
			renameSync(input.sourcePath, input.destinationPath);
		},
		async getMetadata(input: { path: string }) {
			const stat = statSync(input.path);
			return {
				name: basename(input.path),
				isDirectory: stat.isDirectory(),
				isSymlink: stat.isSymbolicLink(),
				size: stat.size,
				mtime: stat.mtimeMs,
			};
		},
	};

	const fsRouter = createFilesystemRouter(realFsOps);

	beforeAll(() => {
		// Seed the workspace with test files
		writeFileSync(join(FS_ROOT, "hello.txt"), "Hello, world!\n");
		writeFileSync(join(FS_ROOT, "data.json"), '{"key":"value"}\n');
		mkdirSync(join(FS_ROOT, "subdir"), { recursive: true });
		writeFileSync(join(FS_ROOT, "subdir", "nested.ts"), "export {};\n");
	});

	test("listDirectory returns entries for root", async () => {
		const result = await fsRouter.listDirectory({
			workspacePath: FS_ROOT,
			relativePath: ".",
		});

		expect(result.entries.length).toBeGreaterThanOrEqual(3);
		const names = result.entries.map((e) => e.name);
		expect(names).toContain("hello.txt");
		expect(names).toContain("data.json");
		expect(names).toContain("subdir");

		const subdir = result.entries.find((e) => e.name === "subdir");
		expect(subdir!.isDirectory).toBe(true);
	});

	test("listDirectory returns entries for subdirectory", async () => {
		const result = await fsRouter.listDirectory({
			workspacePath: FS_ROOT,
			relativePath: "subdir",
		});

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].name).toBe("nested.ts");
		expect(result.entries[0].isDirectory).toBe(false);
	});

	test("readFile returns content and encoding", async () => {
		const result = await fsRouter.readFile({
			workspacePath: FS_ROOT,
			relativePath: "hello.txt",
		});

		expect(result.content).toBe("Hello, world!\n");
		expect(result.encoding).toBe("utf-8");
	});

	test("writeFile creates and updates files", async () => {
		await fsRouter.writeFile({
			workspacePath: FS_ROOT,
			relativePath: "written.txt",
			content: "Written by L2 test.\n",
		});

		const content = readFileSync(join(FS_ROOT, "written.txt"), "utf-8");
		expect(content).toBe("Written by L2 test.\n");

		// Overwrite
		await fsRouter.writeFile({
			workspacePath: FS_ROOT,
			relativePath: "written.txt",
			content: "Overwritten.\n",
		});

		const updated = readFileSync(join(FS_ROOT, "written.txt"), "utf-8");
		expect(updated).toBe("Overwritten.\n");
	});

	test("createDirectory creates nested directories", async () => {
		await fsRouter.createDirectory({
			workspacePath: FS_ROOT,
			relativePath: "deep/nested/dir",
		});

		expect(existsSync(join(FS_ROOT, "deep", "nested", "dir"))).toBe(true);
	});

	test("getMetadata returns correct file info", async () => {
		const result = await fsRouter.getMetadata({
			workspacePath: FS_ROOT,
			relativePath: "hello.txt",
		});

		expect(result.name).toBe("hello.txt");
		expect(result.isDirectory).toBe(false);
		expect(result.size).toBeGreaterThan(0);
		expect(result.mtime).toBeGreaterThan(0);
	});

	test("getMetadata returns directory info", async () => {
		const result = await fsRouter.getMetadata({
			workspacePath: FS_ROOT,
			relativePath: "subdir",
		});

		expect(result.name).toBe("subdir");
		expect(result.isDirectory).toBe(true);
	});

	test("movePath renames a file", async () => {
		writeFileSync(join(FS_ROOT, "to-move.txt"), "Move me.\n");

		await fsRouter.movePath({
			workspacePath: FS_ROOT,
			sourcePath: "to-move.txt",
			destinationPath: "moved.txt",
		});

		expect(existsSync(join(FS_ROOT, "to-move.txt"))).toBe(false);
		expect(existsSync(join(FS_ROOT, "moved.txt"))).toBe(true);
		expect(readFileSync(join(FS_ROOT, "moved.txt"), "utf-8")).toBe(
			"Move me.\n",
		);
	});

	test("deletePath removes file", async () => {
		writeFileSync(join(FS_ROOT, "to-delete.txt"), "Delete me.\n");
		expect(existsSync(join(FS_ROOT, "to-delete.txt"))).toBe(true);

		await fsRouter.deletePath({
			workspacePath: FS_ROOT,
			relativePath: "to-delete.txt",
		});

		expect(existsSync(join(FS_ROOT, "to-delete.txt"))).toBe(false);
	});

	test("deletePath removes directory recursively", async () => {
		mkdirSync(join(FS_ROOT, "rm-dir", "child"), { recursive: true });
		writeFileSync(join(FS_ROOT, "rm-dir", "child", "f.txt"), "content");

		await fsRouter.deletePath({
			workspacePath: FS_ROOT,
			relativePath: "rm-dir",
		});

		expect(existsSync(join(FS_ROOT, "rm-dir"))).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════
// 3. Config Router — pure value injection
// ═══════════════════════════════════════════════════════

describe("config router", () => {
	const appInfo = {
		version: "1.2.3-test",
		platform: "darwin",
		dataPath: "/tmp/signoff-test-data",
	};

	const configRouter = createConfigRouter(() => appInfo);
	const caller = configRouter.createCaller({});

	test("getAppVersion returns injected version", async () => {
		const result = await caller.getAppVersion();
		expect(result.version).toBe("1.2.3-test");
	});

	test("getPlatform returns injected platform", async () => {
		const result = await caller.getPlatform();
		expect(result.platform).toBe("darwin");
	});

	test("getDataPath returns injected data path", async () => {
		const result = await caller.getDataPath();
		expect(result.dataPath).toBe("/tmp/signoff-test-data");
	});
});

// ═══════════════════════════════════════════════════════
// 4. External Router — mock shell operations
// ═══════════════════════════════════════════════════════

describe("external router", () => {
	let shellOps: {
		showItemInFolder: ReturnType<typeof mock>;
		openExternal: ReturnType<typeof mock>;
	};
	let caller: ReturnType<
		ReturnType<typeof createExternalRouter>["createCaller"]
	>;

	beforeEach(() => {
		shellOps = {
			showItemInFolder: mock(() => {}),
			openExternal: mock(() => Promise.resolve()),
		};
		const externalRouter = createExternalRouter(shellOps);
		caller = externalRouter.createCaller({});
	});

	test("openInFinder calls showItemInFolder with correct path", async () => {
		await caller.openInFinder({ path: "/Users/test/project" });

		expect(shellOps.showItemInFolder).toHaveBeenCalledTimes(1);
		expect(shellOps.showItemInFolder).toHaveBeenCalledWith(
			"/Users/test/project",
		);
	});

	test("openUrl calls openExternal with URL", async () => {
		await caller.openUrl({ url: "https://github.com/signoff" });

		expect(shellOps.openExternal).toHaveBeenCalledTimes(1);
		expect(shellOps.openExternal).toHaveBeenCalledWith(
			"https://github.com/signoff",
		);
	});

	test("openInEditor calls openExternal with file:// URL", async () => {
		await caller.openInEditor({ path: "/Users/test/file.ts" });

		expect(shellOps.openExternal).toHaveBeenCalledTimes(1);
		expect(shellOps.openExternal).toHaveBeenCalledWith(
			"file:///Users/test/file.ts",
		);
	});

	test("openInEditor accepts optional editor parameter", async () => {
		await caller.openInEditor({ path: "/tmp/code.rs", editor: "code" });

		expect(shellOps.openExternal).toHaveBeenCalledTimes(1);
	});
});

// ═══════════════════════════════════════════════════════
// 5. AutoUpdate Router — graceful degradation
// ═══════════════════════════════════════════════════════

describe("auto-update router", () => {
	test("getUpdateInfo returns default state", async () => {
		const autoUpdateRouter = createAutoUpdateRouter();
		const caller = autoUpdateRouter.createCaller({});

		const result = await caller.getUpdateInfo();

		expect(result).toEqual({
			checking: false,
			available: false,
			downloading: false,
			downloaded: false,
			version: null,
			error: null,
		});
	});

	test("checkForUpdates handles missing electron-updater gracefully", async () => {
		const autoUpdateRouter = createAutoUpdateRouter();
		const caller = autoUpdateRouter.createCaller({});

		// In test environment, electron-updater import will fail → should not throw
		const result = await caller.checkForUpdates();

		expect(result.checking).toBe(false);
		// Should not error — graceful degradation
		expect(typeof result.available).toBe("boolean");
	});

	test("getUpdateInfo reflects state after checkForUpdates", async () => {
		const autoUpdateRouter = createAutoUpdateRouter();
		const caller = autoUpdateRouter.createCaller({});

		await caller.checkForUpdates();
		const result = await caller.getUpdateInfo();

		// After check completes, checking should be false
		expect(result.checking).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════
// 6. Menu Router — mock BrowserWindow
// ═══════════════════════════════════════════════════════

describe("menu router", () => {
	function createMockWindow() {
		return {
			webContents: {
				send: mock(() => {}),
				toggleDevTools: mock(() => {}),
				reload: mock(() => {}),
			},
		};
	}

	test("getMenu returns all defined actions", async () => {
		const menuRouter = createMenuRouter(() => null);
		const caller = menuRouter.createCaller({});

		const result = await caller.getMenu();

		expect(result.actions).toEqual(MENU_ACTIONS);
		expect(result.actions.length).toBe(13);
	});

	test("getMenu actions have unique IDs", async () => {
		const ids = MENU_ACTIONS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("triggerAction forwards renderer action via IPC", async () => {
		const win = createMockWindow();
		const menuRouter = createMenuRouter(() => win as any);
		const caller = menuRouter.createCaller({});

		const result = await caller.triggerAction({ actionId: "file.save" });

		expect(result.triggered).toBe("file.save");
		expect(result.target).toBe("renderer");
		expect(win.webContents.send).toHaveBeenCalledWith(MENU_ACTION_IPC_CHANNEL, {
			actionId: "file.save",
		});
	});

	test("triggerAction handles view.toggleDevTools in main process", async () => {
		const win = createMockWindow();
		const menuRouter = createMenuRouter(() => win as any);
		const caller = menuRouter.createCaller({});

		const result = await caller.triggerAction({
			actionId: "view.toggleDevTools",
		});

		expect(result.target).toBe("main");
		expect(win.webContents.toggleDevTools).toHaveBeenCalled();
		expect(win.webContents.send).not.toHaveBeenCalled();
	});

	test("triggerAction handles view.reload in main process", async () => {
		const win = createMockWindow();
		const menuRouter = createMenuRouter(() => win as any);
		const caller = menuRouter.createCaller({});

		const result = await caller.triggerAction({ actionId: "view.reload" });

		expect(result.target).toBe("main");
		expect(win.webContents.reload).toHaveBeenCalled();
	});

	test("triggerAction returns 'none' when no window available", async () => {
		const menuRouter = createMenuRouter(() => null);
		const caller = menuRouter.createCaller({});

		const result = await caller.triggerAction({ actionId: "file.open" });

		expect(result.triggered).toBe("file.open");
		expect(result.target).toBe("none");
	});
});

// ═══════════════════════════════════════════════════════
// 7. Window Router — mock BrowserWindow
// ═══════════════════════════════════════════════════════

describe("window router", () => {
	function createMockWindow(maximized = false) {
		return {
			minimize: mock(() => {}),
			maximize: mock(() => {}),
			unmaximize: mock(() => {}),
			close: mock(() => {}),
			isMaximized: mock(() => maximized),
			webContents: {
				on: () => {},
				send: () => {},
			},
		};
	}

	test("minimize calls window.minimize", async () => {
		const win = createMockWindow();
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		await caller.minimize();

		expect(win.minimize).toHaveBeenCalledTimes(1);
	});

	test("maximize calls window.maximize when not maximized", async () => {
		const win = createMockWindow(false);
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		await caller.maximize();

		expect(win.maximize).toHaveBeenCalledTimes(1);
		expect(win.unmaximize).not.toHaveBeenCalled();
	});

	test("maximize calls window.unmaximize when already maximized", async () => {
		const win = createMockWindow(true);
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		await caller.maximize();

		expect(win.unmaximize).toHaveBeenCalledTimes(1);
		expect(win.maximize).not.toHaveBeenCalled();
	});

	test("close calls window.close", async () => {
		const win = createMockWindow();
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		await caller.close();

		expect(win.close).toHaveBeenCalledTimes(1);
	});

	test("isMaximized returns false when not maximized", async () => {
		const win = createMockWindow(false);
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		const result = await caller.isMaximized();

		expect(result.isMaximized).toBe(false);
	});

	test("isMaximized returns true when maximized", async () => {
		const win = createMockWindow(true);
		const windowRouter = createWindowRouter(() => win as any);
		const caller = windowRouter.createCaller({});

		const result = await caller.isMaximized();

		expect(result.isMaximized).toBe(true);
	});

	test("isMaximized returns false when window is null", async () => {
		const windowRouter = createWindowRouter(() => null);
		const caller = windowRouter.createCaller({});

		const result = await caller.isMaximized();

		expect(result.isMaximized).toBe(false);
	});

	test("minimize is a no-op when window is null", async () => {
		const windowRouter = createWindowRouter(() => null);
		const caller = windowRouter.createCaller({});

		// Should not throw
		await caller.minimize();
	});

	test("close is a no-op when window is null", async () => {
		const windowRouter = createWindowRouter(() => null);
		const caller = windowRouter.createCaller({});

		// Should not throw
		await caller.close();
	});
});
