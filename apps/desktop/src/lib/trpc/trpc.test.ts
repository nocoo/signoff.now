import { describe, expect, test } from "bun:test";

// ─── tRPC Foundation ─────────────────────────────────────────────────────────

describe("lib/trpc", () => {
	test("exports router, publicProcedure, and middleware", async () => {
		const trpc = await import("./index");
		expect(typeof trpc.router).toBe("function");
		expect(typeof trpc.publicProcedure).toBe("object");
		expect(typeof trpc.middleware).toBe("function");
	});
});

// ─── Router Assembly ─────────────────────────────────────────────────────────

/** Mock dependencies for createAppRouter. */
function createMockDeps() {
	return {
		getDb: () => ({
			select: () => ({ from: () => ({ where: () => ({ get: () => null }) }) }),
			insert: () => ({ values: () => ({ run: () => {} }) }),
		}),
		getGit: () => ({
			status: () =>
				Promise.resolve({
					files: [],
					current: "main",
					tracking: null,
					staged: [],
					modified: [],
					not_added: [],
				}),
			diff: () => Promise.resolve(""),
			add: () => Promise.resolve(),
			reset: () => Promise.resolve(),
			commit: () => Promise.resolve({ commit: "abc", summary: null }),
			checkout: () => Promise.resolve(),
			log: () => Promise.resolve({ latest: null, all: [], total: 0 }),
		}),
		fsOps: {
			listDirectory: () => Promise.resolve([]),
			readFile: () => Promise.resolve({ content: "", encoding: "utf-8" }),
			writeFile: () => Promise.resolve(),
			createDirectory: () => Promise.resolve(),
			deletePath: () => Promise.resolve(),
			movePath: () => Promise.resolve(),
			getMetadata: () => Promise.resolve(null),
		},
		hotkeyStore: {
			list: () => Promise.resolve([]),
			get: () => Promise.resolve(null),
			update: () => Promise.resolve(null),
			reset: () => Promise.resolve(null),
			resetAll: () => Promise.resolve([]),
		},
		settingsDb: {
			get: () => Promise.resolve(null),
			update: () => Promise.resolve({}),
		},
		terminalManager: {
			createOrAttach: () =>
				Promise.resolve({
					isNew: true,
					snapshot: null,
					wasRecovered: false,
					pid: null,
				}),
			write: () => Promise.resolve(),
			resize: () => Promise.resolve(),
			detach: () => Promise.resolve(),
			kill: () => Promise.resolve(),
			signal: () => Promise.resolve(),
			clearScrollback: () => Promise.resolve(),
			listSessions: () => Promise.resolve({ sessions: [] }),
		},
		getWindow: () => null,
		getAppInfo: () => ({
			version: "0.0.0-test",
			platform: "darwin",
			dataPath: "/tmp/test-data",
		}),
		shellOps: {
			showItemInFolder: () => {},
			openExternal: () => Promise.resolve(),
		},
	};
}

describe("lib/trpc/routers", () => {
	test("createAppRouter returns a router object with deps", async () => {
		const { createAppRouter } = await import("./routers/index");
		const appRouter = createAppRouter(createMockDeps());
		expect(appRouter).toBeDefined();
		expect(appRouter._def).toBeDefined();
		expect(appRouter._def.procedures).toBeDefined();
	});

	test("AppRouter type is exported", async () => {
		const mod = await import("./routers/index");
		expect(mod.createAppRouter).toBeDefined();
	});

	test("all 12 sub-routers are assembled", async () => {
		const { createAppRouter } = await import("./routers/index");
		const appRouter = createAppRouter(createMockDeps());

		const record = appRouter._def.record;
		expect(record).toBeDefined();

		const subRouterNames = Object.keys(record);
		expect(subRouterNames).toContain("window");
		expect(subRouterNames).toContain("menu");
		expect(subRouterNames).toContain("projects");
		expect(subRouterNames).toContain("workspaces");
		expect(subRouterNames).toContain("terminal");
		expect(subRouterNames).toContain("changes");
		expect(subRouterNames).toContain("filesystem");
		expect(subRouterNames).toContain("settings");
		expect(subRouterNames).toContain("config");
		expect(subRouterNames).toContain("hotkeys");
		expect(subRouterNames).toContain("external");
		expect(subRouterNames).toContain("autoUpdate");
		expect(subRouterNames).toHaveLength(12);
	});

	test("factory routers have real procedures", async () => {
		const { createAppRouter } = await import("./routers/index");
		const appRouter = createAppRouter(createMockDeps());

		const record = appRouter._def.record;
		// Factory routers should have procedures (not empty objects)
		const projectsKeys = Object.keys(record.projects);
		expect(projectsKeys.length).toBeGreaterThan(0);
		expect(projectsKeys).toContain("list");
		expect(projectsKeys).toContain("get");
		expect(projectsKeys).toContain("create");

		const changesKeys = Object.keys(record.changes);
		expect(changesKeys.length).toBeGreaterThan(0);
		expect(changesKeys).toContain("status");
		expect(changesKeys).toContain("diff");

		const settingsKeys = Object.keys(record.settings);
		expect(settingsKeys.length).toBeGreaterThan(0);
		expect(settingsKeys).toContain("get");
		expect(settingsKeys).toContain("update");

		const hotkeysKeys = Object.keys(record.hotkeys);
		expect(hotkeysKeys.length).toBeGreaterThan(0);
		expect(hotkeysKeys).toContain("list");
	});
});

