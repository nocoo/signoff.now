/**
 * Menu tRPC router — application menu queries and actions.
 *
 * Exposes getMenu query for renderer to know available menu actions,
 * and triggerAction mutation for programmatic menu activation.
 *
 * Native actions (quit, devtools, reload) are handled in the main process.
 * Renderer-side actions are forwarded via IPC.
 */

import type { BrowserWindow } from "electron";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

/** IPC channel for menu action events sent to the renderer. */
export const MENU_ACTION_IPC_CHANNEL = "menu:action";

/** Standard menu actions available in the app. */
export const MENU_ACTIONS = [
	{ id: "app.about", label: "About Signoff" },
	{ id: "app.preferences", label: "Preferences…" },
	{ id: "app.quit", label: "Quit" },
	{ id: "file.new", label: "New File" },
	{ id: "file.open", label: "Open…" },
	{ id: "file.save", label: "Save" },
	{ id: "edit.undo", label: "Undo" },
	{ id: "edit.redo", label: "Redo" },
	{ id: "edit.cut", label: "Cut" },
	{ id: "edit.copy", label: "Copy" },
	{ id: "edit.paste", label: "Paste" },
	{ id: "view.toggleDevTools", label: "Toggle Developer Tools" },
	{ id: "view.reload", label: "Reload" },
] as const;

/** Action IDs that are handled in the main process (not forwarded to renderer). */
const MAIN_PROCESS_ACTIONS: Record<
	string,
	(win: BrowserWindow | null) => void
> = {
	"app.quit": () => {
		// Dynamic import to avoid pulling electron into test bundles
		import("electron")
			.then(({ app }) => app?.quit?.())
			.catch(() => {
				// intentionally empty
			});
	},
	"view.toggleDevTools": (win) => {
		win?.webContents.toggleDevTools();
	},
	"view.reload": (win) => {
		win?.webContents.reload();
	},
};

/** Creates the menu router with the given window provider. */
export function createMenuRouter(getWindow: () => BrowserWindow | null) {
	return router({
		getMenu: publicProcedure.query(() => {
			return { actions: MENU_ACTIONS };
		}),

		triggerAction: publicProcedure
			.input(z.object({ actionId: z.string().min(1) }))
			.mutation(({ input }) => {
				const { actionId } = input;
				const win = getWindow();

				// Handle main-process actions directly
				const mainHandler = MAIN_PROCESS_ACTIONS[actionId];
				if (mainHandler) {
					mainHandler(win);
					return { triggered: actionId, target: "main" as const };
				}

				// Forward to renderer via IPC
				if (win) {
					win.webContents.send(MENU_ACTION_IPC_CHANNEL, { actionId });
					return { triggered: actionId, target: "renderer" as const };
				}

				return { triggered: actionId, target: "none" as const };
			}),
	});
}
