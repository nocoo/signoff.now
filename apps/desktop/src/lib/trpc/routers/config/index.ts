/**
 * Config tRPC router — read-only system/app information.
 *
 * Factory function receives an AppInfo provider and exposes
 * version, platform, and data path queries.
 */

import { publicProcedure, router } from "lib/trpc";

/** Shape of the app info provider injected at startup. */
export interface AppInfo {
	version: string;
	platform: string;
	dataPath: string;
}

/** Creates the config router with the given app info provider. */
export function createConfigRouter(getAppInfo: () => AppInfo) {
	return router({
		getAppVersion: publicProcedure.query(() => {
			return { version: getAppInfo().version };
		}),

		getPlatform: publicProcedure.query(() => {
			return { platform: getAppInfo().platform };
		}),

		getDataPath: publicProcedure.query(() => {
			return { dataPath: getAppInfo().dataPath };
		}),
	});
}
