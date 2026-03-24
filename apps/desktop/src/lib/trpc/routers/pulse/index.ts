/**
 * Pulse tRPC router — provides PR scanning for projects.
 *
 * Two-layer architecture following existing pattern:
 * - Layer 1: `createPulseRouter(getDb)` — testable business logic
 * - Layer 2: `createPulseTrpcRouter(getDb)` — tRPC procedure wrappers
 *
 * Uses dynamic import for main/pulse/collect to avoid pulling pulse's entire
 * source graph into the coverage measurement at module load time. The pulse
 * package has its own coverage gate (95%); desktop tests should not re-measure it.
 */

import { projects } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";
import { clearAll, getCached, invalidate, setCached } from "./cache";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type GetDb = () => any;

/**
 * Creates a testable pulse API object.
 */
export function createPulseRouter(getDb: GetDb) {
	return {
		async fetchPrs(input: {
			projectId: string;
			state?: "open" | "closed" | "all";
			limit?: number;
			author?: string | null;
		}) {
			// Invalidate existing cache before fresh scan
			invalidate(input.projectId);

			// Resolve project path from DB
			const db = getDb();
			const project = db
				.select({ mainRepoPath: projects.mainRepoPath })
				.from(projects)
				.where(eq(projects.id, input.projectId))
				.get();

			if (!project) {
				throw new Error(`Project not found: ${input.projectId}`);
			}

			// Dynamic import to avoid pulling pulse source into coverage graph
			const { collectProjectPrs } = await import("main/pulse/collect");

			// Collect and cache
			const report = await collectProjectPrs({
				projectPath: project.mainRepoPath,
				state: input.state,
				limit: input.limit,
				author: input.author,
			});
			setCached(input.projectId, report);
			return report;
		},

		getCachedReport(input: { projectId: string }) {
			return getCached(input.projectId);
		},

		/** Test-only: clear all cached reports */
		clearCache() {
			clearAll();
		},
	};
}

/**
 * Creates the tRPC router for pulse procedures.
 */
export function createPulseTrpcRouter(getDb: GetDb) {
	const api = createPulseRouter(getDb);

	return router({
		fetchPrs: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					state: z.enum(["open", "closed", "all"]).optional().default("open"),
					limit: z.number().int().min(0).optional().default(20),
					author: z.string().nullable().optional().default(null),
				}),
			)
			.mutation(({ input }) => api.fetchPrs(input)),

		getCachedReport: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => api.getCachedReport(input)),
	});
}
