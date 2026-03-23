/**
 * GitInfo tRPC router — provides per-project Git repository analysis.
 *
 * Two-layer architecture following existing pattern:
 * - Layer 1: `createGitInfoRouter(getDb)` — testable business logic
 * - Layer 2: `createGitInfoTrpcRouter(getDb)` — tRPC procedure wrappers
 */

import { projects } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import { publicProcedure, router } from "lib/trpc";
import { collectAll } from "main/gitinfo/collect";
import { z } from "zod";
import { clearAll, getCached, invalidate, setCached } from "./cache";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type GetDb = () => any;

/**
 * Creates a testable gitinfo API object.
 */
export function createGitInfoRouter(getDb: GetDb) {
	return {
		async getReport(input: { projectId: string }) {
			// Check cache first
			const cached = getCached(input.projectId);
			if (cached) return cached;

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

			// Collect and cache
			const report = await collectAll(project.mainRepoPath);
			setCached(input.projectId, report);
			return report;
		},

		async refresh(input: { projectId: string }) {
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

			// Collect fresh and cache
			const report = await collectAll(project.mainRepoPath);
			setCached(input.projectId, report);
			return report;
		},

		/** Test-only: clear all cached reports */
		clearCache() {
			clearAll();
		},
	};
}

/**
 * Creates the tRPC router for gitinfo procedures.
 */
export function createGitInfoTrpcRouter(getDb: GetDb) {
	const api = createGitInfoRouter(getDb);

	return router({
		getReport: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => api.getReport(input)),

		refresh: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(({ input }) => api.refresh(input)),
	});
}
