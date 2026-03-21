/**
 * Database helper utilities for workspace/project management.
 *
 * All functions take a Drizzle `db` instance as the first argument
 * (dependency injection) instead of using a module-level singleton.
 * This enables testing with in-memory SQLite databases.
 */

import { projects, settings, workspaces, worktrees } from "@signoff/local-db";
import { and, desc, eq, isNull, max, ne } from "drizzle-orm";
import type { TestDb } from "./test-db";

// Use the TestDb type (which is the Drizzle BunSQLite instance with schema).
// In production code, the caller will pass `getDb()` which returns a
// compatible Drizzle instance (better-sqlite3 driver).
// biome-ignore lint/suspicious/noExplicitAny: DB driver polymorphism
type Db = TestDb | any;

// ─── Settings ───────────────────────────────────────────────────────────────

/**
 * Sets the last active workspace ID in the settings table.
 */
export function setLastActiveWorkspace(
	db: Db,
	workspaceId: string | null,
): void {
	db.update(settings)
		.set({ lastActiveWorkspaceId: workspaceId })
		.where(eq(settings.id, 1))
		.run();
}

// ─── Tab ordering ───────────────────────────────────────────────────────────

/**
 * Returns the maximum tabOrder among workspaces belonging to a project.
 * Returns 0 if no workspaces exist.
 */
export function getMaxProjectChildTabOrder(db: Db, projectId: string): number {
	const result = db
		.select({ maxOrder: max(workspaces.tabOrder) })
		.from(workspaces)
		.where(eq(workspaces.projectId, projectId))
		.get();
	return result?.maxOrder ?? 0;
}

/**
 * Returns the maximum tabOrder among all projects.
 * Returns 0 if no projects exist.
 */
export function getMaxProjectTabOrder(db: Db): number {
	const result = db
		.select({ maxOrder: max(projects.tabOrder) })
		.from(projects)
		.get();
	return result?.maxOrder ?? 0;
}

// ─── Project lifecycle ──────────────────────────────────────────────────────

/**
 * Updates a project's lastOpenedAt to the current time.
 */
export function activateProject(db: Db, projectId: string): void {
	db.update(projects)
		.set({ lastOpenedAt: Date.now() })
		.where(eq(projects.id, projectId))
		.run();
}

/**
 * Hides a project by setting its tabOrder to null.
 * The project remains in the database but won't appear in the sidebar.
 */
export function hideProject(db: Db, projectId: string): void {
	db.update(projects)
		.set({ tabOrder: null })
		.where(eq(projects.id, projectId))
		.run();
}

// ─── Entity lookups ─────────────────────────────────────────────────────────

/**
 * Returns a workspace by ID, or undefined if not found.
 */
export function getWorkspace(db: Db, workspaceId: string) {
	return db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
}

/**
 * Returns a project by ID, or undefined if not found.
 */
export function getProject(db: Db, projectId: string) {
	return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

/**
 * Returns a worktree by ID, or undefined if not found.
 */
export function getWorktree(db: Db, worktreeId: string) {
	return db.select().from(worktrees).where(eq(worktrees.id, worktreeId)).get();
}

/**
 * Returns a workspace with its project and worktree relations.
 * Uses Drizzle relational query API with `.sync()` for synchronous execution.
 */
export function getWorkspaceWithRelations(db: Db, workspaceId: string) {
	return db.query.workspaces
		.findFirst({
			where: eq(workspaces.id, workspaceId),
			with: {
				project: true,
				worktree: true,
			},
		})
		.sync();
}

// ─── Workspace mutations ────────────────────────────────────────────────────

/**
 * Updates a workspace's lastOpenedAt and updatedAt to the current time.
 */
export function touchWorkspace(db: Db, workspaceId: string): void {
	const now = Date.now();
	db.update(workspaces)
		.set({ lastOpenedAt: now, updatedAt: now })
		.where(eq(workspaces.id, workspaceId))
		.run();
}

/**
 * Marks a workspace as being deleted by setting deletingAt to the current time.
 * Workspaces with deletingAt set should be filtered out from most queries.
 */
export function markWorkspaceAsDeleting(db: Db, workspaceId: string): void {
	db.update(workspaces)
		.set({ deletingAt: Date.now() })
		.where(eq(workspaces.id, workspaceId))
		.run();
}

/**
 * Clears the deletingAt flag, cancelling the deletion process.
 */
export function clearWorkspaceDeletingStatus(
	db: Db,
	workspaceId: string,
): void {
	db.update(workspaces)
		.set({ deletingAt: null })
		.where(eq(workspaces.id, workspaceId))
		.run();
}

/**
 * Permanently removes a workspace from the database.
 */
export function deleteWorkspace(db: Db, workspaceId: string): void {
	db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
}

/**
 * Permanently removes a worktree record from the database.
 */
export function deleteWorktreeRecord(db: Db, worktreeId: string): void {
	db.delete(worktrees).where(eq(worktrees.id, worktreeId)).run();
}

// ─── Workspace selection ────────────────────────────────────────────────────

/**
 * Selects the next active workspace in a project, excluding the specified workspace
 * and any workspaces currently being deleted.
 * Returns the most recently opened workspace, or undefined if none available.
 */
export function selectNextActiveWorkspace(
	db: Db,
	projectId: string,
	excludeWorkspaceId: string,
) {
	return db
		.select()
		.from(workspaces)
		.where(
			and(
				eq(workspaces.projectId, projectId),
				ne(workspaces.id, excludeWorkspaceId),
				isNull(workspaces.deletingAt),
			),
		)
		.orderBy(desc(workspaces.lastOpenedAt))
		.limit(1)
		.get();
}

// ─── Branch workspace ───────────────────────────────────────────────────────

/**
 * Returns the branch-type workspace for a project, or undefined if not found.
 * Each project can have at most one branch workspace.
 */
export function getBranchWorkspace(db: Db, projectId: string) {
	return db
		.select()
		.from(workspaces)
		.where(
			and(eq(workspaces.projectId, projectId), eq(workspaces.type, "branch")),
		)
		.get();
}
