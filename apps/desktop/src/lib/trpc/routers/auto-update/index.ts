/**
 * Auto-update tRPC router — wraps electron-updater.
 *
 * Provides check, download, and install operations.
 * In development, update checks are no-ops.
 */

import { publicProcedure, router } from "lib/trpc";

/** Update state shared across queries. */
let updateState: {
	checking: boolean;
	available: boolean;
	downloading: boolean;
	downloaded: boolean;
	version: string | null;
	error: string | null;
} = {
	checking: false,
	available: false,
	downloading: false,
	downloaded: false,
	version: null,
	error: null,
};

/** Creates the auto-update router. */
export function createAutoUpdateRouter() {
	return router({
		checkForUpdates: publicProcedure.mutation(async () => {
			updateState = { ...updateState, checking: true, error: null };
			try {
				// electron-updater is optional — only works in production builds
				const { autoUpdater } = await import("electron-updater").catch(() => ({
					autoUpdater: null,
				}));
				if (autoUpdater) {
					const result = await autoUpdater.checkForUpdates();
					updateState = {
						...updateState,
						checking: false,
						available: !!result?.updateInfo,
						version: result?.updateInfo?.version ?? null,
					};
				} else {
					updateState = { ...updateState, checking: false };
				}
			} catch (error) {
				updateState = {
					...updateState,
					checking: false,
					error: error instanceof Error ? error.message : "Update check failed",
				};
			}
			return updateState;
		}),

		getUpdateInfo: publicProcedure.query(() => {
			return updateState;
		}),
	});
}
