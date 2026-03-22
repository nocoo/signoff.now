/**
 * Terminal tRPC router — PTY session lifecycle over IPC.
 *
 * 🔴 Trimmed from superset: workspace DB lookups, DaemonTerminalManager,
 * cold restore ack, theme resolution. Phase 5 provides procedure stubs
 * with correct input validation so the type contract is stable.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

const SAFE_ID = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("/") && !value.includes("\\") && !value.includes(".."),
		{ message: "Invalid id" },
	);

/** PTY session lifecycle */
export const terminalRouter = router({
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
			// TODO Phase 6+: Connect to daemon, create/attach session
			return {
				paneId: input.paneId,
				isNew: true,
				scrollback: "",
				wasRecovered: false,
				isColdRestore: false,
				previousCwd: null,
				snapshot: null,
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
		.mutation(async () => {
			// TODO Phase 6+: Write to daemon session
		}),

	resize: publicProcedure
		.input(
			z.object({
				paneId: z.string(),
				cols: z.number(),
				rows: z.number(),
			}),
		)
		.mutation(async () => {
			// TODO Phase 6+: Resize daemon session
		}),

	signal: publicProcedure
		.input(
			z.object({
				paneId: z.string(),
				signal: z.string().optional(),
			}),
		)
		.mutation(async () => {
			// TODO Phase 6+: Send signal to daemon session
		}),

	kill: publicProcedure
		.input(
			z.object({
				paneId: z.string(),
			}),
		)
		.mutation(async () => {
			// TODO Phase 6+: Kill daemon session
		}),

	detach: publicProcedure
		.input(
			z.object({
				paneId: z.string(),
			}),
		)
		.mutation(async () => {
			// TODO Phase 6+: Detach from daemon session
		}),

	clearScrollback: publicProcedure
		.input(
			z.object({
				paneId: z.string(),
			}),
		)
		.mutation(async () => {
			// TODO Phase 6+: Clear scrollback in daemon session
		}),

	listDaemonSessions: publicProcedure.query(async () => {
		// TODO Phase 6+: List sessions from daemon
		return { sessions: [] };
	}),
});
