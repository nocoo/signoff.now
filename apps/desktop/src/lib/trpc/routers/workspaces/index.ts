/**
 * Workspaces tRPC router — CRUD for workspaces within projects.
 *
 * Uses a factory pattern: `createWorkspacesRouter(getDb)` returns
 * an object with async functions that can be tested directly.
 */

import { workspaces } from "@signoff/local-db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";
import {
	activateProject,
	getMaxProjectChildTabOrder,
	getWorkspace,
	getWorkspaceWithRelations,
	setLastActiveWorkspace,
	touchWorkspace,
} from "./utils/db-helpers";
import { reorderItems } from "./utils/reorder";

// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type GetDb = () => any;

/**
 * Creates a testable workspaces API object.
 */
export function createWorkspacesRouter(getDb: GetDb) {
	return {
		async list(input: { projectId: string }) {
			const db = getDb();
			return db.query.workspaces.findMany({
				where: and(
					eq(workspaces.projectId, input.projectId),
					isNull(workspaces.deletingAt),
				),
				orderBy: asc(workspaces.tabOrder),
				with: { worktree: true },
			});
		},

		async get(input: { id: string }) {
			const db = getDb();
			return getWorkspaceWithRelations(db, input.id);
		},

		async create(input: {
			projectId: string;
			worktreeId?: string;
			type: "worktree" | "branch";
			branch: string;
			name: string;
		}) {
			const db = getDb();
			const nextTabOrder = getMaxProjectChildTabOrder(db, input.projectId) + 1;
			const now = Date.now();

			const rows = db
				.insert(workspaces)
				.values({
					projectId: input.projectId,
					worktreeId: input.worktreeId ?? null,
					type: input.type,
					branch: input.branch,
					name: input.name,
					tabOrder: nextTabOrder,
					createdAt: now,
					updatedAt: now,
					lastOpenedAt: now,
				})
				.returning()
				.all();

			return rows[0];
		},

		async update(input: { id: string; name?: string }) {
			const db = getDb();
			const updates: Partial<typeof workspaces.$inferInsert> = {
				updatedAt: Date.now(),
			};

			if (input.name !== undefined) updates.name = input.name;

			const rows = db
				.update(workspaces)
				.set(updates)
				.where(eq(workspaces.id, input.id))
				.returning()
				.all();

			return rows[0];
		},

		async delete(input: { id: string }) {
			const db = getDb();
			db.delete(workspaces).where(eq(workspaces.id, input.id)).run();
		},

		async setActive(input: { id: string }) {
			const db = getDb();
			const workspace = getWorkspace(db, input.id);
			if (!workspace) return;

			setLastActiveWorkspace(db, workspace.id);
			touchWorkspace(db, workspace.id);
			activateProject(db, workspace.projectId);
		},

		async reorder(input: {
			projectId: string;
			fromIndex: number;
			toIndex: number;
		}) {
			const db = getDb();
			const current = db
				.select()
				.from(workspaces)
				.where(
					and(
						eq(workspaces.projectId, input.projectId),
						isNull(workspaces.deletingAt),
					),
				)
				.orderBy(asc(workspaces.tabOrder))
				.all();

			const reordered = reorderItems(current, input.fromIndex, input.toIndex);

			for (const ws of reordered) {
				const id = (ws as unknown as { id: string }).id;
				db.update(workspaces)
					.set({ tabOrder: ws.tabOrder })
					.where(eq(workspaces.id, id))
					.run();
			}

			return reordered;
		},
	};
}

// ─── tRPC router (wraps the factory functions) ─────────────────────────────

/**
 * Creates the tRPC workspaces router.
 */
export function createWorkspacesTrpcRouter(getDb: GetDb) {
	const api = createWorkspacesRouter(getDb);

	return router({
		list: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => api.list(input)),

		get: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => api.get(input)),

		create: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					worktreeId: z.string().optional(),
					type: z.enum(["worktree", "branch"]),
					branch: z.string(),
					name: z.string(),
				}),
			)
			.mutation(({ input }) => api.create(input)),

		update: publicProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string().optional(),
				}),
			)
			.mutation(({ input }) => api.update(input)),

		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => api.delete(input)),

		setActive: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => api.setActive(input)),

		reorder: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					fromIndex: z.number(),
					toIndex: z.number(),
				}),
			)
			.mutation(({ input }) => api.reorder(input)),
	});
}
