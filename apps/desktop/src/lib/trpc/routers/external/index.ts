/**
 * External tRPC router — open files/URLs in external applications.
 *
 * Factory function receives shell operations (Electron shell API)
 * and exposes openInFinder, openUrl, and openInEditor mutations.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

/** Shape of the shell operations provider injected at startup. */
export interface ShellOps {
	showItemInFolder: (fullPath: string) => void;
	openExternal: (url: string) => Promise<void>;
}

/** Creates the external router with the given shell operations. */
export function createExternalRouter(shellOps: ShellOps) {
	return router({
		openInFinder: publicProcedure
			.input(z.object({ path: z.string().min(1) }))
			.mutation(({ input }) => {
				shellOps.showItemInFolder(input.path);
			}),

		openUrl: publicProcedure
			.input(
				z.object({
					url: z.string().url(),
				}),
			)
			.mutation(async ({ input }) => {
				await shellOps.openExternal(input.url);
			}),

		openInEditor: publicProcedure
			.input(
				z.object({
					path: z.string().min(1),
					editor: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				// Default: open with system default application
				await shellOps.openExternal(`file://${input.path}`);
			}),
	});
}
