/**
 * Workspaces tRPC router tests — Phase 6 Commit #12c.
 *
 * TDD: tests written before implementation.
 * Uses in-memory SQLite + Drizzle for realistic DB testing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	projects,
	type SelectWorkspace,
	settings,
	workspaces,
	worktrees,
} from "@signoff/local-db";
import { eq } from "drizzle-orm";
import {
	createTestDb,
	type TestDb,
} from "lib/trpc/routers/workspaces/utils/test-db";
import { createWorkspacesRouter } from "./index";

let db: TestDb;
let cleanup: () => void;
let router: ReturnType<typeof createWorkspacesRouter>;

const now = Date.now();

beforeEach(() => {
	const testDb = createTestDb();
	db = testDb.db;
	cleanup = testDb.cleanup;
	router = createWorkspacesRouter(() => db);
});

afterEach(() => {
	cleanup();
});

// Seed helpers
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

describe("workspaces.list", () => {
	test("returns workspaces for a project ordered by tabOrder", async () => {
		const project = seedProject();
		seedWorkspace(project.id, { tabOrder: 2, name: "C" });
		seedWorkspace(project.id, { tabOrder: 0, name: "A" });
		seedWorkspace(project.id, { tabOrder: 1, name: "B" });

		const result: SelectWorkspace[] = await router.list({
			projectId: project.id,
		});
		expect(result.map((w) => w.name)).toEqual(["A", "B", "C"]);
	});

	test("excludes workspaces with deletingAt set", async () => {
		const project = seedProject();
		seedWorkspace(project.id, { tabOrder: 0, name: "Active" });
		seedWorkspace(project.id, {
			tabOrder: 1,
			name: "Deleting",
			deletingAt: now,
		});

		const result = await router.list({ projectId: project.id });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Active");
	});

	test("returns empty array for non-existent project", async () => {
		const result = await router.list({ projectId: "non-existent" });
		expect(result).toEqual([]);
	});
});

describe("workspaces.get", () => {
	test("returns workspace with project and worktree relations", async () => {
		const project = seedProject({ name: "Proj" });
		const worktree = seedWorktree(project.id, { branch: "feat" });
		const workspace = seedWorkspace(project.id, {
			worktreeId: worktree.id,
			name: "WS",
		});

		const result = await router.get({ id: workspace.id });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("WS");
		expect(result?.project.name).toBe("Proj");
		expect(result?.worktree?.branch).toBe("feat");
	});

	test("returns undefined for non-existent workspace", async () => {
		const result = await router.get({ id: "non-existent" });
		expect(result).toBeUndefined();
	});
});

describe("workspaces.create", () => {
	test("creates a worktree workspace", async () => {
		const project = seedProject();
		const worktree = seedWorktree(project.id, { branch: "feature-x" });

		const result = await router.create({
			projectId: project.id,
			worktreeId: worktree.id,
			type: "worktree",
			branch: "feature-x",
			name: "Feature X",
		});

		expect(result.id).toBeDefined();
		expect(result.name).toBe("Feature X");
		expect(result.type).toBe("worktree");
		expect(result.projectId).toBe(project.id);
	});

	test("assigns next tabOrder within project", async () => {
		const project = seedProject();
		seedWorkspace(project.id, { tabOrder: 5 });

		const result = await router.create({
			projectId: project.id,
			type: "branch",
			branch: "main",
			name: "Main",
		});

		expect(result.tabOrder).toBe(6);
	});
});

describe("workspaces.update", () => {
	test("updates workspace name", async () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id, { name: "Old" });

		const result = await router.update({
			id: workspace.id,
			name: "New",
		});

		expect(result.name).toBe("New");
	});
});

describe("workspaces.delete", () => {
	test("removes workspace from database", async () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		await router.delete({ id: workspace.id });

		const result = db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspace.id))
			.get();
		expect(result).toBeUndefined();
	});
});

describe("workspaces.setActive", () => {
	test("sets workspace as active and updates timestamps", async () => {
		const project = seedProject();
		const workspace = seedWorkspace(project.id);

		await router.setActive({ id: workspace.id });

		const settingsRow = db
			.select()
			.from(settings)
			.where(eq(settings.id, 1))
			.get();
		expect(settingsRow?.lastActiveWorkspaceId).toBe(workspace.id);
	});

	test("activates the workspace's project", async () => {
		const project = seedProject({ lastOpenedAt: 1000 });
		const workspace = seedWorkspace(project.id);

		const before = Date.now();
		await router.setActive({ id: workspace.id });

		const updated = db
			.select()
			.from(projects)
			.where(eq(projects.id, project.id))
			.get()!;
		expect(updated.lastOpenedAt).toBeGreaterThanOrEqual(before);
	});
});

describe("workspaces.reorder", () => {
	test("reorders workspaces within a project", async () => {
		const project = seedProject();
		seedWorkspace(project.id, { id: "ws-a", tabOrder: 0, name: "A" });
		seedWorkspace(project.id, { id: "ws-b", tabOrder: 1, name: "B" });
		seedWorkspace(project.id, { id: "ws-c", tabOrder: 2, name: "C" });

		await router.reorder({
			projectId: project.id,
			fromIndex: 2,
			toIndex: 0,
		});

		const result: SelectWorkspace[] = await router.list({
			projectId: project.id,
		});
		expect(result.map((w) => w.name)).toEqual(["C", "A", "B"]);
		expect(result.map((w) => w.tabOrder)).toEqual([0, 1, 2]);
	});
});
