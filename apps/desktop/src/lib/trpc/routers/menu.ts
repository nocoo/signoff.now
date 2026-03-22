/**
 * Menu tRPC router — application menu queries and actions.
 *
 * Exposes getMenu query for renderer to know available menu actions,
 * and triggerAction mutation for programmatic menu activation.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

/** Standard menu actions available in the app. */
const MENU_ACTIONS = [
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

/** Creates the menu router. */
export function createMenuRouter() {
	return router({
		getMenu: publicProcedure.query(() => {
			return { actions: MENU_ACTIONS };
		}),

		triggerAction: publicProcedure
			.input(z.object({ actionId: z.string().min(1) }))
			.mutation(({ input }) => {
				// Menu actions are handled by native menu accelerators.
				// This endpoint exists for programmatic triggering from renderer.
				return { triggered: input.actionId };
			}),
	});
}
