/**
 * Tests for the changes tRPC router.
 *
 * TDD: written before implementation.
 * Uses a mock simple-git instance to test git operations
 * without requiring an actual git repository.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createChangesRouter } from "./index";

/** Mock simple-git instance. */
function createMockGit() {
	return {
		status: mock(() =>
			Promise.resolve({
				files: [
					{
						path: "src/index.ts",
						index: "M",
						working_dir: " ",
					},
					{
						path: "src/new.ts",
						index: " ",
						working_dir: "?",
					},
					{
						path: "src/modified.ts",
						index: " ",
						working_dir: "M",
					},
				],
				staged: ["src/index.ts"],
				modified: ["src/modified.ts"],
				not_added: ["src/new.ts"],
				current: "main",
				tracking: "origin/main",
			}),
		),
		diff: mock(() =>
			Promise.resolve(
				[
					"diff --git a/src/index.ts b/src/index.ts",
					"index abc123..def456 100644",
					"--- a/src/index.ts",
					"+++ b/src/index.ts",
					"@@ -1,3 +1,4 @@",
					" import { foo } from './foo';",
					"+import { bar } from './bar';",
					" ",
					" export function main() {",
				].join("\n"),
			),
		),
		add: mock(() => Promise.resolve()),
		reset: mock(() => Promise.resolve()),
		commit: mock(() =>
			Promise.resolve({
				commit: "abc1234",
				summary: { changes: 1, insertions: 2, deletions: 0 },
			}),
		),
		checkout: mock(() => Promise.resolve()),
		log: mock(() =>
			Promise.resolve({
				latest: {
					hash: "abc1234",
					date: "2026-01-01",
					message: "test commit",
					author_name: "Test",
				},
				all: [],
				total: 0,
			}),
		),
	};
}

type MockGit = ReturnType<typeof createMockGit>;

describe("changes router", () => {
	let mockGit: MockGit;
	let router: ReturnType<typeof createChangesRouter>;

	beforeEach(() => {
		mockGit = createMockGit();
		router = createChangesRouter(() => mockGit as unknown);
	});

	afterEach(() => {
		mock.restore();
	});

	// ── status ──────────────────────────────────────────

	describe("status", () => {
		it("returns git status with file list", async () => {
			const result = await router.status({ workspacePath: "/test/repo" });

			expect(result.files).toHaveLength(3);
			expect(result.branch).toBe("main");
			expect(result.tracking).toBe("origin/main");
		});

		it("categorizes files by status", async () => {
			const result = await router.status({ workspacePath: "/test/repo" });

			const staged = result.files.filter((f) => f.staged);
			const unstaged = result.files.filter(
				(f) => !f.staged && f.status !== "untracked",
			);
			const untracked = result.files.filter((f) => f.status === "untracked");

			expect(staged).toHaveLength(1);
			expect(staged[0].path).toBe("src/index.ts");
			expect(unstaged).toHaveLength(1);
			expect(untracked).toHaveLength(1);
		});

		it("passes workspace path to simple-git", async () => {
			await router.status({ workspacePath: "/test/repo" });
			expect(mockGit.status).toHaveBeenCalledTimes(1);
		});
	});

	// ── diff ────────────────────────────────────────────

	describe("diff", () => {
		it("returns diff text for a file", async () => {
			const result = await router.diff({
				workspacePath: "/test/repo",
				filePath: "src/index.ts",
			});

			expect(result.diff).toContain("diff --git");
			expect(result.diff).toContain("+import { bar }");
		});

		it("calls git diff with the file path", async () => {
			await router.diff({
				workspacePath: "/test/repo",
				filePath: "src/index.ts",
			});
			expect(mockGit.diff).toHaveBeenCalledTimes(1);
		});

		it("supports staged diff", async () => {
			await router.diff({
				workspacePath: "/test/repo",
				filePath: "src/index.ts",
				staged: true,
			});
			expect(mockGit.diff).toHaveBeenCalledTimes(1);
		});
	});

	// ── stage/unstage ───────────────────────────────────

	describe("stage", () => {
		it("stages a file", async () => {
			await router.stage({
				workspacePath: "/test/repo",
				filePaths: ["src/new.ts"],
			});
			expect(mockGit.add).toHaveBeenCalledTimes(1);
		});

		it("stages multiple files", async () => {
			await router.stage({
				workspacePath: "/test/repo",
				filePaths: ["src/new.ts", "src/modified.ts"],
			});
			expect(mockGit.add).toHaveBeenCalledTimes(1);
		});
	});

	describe("unstage", () => {
		it("unstages a file", async () => {
			await router.unstage({
				workspacePath: "/test/repo",
				filePaths: ["src/index.ts"],
			});
			expect(mockGit.reset).toHaveBeenCalledTimes(1);
		});
	});

	// ── commit ──────────────────────────────────────────

	describe("commit", () => {
		it("commits staged changes with message", async () => {
			const result = await router.commit({
				workspacePath: "/test/repo",
				message: "test commit message",
			});

			expect(result.hash).toBe("abc1234");
			expect(mockGit.commit).toHaveBeenCalledTimes(1);
		});
	});

	// ── discard ─────────────────────────────────────────

	describe("discard", () => {
		it("discards changes to a file", async () => {
			await router.discard({
				workspacePath: "/test/repo",
				filePaths: ["src/modified.ts"],
			});
			expect(mockGit.checkout).toHaveBeenCalledTimes(1);
		});
	});

	// ── log ─────────────────────────────────────────────

	describe("log", () => {
		it("returns recent commit log", async () => {
			const result = await router.log({
				workspacePath: "/test/repo",
				limit: 10,
			});

			expect(result.latest).toBeDefined();
			expect(result.latest?.hash).toBe("abc1234");
		});
	});
});
