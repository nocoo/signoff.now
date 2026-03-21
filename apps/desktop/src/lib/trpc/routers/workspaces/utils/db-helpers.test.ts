/**
 * Database helper utilities tests — Phase 6 Commit #12b.
 *
 * TDD: tests written before implementation.
 * Uses in-memory SQLite + Drizzle for realistic DB testing.
 *
 * Tests cover:
 * - setLastActiveWorkspace
 * - getMaxProjectChildTabOrder / getMaxProjectTabOrder
 * - activateProject / hideProject
 * - getWorkspace / getProject / getWorktree
 * - getWorkspaceWithRelations
 * - touchWorkspace
 * - markWorkspaceAsDeleting / clearWorkspaceDeletingStatus
 * - deleteWorkspace / deleteWorktreeRecord
 * - selectNextActiveWorkspace
 * - getBranchWorkspace
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projects, settings, workspaces, worktrees } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import {
	activateProject,
	clearWorkspaceDeletingStatus,
	deleteWorkspace,
	deleteWorktreeRecord,
	getBranchWorkspace,
	getMaxProjectChildTabOrder,
	getMaxProjectTabOrder,
	getProject,
	getWorkspace,
	getWorkspaceWithRelations,
	getWorktree,
	hideProject,
	markWorkspaceAsDeleting,
	selectNextActiveWorkspace,
	setLastActiveWorkspace,
	touchWorkspace,
} from "./db-helpers";
import { createTestDb, type TestDb } from "./test-db";

let db: TestDb;
let cleanup: () => void;

// Seed data helpers
const now = Date.now();

function seedProject(
	overrides: Partial<typeof projects.$inferInsert> = {},
): typeof projects.$inferSelect {
	const data = {
		id: `proj-${Math.random().toString(36).slice(2, 8)}`,
		mainRepoPath: "/tmp/test-repo",
		name: "Test Project",
		color: "default",
		tabOrder: 0,
		lastOpenedAt: now,
		createdAt: now,
		...overrides,
	};
	db.insert(projects).values(data).run();
	return db.select().from(projects).where(eq(projects.id, data.id)).get()!;
}

function seedWorktree(
	projectId: string,
	overrides: Partial<typeof worktrees.$inferInsert> = {},
): typeof worktrees.$inferSelect {
	const data = {
		id: `wt-${Math.random().toString(36).slice(2, 8)}`,
		projectId,
		path: "/tmp/test-worktree",
		branch: "main",
		createdAt: now,
		...overrides,
	};
	db.insert(worktrees).values(data).run();
	return db.select().from(worktrees).where(eq(worktrees.id, data.id)).get()!;
}

function seedWorkspace(
	projectId: string,
	overrides: Partial<typeof workspaces.$inferInsert> = {},
): typeof workspaces.$inferSelect {
	const data = {
		id: `ws-${Math.random().toString(36).slice(2, 8)}`,
		projectId,
		type: "worktree" as const,
		branch: "main",
		name: "Test Workspace",
		tabOrder: 0,
		createdAt: now,
		updatedAt: now,
		lastOpenedAt: now,
		...overrides,
	};
	db.insert(workspaces).values(data).run();
	return db.select().from(workspaces).where(eq(workspaces.id, data.id)).get()!;
}

beforeEach(() => {
	const testDb = createTestDb();
	db = testDb.db;
	cleanup = testDb.cleanup;
});

afterEach(() => {
	cleanup();
});

// ─── setLastActiveWorkspace ─────────────────────────────────────────────────

describe("setLastActiveWorkspace", () => {
	test("sets the last active workspace ID in settings", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		setLastActiveWorkspace(db, workspace.id);

		const row = db.select().from(settings).where(eq(settings.id, 1)).get();
		expect(row?.lastActiveWorkspaceId).toBe(workspace.id);
	});

	test("updates existing settings row", () => {
		const project = seedProject();
		const ws1 = seedWorkspace(project.id, { id: "ws-1" });
		const ws2 = seedWorkspace(project.id, { id: "ws-2", tabOrder: 1 });

		setLastActiveWorkspace(db, ws1.id);
		setLastActiveWorkspace(db, ws2.id);

		const row = db.select().from(settings).where(eq(settings.id, 1)).get();
		expect(row?.lastActiveWorkspaceId).toBe(ws2.id);
	});

	test("sets to null to clear active workspace", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		setLastActiveWorkspace(db, workspace.id);
		setLastActiveWorkspace(db, null);

		const row = db.select().from(settings).where(eq(settings.id, 1)).get();
		expect(row?.lastActiveWorkspaceId).toBeNull();
	});
});

// ─── getMaxProjectChildTabOrder ─────────────────────────────────────────────

describe("getMaxProjectChildTabOrder", () => {
	test("returns 0 when project has no workspaces", () => {
		const project = seedProject();
		expect(getMaxProjectChildTabOrder(db, project.id)).toBe(0);
	});

	test("returns max tabOrder of workspaces in project", () => {
		const project = seedProject();
		seedWorkspace(project.id, { tabOrder: 5 });
		seedWorkspace(project.id, { tabOrder: 10 });
		seedWorkspace(project.id, { tabOrder: 3 });

		expect(getMaxProjectChildTabOrder(db, project.id)).toBe(10);
	});

	test("ignores workspaces from other projects", () => {
		const p1 = seedProject({ id: "p1" });
		const p2 = seedProject({ id: "p2", mainRepoPath: "/tmp/other" });

		seedWorkspace(p1.id, { tabOrder: 5 });
		seedWorkspace(p2.id, { tabOrder: 100 });

		expect(getMaxProjectChildTabOrder(db, p1.id)).toBe(5);
	});
});

// ─── getMaxProjectTabOrder ──────────────────────────────────────────────────

describe("getMaxProjectTabOrder", () => {
	test("returns 0 when no projects exist", () => {
		expect(getMaxProjectTabOrder(db)).toBe(0);
	});

	test("returns max tabOrder among all projects", () => {
		seedProject({ id: "p1", tabOrder: 2 });
		seedProject({ id: "p2", mainRepoPath: "/tmp/r2", tabOrder: 7 });
		seedProject({ id: "p3", mainRepoPath: "/tmp/r3", tabOrder: 4 });

		expect(getMaxProjectTabOrder(db)).toBe(7);
	});

	test("handles null tabOrder values", () => {
		seedProject({ id: "p1", tabOrder: null });
		seedProject({ id: "p2", mainRepoPath: "/tmp/r2", tabOrder: 3 });

		expect(getMaxProjectTabOrder(db)).toBe(3);
	});
});

// ─── activateProject ────────────────────────────────────────────────────────

describe("activateProject", () => {
	test("updates lastOpenedAt to current time", () => {
		const project = seedProject({ lastOpenedAt: 1000 });

		const before = Date.now();
		activateProject(db, project.id);
		const after = Date.now();

		const updated = db
			.select()
			.from(projects)
			.where(eq(projects.id, project.id))
			.get()!;
		expect(updated.lastOpenedAt).toBeGreaterThanOrEqual(before);
		expect(updated.lastOpenedAt).toBeLessThanOrEqual(after);
	});
});

// ─── hideProject ────────────────────────────────────────────────────────────

describe("hideProject", () => {
	test("sets tabOrder to null", () => {
		const project = seedProject({ tabOrder: 5 });

		hideProject(db, project.id);

		const updated = db
			.select()
			.from(projects)
			.where(eq(projects.id, project.id))
			.get()!;
		expect(updated.tabOrder).toBeNull();
	});
});

// ─── getWorkspace / getProject / getWorktree ────────────────────────────────

describe("getWorkspace", () => {
	test("returns workspace by ID", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id, { name: "My WS" });

		const result = getWorkspace(db, workspace.id);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("My WS");
	});

	test("returns undefined for non-existent ID", () => {
		expect(getWorkspace(db, "non-existent")).toBeUndefined();
	});
});

describe("getProject", () => {
	test("returns project by ID", () => {
		const project = seedProject({ name: "My Project" });

		const result = getProject(db, project.id);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("My Project");
	});

	test("returns undefined for non-existent ID", () => {
		expect(getProject(db, "non-existent")).toBeUndefined();
	});
});

describe("getWorktree", () => {
	test("returns worktree by ID", () => {
		const project = seedProject();
		const worktree = seedWorktree(project.id, { branch: "feature-x" });

		const result = getWorktree(db, worktree.id);
		expect(result).not.toBeNull();
		expect(result?.branch).toBe("feature-x");
	});

	test("returns undefined for non-existent ID", () => {
		expect(getWorktree(db, "non-existent")).toBeUndefined();
	});
});

// ─── getWorkspaceWithRelations ──────────────────────────────────────────────

describe("getWorkspaceWithRelations", () => {
	test("returns workspace with project and worktree relations", () => {
		const project = seedProject({ name: "Proj" });
		const worktree = seedWorktree(project.id, { branch: "feat" });
		const workspace = seedWorkspace(project.id, {
			worktreeId: worktree.id,
			name: "WS",
		});

		const result = getWorkspaceWithRelations(db, workspace.id);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("WS");
		expect(result?.project.name).toBe("Proj");
		expect(result?.worktree).not.toBeNull();
		expect(result?.worktree?.branch).toBe("feat");
	});

	test("returns undefined for non-existent workspace", () => {
		expect(getWorkspaceWithRelations(db, "non-existent")).toBeUndefined();
	});
});

// ─── touchWorkspace ─────────────────────────────────────────────────────────

describe("touchWorkspace", () => {
	test("updates lastOpenedAt and updatedAt", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id, {
			lastOpenedAt: 1000,
			updatedAt: 1000,
		});

		const before = Date.now();
		touchWorkspace(db, workspace.id);
		const after = Date.now();

		const updated = db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspace.id))
			.get()!;
		expect(updated.lastOpenedAt).toBeGreaterThanOrEqual(before);
		expect(updated.lastOpenedAt).toBeLessThanOrEqual(after);
		expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
	});
});

// ─── markWorkspaceAsDeleting / clearWorkspaceDeletingStatus ─────────────────

describe("markWorkspaceAsDeleting", () => {
	test("sets deletingAt to current time", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		const before = Date.now();
		markWorkspaceAsDeleting(db, workspace.id);
		const after = Date.now();

		const updated = db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspace.id))
			.get()!;
		expect(updated.deletingAt).toBeGreaterThanOrEqual(before);
		expect(updated.deletingAt).toBeLessThanOrEqual(after);
	});
});

describe("clearWorkspaceDeletingStatus", () => {
	test("clears deletingAt back to null", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		markWorkspaceAsDeleting(db, workspace.id);
		clearWorkspaceDeletingStatus(db, workspace.id);

		const updated = db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspace.id))
			.get()!;
		expect(updated.deletingAt).toBeNull();
	});
});

// ─── deleteWorkspace / deleteWorktreeRecord ─────────────────────────────────

describe("deleteWorkspace", () => {
	test("removes workspace from database", () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		deleteWorkspace(db, workspace.id);

		const result = db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspace.id))
			.get();
		expect(result).toBeUndefined();
	});
});

describe("deleteWorktreeRecord", () => {
	test("removes worktree from database", () => {
		const project = seedProject();
		const worktree = seedWorktree(project.id);

		deleteWorktreeRecord(db, worktree.id);

		const result = db
			.select()
			.from(worktrees)
			.where(eq(worktrees.id, worktree.id))
			.get();
		expect(result).toBeUndefined();
	});
});

// ─── selectNextActiveWorkspace ──────────────────────────────────────────────

describe("selectNextActiveWorkspace", () => {
	test("returns most recently opened workspace in same project", () => {
		const project = seedProject();
		const ws1 = seedWorkspace(project.id, {
			id: "ws-old",
			lastOpenedAt: 1000,
			tabOrder: 0,
		});
		const _ws2 = seedWorkspace(project.id, {
			id: "ws-new",
			lastOpenedAt: 2000,
			tabOrder: 1,
		});

		const next = selectNextActiveWorkspace(db, project.id, ws1.id);
		expect(next).not.toBeNull();
		expect(next?.id).toBe("ws-new");
	});

	test("excludes the specified workspace from candidates", () => {
		const project = seedProject();
		const ws1 = seedWorkspace(project.id, {
			id: "ws-exclude",
			lastOpenedAt: 9999,
			tabOrder: 0,
		});
		const _ws2 = seedWorkspace(project.id, {
			id: "ws-keep",
			lastOpenedAt: 1000,
			tabOrder: 1,
		});

		const next = selectNextActiveWorkspace(db, project.id, ws1.id);
		expect(next?.id).toBe("ws-keep");
	});

	test("excludes workspaces with deletingAt set", () => {
		const project = seedProject();
		const ws1 = seedWorkspace(project.id, {
			id: "ws-current",
			lastOpenedAt: 1000,
			tabOrder: 0,
		});
		const _ws2 = seedWorkspace(project.id, {
			id: "ws-deleting",
			lastOpenedAt: 9999,
			deletingAt: now,
			tabOrder: 1,
		});
		const _ws3 = seedWorkspace(project.id, {
			id: "ws-alive",
			lastOpenedAt: 500,
			tabOrder: 2,
		});

		const next = selectNextActiveWorkspace(db, project.id, ws1.id);
		expect(next?.id).toBe("ws-alive");
	});

	test("returns undefined when no other workspaces exist", () => {
		const project = seedProject();
		const ws = seedWorkspace(project.id, { id: "ws-only" });

		const next = selectNextActiveWorkspace(db, project.id, ws.id);
		expect(next).toBeUndefined();
	});
});

// ─── getBranchWorkspace ─────────────────────────────────────────────────────

describe("getBranchWorkspace", () => {
	test("returns branch workspace for project", () => {
		const project = seedProject();
		seedWorkspace(project.id, {
			type: "branch",
			branch: "main",
			name: "Main Branch",
		});

		const result = getBranchWorkspace(db, project.id);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("branch");
		expect(result?.name).toBe("Main Branch");
	});

	test("returns undefined when no branch workspace exists", () => {
		const project = seedProject();
		seedWorkspace(project.id, { type: "worktree" });

		const result = getBranchWorkspace(db, project.id);
		expect(result).toBeUndefined();
	});
});
