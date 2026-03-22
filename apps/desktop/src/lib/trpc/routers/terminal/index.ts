/**
 * Terminal tRPC router — PTY session lifecycle over daemon NDJSON RPC.
 *
 * Factory function receives a TerminalManager and delegates all operations.
 * The daemon handles actual PTY session management; this router is a thin proxy.
 */

import { publicProcedure, router } from "lib/trpc";
import type { TerminalManager } from "main/lib/terminal";
import { z } from "zod";

const SAFE_ID = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("/") && !value.includes("\\") && !value.includes(".."),
		{ message: "Invalid id" },
	);

/** Creates the terminal router with daemon proxy via TerminalManager. */
export function createTerminalRouter(manager: TerminalManager) {
	return router({
		createOrAttach: publicProcedure
			.input(
				z.object({
					paneId: SAFE_ID,
					tabId: z.string(),
					workspaceId: SAFE_ID,
					cols: z.number().optional(),
					rows: z.number().optional(),
					cwd: z.string().optional(),
					command: z.string().trim().min(1).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const response = await manager.createOrAttach({
					sessionId: input.paneId,
					cols: input.cols ?? 80,
					rows: input.rows ?? 24,
					workspaceId: input.workspaceId,
					paneId: input.paneId,
					tabId: input.tabId,
					cwd: input.cwd,
					command: input.command,
				});

				return {
					paneId: input.paneId,
					isNew: response.isNew,
					scrollback: "",
					wasRecovered: response.wasRecovered,
					isColdRestore: false,
					previousCwd: null,
					snapshot: response.snapshot,
				};
			}),

		write: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
					data: z.string(),
					throwOnError: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				await manager.write(input.paneId, input.data);
			}),

		resize: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
					cols: z.number(),
					rows: z.number(),
				}),
			)
			.mutation(async ({ input }) => {
				await manager.resize(input.paneId, input.cols, input.rows);
			}),

		signal: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
					signal: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				if (input.signal) {
					await manager.signal(input.paneId, input.signal);
				}
			}),

		kill: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await manager.kill(input.paneId);
			}),

		detach: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await manager.detach(input.paneId);
			}),

		clearScrollback: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await manager.clearScrollback(input.paneId);
			}),

		listDaemonSessions: publicProcedure.query(async () => {
			const result = await manager.listSessions();
			return { sessions: result.sessions };
		}),
	});
}
