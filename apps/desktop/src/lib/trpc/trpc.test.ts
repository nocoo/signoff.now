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

describe("lib/trpc/routers", () => {
	test("createAppRouter returns a router object", async () => {
		const { createAppRouter } = await import("./routers/index");
		const appRouter = createAppRouter();
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
		const appRouter = createAppRouter();

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
});

// ─── Individual Router Stubs ─────────────────────────────────────────────────

describe("individual router stubs", () => {
	test("windowRouter is a valid router", async () => {
		const { windowRouter } = await import("./routers/window");
		expect(windowRouter._def).toBeDefined();
	});

	test("menuRouter is a valid router", async () => {
		const { menuRouter } = await import("./routers/menu");
		expect(menuRouter._def).toBeDefined();
	});

	test("projectsRouter is a valid router", async () => {
		const { projectsRouter } = await import("./routers/projects/index");
		expect(projectsRouter._def).toBeDefined();
	});

	test("workspacesRouter is a valid router", async () => {
		const { workspacesRouter } = await import("./routers/workspaces/index");
		expect(workspacesRouter._def).toBeDefined();
	});

	test("terminalRouter is a valid router", async () => {
		const { terminalRouter } = await import("./routers/terminal/index");
		expect(terminalRouter._def).toBeDefined();
	});

	test("changesRouter is a valid router", async () => {
		const { changesRouter } = await import("./routers/changes/index");
		expect(changesRouter._def).toBeDefined();
	});

	test("filesystemRouter is a valid router", async () => {
		const { filesystemRouter } = await import("./routers/filesystem/index");
		expect(filesystemRouter._def).toBeDefined();
	});

	test("settingsRouter is a valid router", async () => {
		const { settingsRouter } = await import("./routers/settings/index");
		expect(settingsRouter._def).toBeDefined();
	});

	test("configRouter is a valid router", async () => {
		const { configRouter } = await import("./routers/config/index");
		expect(configRouter._def).toBeDefined();
	});

	test("hotkeysRouter is a valid router", async () => {
		const { hotkeysRouter } = await import("./routers/hotkeys/index");
		expect(hotkeysRouter._def).toBeDefined();
	});

	test("externalRouter is a valid router", async () => {
		const { externalRouter } = await import("./routers/external/index");
		expect(externalRouter._def).toBeDefined();
	});

	test("autoUpdateRouter is a valid router", async () => {
		const { autoUpdateRouter } = await import("./routers/auto-update/index");
		expect(autoUpdateRouter._def).toBeDefined();
	});
});
