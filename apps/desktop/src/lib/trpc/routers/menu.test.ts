/**
 * Tests for the menu tRPC router.
 *
 * Verifies:
 * - getMenu returns all available actions
 * - triggerAction dispatches main-process actions (devtools, reload)
 * - triggerAction forwards renderer-side actions via IPC
 * - triggerAction returns "none" when no window is available
 */

import { describe, expect, mock, test } from "bun:test";
import {
	createMenuRouter,
	MENU_ACTION_IPC_CHANNEL,
	MENU_ACTIONS,
} from "./menu";

/** Creates a mock BrowserWindow with webContents.send/toggleDevTools/reload. */
function createMockWindow() {
	return {
		webContents: {
			send: mock(() => {}),
			toggleDevTools: mock(() => {}),
			reload: mock(() => {}),
		},
	};
}

describe("createMenuRouter", () => {
	test("getMenu returns all defined actions", async () => {
		const router = createMenuRouter(() => null);
		const caller = router.createCaller({});

		const result = await caller.getMenu();
		expect(result.actions).toEqual(MENU_ACTIONS);
		expect(result.actions.length).toBe(13);
	});

	test("triggerAction forwards renderer action via IPC", async () => {
		const win = createMockWindow();
		// biome-ignore lint/suspicious/noExplicitAny: mock BrowserWindow
		const router = createMenuRouter(() => win as any);
		const caller = router.createCaller({});

		const result = await caller.triggerAction({ actionId: "file.save" });

		expect(result.triggered).toBe("file.save");
		expect(result.target).toBe("renderer");
		expect(win.webContents.send).toHaveBeenCalledWith(MENU_ACTION_IPC_CHANNEL, {
			actionId: "file.save",
		});
	});

	test("triggerAction handles view.toggleDevTools in main process", async () => {
		const win = createMockWindow();
		// biome-ignore lint/suspicious/noExplicitAny: mock BrowserWindow
		const router = createMenuRouter(() => win as any);
		const caller = router.createCaller({});

		const result = await caller.triggerAction({
			actionId: "view.toggleDevTools",
		});

		expect(result.triggered).toBe("view.toggleDevTools");
		expect(result.target).toBe("main");
		expect(win.webContents.toggleDevTools).toHaveBeenCalled();
	});

	test("triggerAction handles view.reload in main process", async () => {
		const win = createMockWindow();
		// biome-ignore lint/suspicious/noExplicitAny: mock BrowserWindow
		const router = createMenuRouter(() => win as any);
		const caller = router.createCaller({});

		const result = await caller.triggerAction({ actionId: "view.reload" });

		expect(result.triggered).toBe("view.reload");
		expect(result.target).toBe("main");
		expect(win.webContents.reload).toHaveBeenCalled();
	});

	test("triggerAction returns 'none' when window is null", async () => {
		const router = createMenuRouter(() => null);
		const caller = router.createCaller({});

		const result = await caller.triggerAction({ actionId: "file.save" });

		expect(result.triggered).toBe("file.save");
		expect(result.target).toBe("none");
	});

	test("triggerAction returns 'main' for app.quit even without window", async () => {
		const router = createMenuRouter(() => null);
		const caller = router.createCaller({});

		const result = await caller.triggerAction({ actionId: "app.quit" });

		expect(result.triggered).toBe("app.quit");
		expect(result.target).toBe("main");
	});

	test("triggerAction does not send IPC for main-process actions", async () => {
		const win = createMockWindow();
		// biome-ignore lint/suspicious/noExplicitAny: mock BrowserWindow
		const router = createMenuRouter(() => win as any);
		const caller = router.createCaller({});

		await caller.triggerAction({ actionId: "view.toggleDevTools" });
		await caller.triggerAction({ actionId: "view.reload" });

		expect(win.webContents.send).not.toHaveBeenCalled();
	});

	test("MENU_ACTIONS have unique ids", () => {
		const ids = MENU_ACTIONS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
