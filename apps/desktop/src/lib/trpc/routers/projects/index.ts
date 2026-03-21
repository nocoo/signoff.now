/**
 * Projects tRPC router — CRUD for local projects.
 *
 * Uses a factory pattern: `createProjectsRouter(getDb)` returns
 * an object with async functions that can be tested directly
 * or wrapped in tRPC procedures.
 */

import { projects } from "@signoff/local-db";
import { asc, eq, isNotNull } from "drizzle-orm";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";
import { getMaxProjectTabOrder } from "../workspaces/utils/db-helpers";
import { reorderItems } from "../workspaces/utils/reorder";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type GetDb = () => any;

/**
 * Creates a testable projects API object.
 * In production, `getDb` comes from `main/lib/local-db`.
 * In tests, it returns an in-memory Drizzle instance.
 */
export function createProjectsRouter(getDb: GetDb) {
	return {
		async list() {
			const db = getDb();
			return db
				.select()
				.from(projects)
				.where(isNotNull(projects.tabOrder))
				.orderBy(asc(projects.tabOrder))
				.all();
		},

		async get(input: { id: string }) {
			const db = getDb();
			return db.select().from(projects).where(eq(projects.id, input.id)).get();
		},

		async create(input: { mainRepoPath: string; name: string; color: string }) {
			const db = getDb();
			const nextTabOrder = getMaxProjectTabOrder(db) + 1;
			const now = Date.now();

			const rows = db
				.insert(projects)
				.values({
					mainRepoPath: input.mainRepoPath,
					name: input.name,
					color: input.color,
					tabOrder: nextTabOrder,
					lastOpenedAt: now,
					createdAt: now,
				})
				.returning()
				.all();

			return rows[0];
		},

		async update(input: {
			id: string;
			name?: string;
			color?: string;
			defaultBranch?: string;
		}) {
			const db = getDb();
			const updates: Partial<typeof projects.$inferInsert> = {};

			if (input.name !== undefined) updates.name = input.name;
			if (input.color !== undefined) updates.color = input.color;
			if (input.defaultBranch !== undefined)
				updates.defaultBranch = input.defaultBranch;

			const rows = db
				.update(projects)
				.set(updates)
				.where(eq(projects.id, input.id))
				.returning()
				.all();

			return rows[0];
		},

		async delete(input: { id: string }) {
			const db = getDb();
			db.delete(projects).where(eq(projects.id, input.id)).run();
		},

		async reorder(input: { fromIndex: number; toIndex: number }) {
			const db = getDb();
			// Get current ordered projects
			const current = db
				.select()
				.from(projects)
				.where(isNotNull(projects.tabOrder))
				.orderBy(asc(projects.tabOrder))
				.all();

			const reordered = reorderItems(current, input.fromIndex, input.toIndex);

			// Update tabOrder for each project
			for (const project of reordered) {
				const id = (project as unknown as { id: string }).id;
				db.update(projects)
					.set({ tabOrder: project.tabOrder })
					.where(eq(projects.id, id))
					.run();
			}

			return reordered;
		},
	};
}

// ─── tRPC router (wraps the factory functions) ─────────────────────────────

/**
 * Creates the tRPC projects router.
 * The `getDb` function is imported at call time from main/lib/local-db.
 */
export function createProjectsTrpcRouter(getDb: GetDb) {
	const api = createProjectsRouter(getDb);

	return router({
		list: publicProcedure.query(() => api.list()),

		get: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => api.get(input)),

		create: publicProcedure
			.input(
				z.object({
					mainRepoPath: z.string(),
					name: z.string(),
					color: z.string(),
				}),
			)
			.mutation(({ input }) => api.create(input)),

		update: publicProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string().optional(),
					color: z.string().optional(),
					defaultBranch: z.string().optional(),
				}),
			)
			.mutation(({ input }) => api.update(input)),

		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => api.delete(input)),

		reorder: publicProcedure
			.input(
				z.object({
					fromIndex: z.number(),
					toIndex: z.number(),
				}),
			)
			.mutation(({ input }) => api.reorder(input)),
	});
}

// Default export: stub router for backward compatibility during incremental build.
// Replace with createProjectsTrpcRouter(getDb) when the main process is wired up.
export const projectsRouter = router({});
