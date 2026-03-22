/**
 * Window tRPC router — BrowserWindow control.
 *
 * Factory function receives a getWindow provider and exposes
 * minimize, maximize, close, and isMaximized operations.
 */

import type { BrowserWindow } from "electron";
import { publicProcedure, router } from "lib/trpc";

/** Creates the window router with the given window provider. */
export function createWindowRouter(getWindow: () => BrowserWindow | null) {
	return router({
		minimize: publicProcedure.mutation(() => {
			getWindow()?.minimize();
		}),

		maximize: publicProcedure.mutation(() => {
			const win = getWindow();
			if (!win) return;
			if (win.isMaximized()) {
				win.unmaximize();
			} else {
				win.maximize();
			}
		}),

		close: publicProcedure.mutation(() => {
			getWindow()?.close();
		}),

		isMaximized: publicProcedure.query(() => {
			return { isMaximized: getWindow()?.isMaximized() ?? false };
		}),
	});
}
