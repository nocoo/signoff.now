/**
 * Projects tRPC router tests — Phase 6 Commit #12c.
 *
 * TDD: tests written before implementation.
 * Uses in-memory SQLite + Drizzle for realistic DB testing.
 * Tests the router procedures via direct tRPC caller.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projects, type SelectProject } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import {
	createTestDb,
	type TestDb,
} from "lib/trpc/routers/workspaces/utils/test-db";
import { createProjectsRouter } from "./index";

let db: TestDb;
let cleanup: () => void;
let router: ReturnType<typeof createProjectsRouter>;

const now = Date.now();

beforeEach(() => {
	const testDb = createTestDb();
	db = testDb.db;
	cleanup = testDb.cleanup;
	router = createProjectsRouter(() => db);
});

afterEach(() => {
	cleanup();
});

// Helper to seed a project directly via DB
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

describe("projects.list", () => {
	test("returns empty array when no projects exist", async () => {
		const result = await router.list();
		expect(result).toEqual([]);
	});

	test("returns projects ordered by tabOrder", async () => {
		seedProject({ id: "p1", tabOrder: 2, name: "Second" });
		seedProject({
			id: "p2",
			tabOrder: 0,
			name: "First",
			mainRepoPath: "/tmp/r2",
		});
		seedProject({
			id: "p3",
			tabOrder: 1,
			name: "Middle",
			mainRepoPath: "/tmp/r3",
		});

		const result: SelectProject[] = await router.list();
		expect(result.map((p) => p.name)).toEqual(["First", "Middle", "Second"]);
	});

	test("excludes projects with null tabOrder (hidden)", async () => {
		seedProject({ id: "p1", tabOrder: 0, name: "Visible" });
		seedProject({
			id: "p2",
			tabOrder: null,
			name: "Hidden",
			mainRepoPath: "/tmp/r2",
		});

		const result = await router.list();
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Visible");
	});
});

describe("projects.get", () => {
	test("returns project by ID", async () => {
		const project = seedProject({ name: "My Project" });
		const result = await router.get({ id: project.id });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("My Project");
	});

	test("returns null for non-existent project", async () => {
		const result = await router.get({ id: "non-existent" });
		expect(result).toBeUndefined();
	});
});

describe("projects.create", () => {
	test("creates a project with required fields", async () => {
		const result = await router.create({
			mainRepoPath: "/home/user/my-repo",
			name: "New Project",
			color: "#3b82f6",
		});

		expect(result.id).toBeDefined();
		expect(result.name).toBe("New Project");
		expect(result.color).toBe("#3b82f6");
		expect(result.mainRepoPath).toBe("/home/user/my-repo");
	});

	test("assigns next tabOrder", async () => {
		seedProject({ tabOrder: 3 });

		const result = await router.create({
			mainRepoPath: "/tmp/new-repo",
			name: "New",
			color: "default",
		});

		expect(result.tabOrder).toBe(4);
	});
});

describe("projects.update", () => {
	test("updates project name", async () => {
		const project = seedProject({ name: "Old Name" });

		const result = await router.update({
			id: project.id,
			name: "New Name",
		});

		expect(result.name).toBe("New Name");
	});

	test("updates project color", async () => {
		const project = seedProject({ color: "default" });

		const result = await router.update({
			id: project.id,
			color: "#ef4444",
		});

		expect(result.color).toBe("#ef4444");
	});
});

describe("projects.delete", () => {
	test("removes project from database", async () => {
		const project = seedProject();

		await router.delete({ id: project.id });

		const result = db
			.select()
			.from(projects)
			.where(eq(projects.id, project.id))
			.get();
		expect(result).toBeUndefined();
	});
});

describe("projects.reorder", () => {
	test("reorders projects and updates tabOrder", async () => {
		seedProject({
			id: "p1",
			tabOrder: 0,
			name: "A",
			mainRepoPath: "/tmp/a",
		});
		seedProject({
			id: "p2",
			tabOrder: 1,
			name: "B",
			mainRepoPath: "/tmp/b",
		});
		seedProject({
			id: "p3",
			tabOrder: 2,
			name: "C",
			mainRepoPath: "/tmp/c",
		});

		// Move C (index 2) to first position (index 0)
		await router.reorder({ fromIndex: 2, toIndex: 0 });

		const result: SelectProject[] = await router.list();
		expect(result.map((p) => p.name)).toEqual(["C", "A", "B"]);
		expect(result.map((p) => p.tabOrder)).toEqual([0, 1, 2]);
	});
});
