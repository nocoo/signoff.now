/**
 * L3 E2E Test — Project CRUD Full Lifecycle
 *
 * Comprehensive end-to-end test covering the complete project CRUD workflow
 * with real in-memory SQLite. Tests the full user journey from creation to deletion,
 * including edge cases and error conditions.
 *
 * Coverage:
 * - CREATE: Multiple projects with different configurations
 * - READ: List all projects, get single project by ID
 * - UPDATE: Name, color, defaultBranch updates
 * - DELETE: Remove projects and cascade cleanup
 * - REORDER: Tab order reordering with edge cases
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects } from "@signoff/local-db";
import { eq } from "drizzle-orm";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "@signoff/local-db";
import { createProjectsRouter } from "../../routers/projects";

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS projects (
	id text PRIMARY KEY NOT NULL,
	main_repo_path text NOT NULL,
	name text NOT NULL,
	color text NOT NULL,
	tab_order integer,
	last_opened_at integer NOT NULL,
	created_at integer NOT NULL,
	config_toast_dismissed integer,
	default_branch text,
	workspace_base_branch text,
	github_owner text,
	branch_prefix_mode text,
	branch_prefix_custom text,
	worktree_base_dir text,
	hide_image integer,
	icon_url text,
	default_app text
);

CREATE INDEX IF NOT EXISTS projects_main_repo_path_idx ON projects (main_repo_path);
CREATE INDEX IF NOT EXISTS projects_last_opened_at_idx ON projects (last_opened_at);
`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database;
let tmpRepo: string;
let router: ReturnType<typeof createProjectsRouter>;

function getDb() {
	return db;
}

function setupFreshDb() {
	sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA foreign_keys = ON");
	sqlite.exec(CREATE_TABLES_SQL);
	db = drizzle(sqlite, { schema });
	router = createProjectsRouter(getDb);
}

function cleanupDb() {
	sqlite.close();
}

// Set up temp repos once for all tests
const tempRepos: string[] = [];

function getTmpRepo(): string {
	if (tempRepos.length === 0) {
		const tmp = join(
			tmpdir(),
			`signoff-l3-projects-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		mkdirSync(join(tmp, "project-a"), { recursive: true });
		mkdirSync(join(tmp, "project-b"), { recursive: true });
		writeFileSync(join(tmp, "project-a", "README.md"), "# Project A\n");
		writeFileSync(join(tmp, "project-b", "README.md"), "# Project B\n");
		tempRepos.push(tmp);
	}
	return tempRepos[0];
}

function cleanupTempRepos() {
	for (const tmp of tempRepos) {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
	tempRepos.length = 0;
}

// Clean up temp repos after all tests
cleanupTempRepos();

// ─── CREATE ───────────────────────────────────────────────────────

describe("L3 E2E: Project CREATE operations", () => {
	beforeEach(() => {
		setupFreshDb();
		tmpRepo = getTmpRepo();
	});
	afterEach(cleanupDb);

	test("creates a single project with all required fields", async () => {
		const created = await router.create({
			mainRepoPath: join(tmpRepo, "project-a"),
			name: "Project Alpha",
			color: "#3b82f6",
		});

		expect(created).toBeDefined();
		expect(created.id).toBeTruthy();
		expect(created.name).toBe("Project Alpha");
		expect(created.color).toBe("#3b82f6");
		expect(created.tabOrder).toBe(1); // max(NULL)+1 = 0+1 = 1
		expect(created.lastOpenedAt).toBeGreaterThan(0);
		expect(created.createdAt).toBeGreaterThan(0);
	});

	test("assigns sequential tabOrder for multiple projects", async () => {
		const p1 = await router.create({
			mainRepoPath: join(tmpRepo, "project-b"),
			name: "Project Beta",
			color: "#22c55e",
		});

		const p2 = await router.create({
			mainRepoPath: "/tmp/another-repo",
			name: "Project Gamma",
			color: "#ef4444",
		});

		const p3 = await router.create({
			mainRepoPath: "/tmp/yet-another",
			name: "Project Delta",
			color: "#f59e0b",
		});

		expect(p1.tabOrder).toBe(1); // First project gets max(NULL)+1 = 1
		expect(p2.tabOrder).toBe(2); // Second gets max(1)+1 = 2
		expect(p3.tabOrder).toBe(3); // Third gets max(2)+1 = 3
	});

	test("stores project in database correctly", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/db-test",
			name: "DB Test",
			color: "#8b5cf6",
		});

		const direct = db
			.select()
			.from(projects)
			.where(eq(projects.id, created.id))
			.get();

		expect(direct).toBeDefined();
		expect(direct?.name).toBe("DB Test");
		expect(direct?.mainRepoPath).toBe("/tmp/db-test");
	});

	test("generates unique IDs for each project", async () => {
		const p1 = await router.create({
			mainRepoPath: "/tmp/p1",
			name: "P1",
			color: "#111",
		});
		const p2 = await router.create({
			mainRepoPath: "/tmp/p2",
			name: "P2",
			color: "#222",
		});

		expect(p1.id).not.toBe(p2.id);
		expect(p1.id).toBeTruthy();
		expect(p2.id).toBeTruthy();
	});

	test("sets lastOpenedAt and createdAt to current timestamp", async () => {
		const beforeCreate = Date.now();
		const created = await router.create({
			mainRepoPath: "/tmp/timestamps",
			name: "Timestamp Test",
			color: "#000",
		});
		const afterCreate = Date.now();

		expect(created.lastOpenedAt).toBeGreaterThanOrEqual(beforeCreate);
		expect(created.lastOpenedAt).toBeLessThanOrEqual(afterCreate);
		expect(created.createdAt).toBeGreaterThanOrEqual(beforeCreate);
		expect(created.createdAt).toBeLessThanOrEqual(afterCreate);
	});
});

// ─── READ ────────────────────────────────────────────────────────

describe("L3 E2E: Project READ operations", () => {
	beforeEach(() => {
		setupFreshDb();
		tmpRepo = getTmpRepo();
	});
	afterEach(cleanupDb);

	test("lists empty array when no projects exist", async () => {
		const list = await router.list();
		expect(list).toEqual([]);
	});

	test("lists all projects ordered by tabOrder", async () => {
		// Create projects with specific tabOrder by creating in order
		await router.create({
			mainRepoPath: "/tmp/z-last",
			name: "Z Last",
			color: "#000",
		});
		await router.create({
			mainRepoPath: "/tmp/a-first",
			name: "A First",
			color: "#000",
		});
		await router.create({
			mainRepoPath: "/tmp/m-middle",
			name: "M Middle",
			color: "#000",
		});

		const list = await router.list();
		expect(list).toHaveLength(3);

		// Verify ordering by tabOrder (creation order), not name
		const names = list.map((p: { name: string }) => p.name);
		expect(names).toEqual(["Z Last", "A First", "M Middle"]);
	});

	test("excludes projects with null tabOrder from list", async () => {
		// Create a project
		const created = await router.create({
			mainRepoPath: "/tmp/visible",
			name: "Visible Project",
			color: "#000",
		});

		// Directly set tabOrder to null to simulate hiding
		db.update(projects)
			.set({ tabOrder: null })
			.where(eq(projects.id, created.id))
			.run();

		const list = await router.list();
		const visible = list.find((p: { id: string }) => p.id === created.id);
		expect(visible).toBeUndefined();
		expect(list).toHaveLength(0);
	});

	test("gets a single project by ID", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/get-test",
			name: "Get Test",
			color: "#ec4899",
		});

		const found = await router.get({ id: created.id });
		expect(found).toBeDefined();
		expect(found?.id).toBe(created.id);
		expect(found?.name).toBe("Get Test");
		expect(found?.mainRepoPath).toBe("/tmp/get-test");
	});

	test("returns undefined for non-existent project ID", async () => {
		const found = await router.get({ id: "non-existent-id" });
		expect(found).toBeUndefined();
	});

	test("returns undefined for empty string ID", async () => {
		const found = await router.get({ id: "" });
		expect(found).toBeUndefined();
	});

	test("returns all project fields including optional ones", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/full-fields",
			name: "Full Fields",
			color: "#000",
		});

		const found = await router.get({ id: created.id });
		expect(found?.id).toBeTruthy();
		expect(found?.mainRepoPath).toBe("/tmp/full-fields");
		expect(found?.name).toBe("Full Fields");
		expect(found?.color).toBe("#000");
		expect(found?.tabOrder).toBe(1); // First project gets tabOrder=1
		expect(found?.lastOpenedAt).toBeGreaterThan(0);
		expect(found?.createdAt).toBeGreaterThan(0);
		expect(found?.defaultBranch).toBeNull();
	});
});

// ─── UPDATE ───────────────────────────────────────────────────────

describe("L3 E2E: Project UPDATE operations", () => {
	beforeEach(setupFreshDb);
	afterEach(cleanupDb);

	test("updates project name", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/update-test",
			name: "Original Name",
			color: "#000000",
		});

		const updated = await router.update({
			id: created.id,
			name: "Updated Name",
		});

		expect(updated.name).toBe("Updated Name");
		expect(updated.id).toBe(created.id);

		// Verify persistence
		const found = await router.get({ id: created.id });
		expect(found?.name).toBe("Updated Name");
	});

	test("updates project color", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/color-test",
			name: "Color Test",
			color: "#000000",
		});

		const updated = await router.update({
			id: created.id,
			color: "#ff0000",
		});

		expect(updated.color).toBe("#ff0000");

		const found = await router.get({ id: created.id });
		expect(found?.color).toBe("#ff0000");
	});

	test("sets default branch", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/branch-test",
			name: "Branch Test",
			color: "#000",
		});

		const updated = await router.update({
			id: created.id,
			defaultBranch: "main",
		});

		expect(updated.defaultBranch).toBe("main");

		const found = await router.get({ id: created.id });
		expect(found?.defaultBranch).toBe("main");
	});

	test("updates multiple fields at once", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/multi-test",
			name: "Original",
			color: "#000",
		});

		const updated = await router.update({
			id: created.id,
			name: "Multi Update",
			color: "#00ff00",
			defaultBranch: "develop",
		});

		expect(updated.name).toBe("Multi Update");
		expect(updated.color).toBe("#00ff00");
		expect(updated.defaultBranch).toBe("develop");
	});

	test("changing default branch from null to value", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/branch-change",
			name: "Branch Change",
			color: "#000",
		});

		expect(created.defaultBranch).toBeNull();

		const updated = await router.update({
			id: created.id,
			defaultBranch: "main",
		});

		expect(updated.defaultBranch).toBe("main");
	});

	test("does not modify unspecified fields", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/preserve",
			name: "Preserve Name",
			color: "#123456",
		});

		const updated = await router.update({
			id: created.id,
			name: "New Name",
		});

		expect(updated.name).toBe("New Name");
		expect(updated.color).toBe("#123456"); // Unchanged
		expect(updated.tabOrder).toBe(created.tabOrder); // Unchanged
	});

	test("returns undefined when updating non-existent project", async () => {
		const updated = await router.update({
			id: "does-not-exist",
			name: "Should Not Work",
		});

		expect(updated).toBeUndefined();
	});
});

// ─── DELETE ───────────────────────────────────────────────────────

describe("L3 E2E: Project DELETE operations", () => {
	beforeEach(setupFreshDb);
	afterEach(cleanupDb);

	test("deletes a project by ID", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/delete-test",
			name: "Delete Me",
			color: "#ff00ff",
		});

		// Verify exists before delete
		const before = await router.get({ id: created.id });
		expect(before).toBeDefined();

		// Delete
		await router.delete({ id: created.id });

		// Verify gone after delete
		const after = await router.get({ id: created.id });
		expect(after).toBeUndefined();
	});

	test("removes project from database completely", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/complete-delete",
			name: "Complete Delete",
			color: "#00ffff",
		});

		// Verify in DB
		const before = db
			.select()
			.from(projects)
			.where(eq(projects.id, created.id))
			.get();
		expect(before).toBeDefined();

		// Delete via router
		await router.delete({ id: created.id });

		// Verify removed from DB
		const after = db
			.select()
			.from(projects)
			.where(eq(projects.id, created.id))
			.get();
		expect(after).toBeUndefined();
	});

	test("deleting non-existent project does not error", async () => {
		// Should not throw
		await expect(
			router.delete({ id: "never-existed" }),
		).resolves.toBeUndefined();

		// Other operations should still work
		const created = await router.create({
			mainRepoPath: "/tmp/after-bad-delete",
			name: "Still Works",
			color: "#000",
		});
		expect(created.id).toBeTruthy();
	});

	test("deleted project no longer appears in list", async () => {
		const created = await router.create({
			mainRepoPath: "/tmp/list-remove",
			name: "Remove From List",
			color: "#ffff00",
		});

		const before = await router.list();
		const beforeIds = before.map((p: { id: string }) => p.id);
		expect(beforeIds).toContain(created.id);

		await router.delete({ id: created.id });

		const after = await router.list();
		const afterIds = after.map((p: { id: string }) => p.id);
		expect(afterIds).not.toContain(created.id);
	});

	test("can delete multiple projects", async () => {
		const p1 = await router.create({
			mainRepoPath: "/tmp/p1",
			name: "P1",
			color: "#111",
		});
		const p2 = await router.create({
			mainRepoPath: "/tmp/p2",
			name: "P2",
			color: "#222",
		});
		const p3 = await router.create({
			mainRepoPath: "/tmp/p3",
			name: "P3",
			color: "#333",
		});

		expect(await router.list()).toHaveLength(3);

		await router.delete({ id: p1.id });
		await router.delete({ id: p3.id });

		const remaining = await router.list();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(p2.id);
	});
});

// ─── REORDER ──────────────────────────────────────────────────────

describe("L3 E2E: Project REORDER operations", () => {
	beforeEach(setupFreshDb);
	afterEach(cleanupDb);

	test("reorders projects moving from higher to lower index", async () => {
		// Create 5 projects
		const projects = [];
		for (let i = 0; i < 5; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/reorder-${i}`,
				name: `Project ${i}`,
				color: `#${i}11111`,
			});
			projects.push(p);
		}

		// Move last item (index 4) to first position (index 0)
		await router.reorder({
			fromIndex: 4,
			toIndex: 0,
		});

		// Verify list returns new order
		const list = await router.list();
		expect(list[0].id).toBe(projects[4].id); // Project 4 now first
		expect(list[1].id).toBe(projects[0].id); // Project 0 now second
		expect(list[4].id).toBe(projects[3].id); // Project 3 now last
	});

	test("reorders projects moving from lower to higher index", async () => {
		// Create 5 projects
		const projects = [];
		for (let i = 0; i < 5; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/low-high-${i}`,
				name: `LH ${i}`,
				color: "#000",
			});
			projects.push(p);
		}

		// Move first item to last position
		await router.reorder({
			fromIndex: 0,
			toIndex: 4,
		});

		const list = await router.list();
		expect(list[0].id).toBe(projects[1].id); // Was index 1
		expect(list[4].id).toBe(projects[0].id); // Now last
	});

	test("maintains sequential tabOrder after reorder", async () => {
		// Create 5 projects
		for (let i = 0; i < 5; i++) {
			await router.create({
				mainRepoPath: `/tmp/sequential-${i}`,
				name: `S ${i}`,
				color: "#000",
			});
		}

		await router.reorder({ fromIndex: 3, toIndex: 1 });

		const list = await router.list();
		const tabOrders = list.map((p: { tabOrder: number }) => p.tabOrder);

		// Should be 0, 1, 2, 3, 4 sequentially
		expect(tabOrders).toEqual([0, 1, 2, 3, 4]);
	});

	test("reordering with same fromIndex and toIndex is no-op", async () => {
		const projects = [];
		for (let i = 0; i < 5; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/noop-${i}`,
				name: `N ${i}`,
				color: "#000",
			});
			projects.push(p);
		}

		const before = await router.list();
		await router.reorder({
			fromIndex: 2,
			toIndex: 2,
		});

		const after = await router.list();
		expect(after[2].id).toBe(before[2].id);
		expect(after[0].id).toBe(before[0].id);
		expect(after[4].id).toBe(before[4].id);
	});

	test("reorder adjacent items swaps them correctly", async () => {
		const projects = [];
		for (let i = 0; i < 3; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/adjacent-${i}`,
				name: `A ${i}`,
				color: "#000",
			});
			projects.push(p);
		}

		// Swap positions 1 and 2
		await router.reorder({
			fromIndex: 1,
			toIndex: 2,
		});

		const list = await router.list();
		expect(list[0].id).toBe(projects[0].id); // Unchanged
		expect(list[1].id).toBe(projects[2].id); // Was 2, now 1
		expect(list[2].id).toBe(projects[1].id); // Was 1, now 2
	});

	test("reorder updates tabOrder in database", async () => {
		const projects = [];
		for (let i = 0; i < 4; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/db-reorder-${i}`,
				name: `DR ${i}`,
				color: "#000",
			});
			projects.push(p);
		}

		await router.reorder({ fromIndex: 0, toIndex: 3 });

		// Verify database has correct tabOrder values
		const allProjects = await router.list();
		expect(allProjects[0].tabOrder).toBe(0);
		expect(allProjects[1].tabOrder).toBe(1);
		expect(allProjects[2].tabOrder).toBe(2);
		expect(allProjects[3].tabOrder).toBe(3);
	});
});

// ─── FULL LIFECYCLE WORKFLOW ───────────────────────────────────────

describe("L3 E2E: Full Project CRUD Lifecycle Workflows", () => {
	beforeEach(setupFreshDb);
	afterEach(cleanupDb);

	test("complete CRUD workflow: create → read → update → reorder → delete", async () => {
		// 1. CREATE
		const created = await router.create({
			mainRepoPath: "/tmp/lifecycle",
			name: "Lifecycle Test",
			color: "#6366f1",
		});
		expect(created.id).toBeTruthy();

		// 2. READ (get)
		const found = await router.get({ id: created.id });
		expect(found?.name).toBe("Lifecycle Test");

		// 3. READ (list)
		const listBefore = await router.list();
		const initialCount = listBefore.length;
		expect(initialCount).toBe(1);

		// 4. UPDATE
		const updated = await router.update({
			id: created.id,
			name: "Updated Lifecycle",
			color: "#a855f7",
		});
		expect(updated.name).toBe("Updated Lifecycle");

		// Add another project for reorder testing
		const p2 = await router.create({
			mainRepoPath: "/tmp/lifecycle-2",
			name: "Lifecycle 2",
			color: "#000",
		});

		// 5. REORDER (move p2 to front)
		await router.reorder({ fromIndex: 1, toIndex: 0 });
		const reordered = await router.list();
		expect(reordered[0].id).toBe(p2.id);
		expect(reordered[1].id).toBe(created.id);

		// 6. DELETE first project
		await router.delete({ id: p2.id });

		// 7. Verify deletion
		const finalList = await router.list();
		expect(finalList.length).toBe(1);
		expect(finalList[0].id).toBe(created.id);

		const gone = await router.get({ id: p2.id });
		expect(gone).toBeUndefined();
	});

	test("manages multiple projects through full lifecycle", async () => {
		const createdProjects = [];

		// Create 3 projects
		for (let i = 1; i <= 3; i++) {
			const p = await router.create({
				mainRepoPath: `/tmp/multi-${i}`,
				name: `Multi Project ${i}`,
				color: `#${i}0${i}0${i}0`,
			});
			createdProjects.push(p);
		}

		// Verify all created
		const list = await router.list();
		expect(list.length).toBe(3);

		// Update all
		for (const p of createdProjects) {
			await router.update({
				id: p.id,
				name: `Updated ${p.name}`,
			});
		}

		// Verify updates
		for (const p of createdProjects) {
			const updated = await router.get({ id: p.id });
			expect(updated?.name).toContain("Updated");
		}

		// Reorder: move last to first
		await router.reorder({ fromIndex: 2, toIndex: 0 });
		const reordered = await router.list();
		expect(reordered[0].id).toBe(createdProjects[2].id);

		// Delete all in reverse order
		for (let i = createdProjects.length - 1; i >= 0; i--) {
			await router.delete({ id: createdProjects[i].id });
		}

		// Verify all gone
		const finalList = await router.list();
		expect(finalList.length).toBe(0);
	});

	test("simulates real user workflow: add projects, customize, organize", async () => {
		// User adds first project
		const p1 = await router.create({
			mainRepoPath: "/tmp/user-workspace-1",
			name: "Backend API",
			color: "#3b82f6",
		});

		// User adds second project
		const p2 = await router.create({
			mainRepoPath: "/tmp/user-workspace-2",
			name: "Frontend App",
			color: "#22c55e",
		});

		// User adds third project
		const p3 = await router.create({
			mainRepoPath: "/tmp/user-workspace-3",
			name: "Docs",
			color: "#f59e0b",
		});

		// User customizes projects
		await router.update({
			id: p1.id,
			defaultBranch: "main",
		});
		await router.update({
			id: p2.id,
			name: "React Dashboard",
		});

		// User reorders - moves docs to top
		await router.reorder({ fromIndex: 2, toIndex: 0 });

		const list = await router.list();
		expect(list[0].name).toBe("Docs");
		expect(list[1].name).toBe("Backend API");
		expect(list[2].name).toBe("React Dashboard");

		// User removes a project
		await router.delete({ id: p3.id });

		const final = await router.list();
		expect(final.length).toBe(2);
		expect(final[0].name).toBe("Backend API");
		expect(final[1].name).toBe("React Dashboard");
	});
});
