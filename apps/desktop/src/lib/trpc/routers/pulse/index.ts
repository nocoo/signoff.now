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
 *
 * API breaking change (v2): Replaces in-memory cache with SQLite persistence.
 * Mutations write DB and return void; views read from tRPC queries only.
 */

import { projects } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";
import {
	clearCache,
	getCachedPrDetail,
	getCachedPrs,
	getScanMeta,
	type ScanMeta,
	upsertPrDetail,
	upsertPrs,
	upsertScanMeta,
} from "./db";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type GetDb = () => any;

/**
 * Fixed page size for GitHub API fetches.
 *
 * The underlying collectProjectPrs treats limit<=0 as "fetch all pages",
 * which would defeat Load More pagination. Always request exactly one page.
 */
const PAGE_SIZE = 20;

/**
 * Creates a testable pulse API object.
 */
export function createPulseRouter(getDb: GetDb) {
	/**
	 * Resolve project mainRepoPath from DB. Throws if not found.
	 */
	function resolveProjectPath(projectId: string): string {
		const db = getDb();
		const project = db
			.select({ mainRepoPath: projects.mainRepoPath })
			.from(projects)
			.where(eq(projects.id, projectId))
			.get();

		if (!project) {
			throw new Error(`Project not found: ${projectId}`);
		}

		return project.mainRepoPath;
	}

	return {
		// ---------------------------------------------------------------
		// Queries (read from DB)
		// ---------------------------------------------------------------

		getCachedPrs(input: {
			projectId: string;
			state: "open" | "closed" | "all";
		}) {
			const db = getDb();
			return getCachedPrs(db, input.projectId, input.state);
		},

		getCachedPrDetail(input: { projectId: string; number: number }) {
			const db = getDb();
			return getCachedPrDetail(db, input.projectId, input.number);
		},

		getScanMeta(input: { projectId: string }): ScanMeta | null {
			const db = getDb();
			return getScanMeta(db, input.projectId);
		},

		// ---------------------------------------------------------------
		// Mutations (write DB, return void)
		// ---------------------------------------------------------------

		async fetchPrs(input: {
			projectId: string;
			cursor?: string | null;
		}): Promise<void> {
			const projectPath = resolveProjectPath(input.projectId);

			// Dynamic import to avoid pulling pulse source into coverage graph
			const { collectProjectPrs } = await import("main/pulse/collect");

			const report = await collectProjectPrs({
				projectPath,
				state: "all", // Always fetch all states — single canonical scan
				limit: PAGE_SIZE,
				cursor: input.cursor ?? null,
			});

			// Atomic write: list upsert + scan meta must be consistent
			const db = getDb();
			db.transaction((tx: typeof db) => {
				upsertPrs(tx, input.projectId, report.pullRequests);
				upsertScanMeta(tx, input.projectId, {
					endCursor: report.endCursor,
					hasNextPage: report.hasNextPage,
					resolvedUser: report.identity.resolvedUser,
					resolvedVia: report.identity.resolvedVia,
					repoOwner: report.repository.owner,
					repoName: report.repository.name,
				});
			});
		},

		async fetchPrDetail(input: {
			projectId: string;
			number: number;
		}): Promise<void> {
			const projectPath = resolveProjectPath(input.projectId);

			const { collectProjectPrDetail } = await import("main/pulse/collect");

			const report = await collectProjectPrDetail({
				projectPath,
				number: input.number,
			});

			// Atomic write: list row + detail row must be consistent
			const db = getDb();
			db.transaction((tx: typeof db) => {
				upsertPrDetail(tx, input.projectId, report.pullRequest);
			});
		},

		clearCache(input: { projectId: string }): void {
			const db = getDb();
			clearCache(db, input.projectId);
		},
	};
}

/**
 * Creates the tRPC router for pulse procedures.
 */
export function createPulseTrpcRouter(getDb: GetDb) {
	const api = createPulseRouter(getDb);

	return router({
		// Queries — read from DB
		getCachedPrs: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					state: z.enum(["open", "closed", "all"]),
				}),
			)
			.query(({ input }) => api.getCachedPrs(input)),

		getCachedPrDetail: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					number: z.number().int().positive(),
				}),
			)
			.query(({ input }) => api.getCachedPrDetail(input)),

		getScanMeta: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => api.getScanMeta(input)),

		// Mutations — write DB, return void
		fetchPrs: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					cursor: z.string().nullable().optional().default(null),
				}),
			)
			.mutation(({ input }) => api.fetchPrs(input)),

		fetchPrDetail: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					number: z.number().int().positive(),
				}),
			)
			.mutation(({ input }) => api.fetchPrDetail(input)),

		clearCache: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(({ input }) => api.clearCache(input)),
	});
}