// ─── Individual Router Factories ─────────────────────────────────────────────

describe("router factories", () => {
	test("createWindowRouter creates a valid router", async () => {
		const { createWindowRouter } = await import("./routers/window");
		const router = createWindowRouter(() => null);
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.minimize).toBeDefined();
		expect(record.maximize).toBeDefined();
		expect(record.close).toBeDefined();
		expect(record.isMaximized).toBeDefined();
	});

	test("createMenuRouter creates a valid router", async () => {
		const { createMenuRouter } = await import("./routers/menu");
		const router = createMenuRouter(() => null);
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.getMenu).toBeDefined();
		expect(record.triggerAction).toBeDefined();
	});

	test("createTerminalRouter creates a valid router with procedures", async () => {
		const { createTerminalRouter } = await import("./routers/terminal/index");
		const mockManager = {} as Parameters<typeof createTerminalRouter>[0];
		const router = createTerminalRouter(mockManager);
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.createOrAttach).toBeDefined();
		expect(record.write).toBeDefined();
	});

	test("createConfigRouter creates a valid router", async () => {
		const { createConfigRouter } = await import("./routers/config/index");
		const router = createConfigRouter(() => ({
			version: "0.0.0",
			platform: "test",
			dataPath: "/tmp",
		}));
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.getAppVersion).toBeDefined();
		expect(record.getPlatform).toBeDefined();
		expect(record.getDataPath).toBeDefined();
	});

	test("createExternalRouter creates a valid router", async () => {
		const { createExternalRouter } = await import("./routers/external/index");
		const router = createExternalRouter({
			showItemInFolder: () => {},
			openExternal: () => Promise.resolve(),
		});
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.openInFinder).toBeDefined();
		expect(record.openUrl).toBeDefined();
		expect(record.openInEditor).toBeDefined();
	});

	test("createAutoUpdateRouter creates a valid router", async () => {
		const { createAutoUpdateRouter } = await import(
			"./routers/auto-update/index"
		);
		const router = createAutoUpdateRouter();
		expect(router._def).toBeDefined();
		const record = router._def.record;
		expect(record.checkForUpdates).toBeDefined();
		expect(record.getUpdateInfo).toBeDefined();
	});
});

// ─── Factory function exports ───────────────────────────────────────────────

describe("factory function exports", () => {
	test("createProjectsTrpcRouter is exported", async () => {
		const { createProjectsTrpcRouter } = await import(
			"./routers/projects/index"
		);
		expect(typeof createProjectsTrpcRouter).toBe("function");
	});

	test("createWorkspacesTrpcRouter is exported", async () => {
		const { createWorkspacesTrpcRouter } = await import(
			"./routers/workspaces/index"
		);
		expect(typeof createWorkspacesTrpcRouter).toBe("function");
	});

	test("createChangesTrpcRouter is exported", async () => {
		const { createChangesTrpcRouter } = await import("./routers/changes/index");
		expect(typeof createChangesTrpcRouter).toBe("function");
	});

	test("createFilesystemTrpcRouter is exported", async () => {
		const { createFilesystemTrpcRouter } = await import(
			"./routers/filesystem/index"
		);
		expect(typeof createFilesystemTrpcRouter).toBe("function");
	});

	test("createSettingsTrpcRouter is exported", async () => {
		const { createSettingsTrpcRouter } = await import(
			"./routers/settings/index"
		);
		expect(typeof createSettingsTrpcRouter).toBe("function");
	});

	test("createHotkeysTrpcRouter is exported", async () => {
		const { createHotkeysTrpcRouter } = await import("./routers/hotkeys/index");
		expect(typeof createHotkeysTrpcRouter).toBe("function");
	});
});
