/**
 * Tests for the filesystem tRPC router.
 *
 * TDD: written before implementation.
 * Uses mock filesystem functions to test without real disk I/O.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createFilesystemRouter } from "./index";

/** Mock filesystem operations. */
function createMockFs() {
	return {
		listDirectory: mock(() =>
			Promise.resolve([
				{ name: "src", isDirectory: true, isSymlink: false, size: 0 },
				{
					name: "package.json",
					isDirectory: false,
					isSymlink: false,
					size: 1234,
				},
				{ name: "README.md", isDirectory: false, isSymlink: false, size: 567 },
			]),
		),
		readFile: mock(() =>
			Promise.resolve({
				content: 'console.log("hello");',
				encoding: "utf-8",
			}),
		),
		writeFile: mock(() => Promise.resolve()),
		createDirectory: mock(() => Promise.resolve()),
		deletePath: mock(() => Promise.resolve()),
		movePath: mock(() => Promise.resolve()),
		getMetadata: mock(() =>
			Promise.resolve({
				name: "index.ts",
				isDirectory: false,
				isSymlink: false,
				size: 256,
				mtime: new Date("2026-01-01").getTime(),
			}),
		),
	};
}

type MockFs = ReturnType<typeof createMockFs>;

describe("filesystem router", () => {
	let mockFs: MockFs;
	let router: ReturnType<typeof createFilesystemRouter>;

	beforeEach(() => {
		mockFs = createMockFs();
		router = createFilesystemRouter(mockFs as unknown);
	});

	afterEach(() => {
		mock.restore();
	});

	// ── listDirectory ────────────────────────────────────

	describe("listDirectory", () => {
		it("returns directory entries", async () => {
			const result = await router.listDirectory({
				workspacePath: "/test",
				relativePath: ".",
			});

			expect(result.entries).toHaveLength(3);
			expect(result.entries[0].name).toBe("src");
			expect(result.entries[0].isDirectory).toBe(true);
		});

		it("calls fs.listDirectory with correct path", async () => {
			await router.listDirectory({
				workspacePath: "/test",
				relativePath: "src",
			});
			expect(mockFs.listDirectory).toHaveBeenCalledTimes(1);
		});
	});

	// ── readFile ─────────────────────────────────────────

	describe("readFile", () => {
		it("returns file content", async () => {
			const result = await router.readFile({
				workspacePath: "/test",
				relativePath: "src/index.ts",
			});

			expect(result.content).toBe('console.log("hello");');
		});

		it("calls fs.readFile with correct path", async () => {
			await router.readFile({
				workspacePath: "/test",
				relativePath: "src/index.ts",
			});
			expect(mockFs.readFile).toHaveBeenCalledTimes(1);
		});
	});

	// ── writeFile ────────────────────────────────────────

	describe("writeFile", () => {
		it("writes file content", async () => {
			await router.writeFile({
				workspacePath: "/test",
				relativePath: "src/index.ts",
				content: "new content",
			});
			expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
		});
	});

	// ── createDirectory ──────────────────────────────────

	describe("createDirectory", () => {
		it("creates a directory", async () => {
			await router.createDirectory({
				workspacePath: "/test",
				relativePath: "src/new-dir",
			});
			expect(mockFs.createDirectory).toHaveBeenCalledTimes(1);
		});
	});

	// ── deletePath ───────────────────────────────────────

	describe("deletePath", () => {
		it("deletes a path", async () => {
			await router.deletePath({
				workspacePath: "/test",
				relativePath: "src/old.ts",
			});
			expect(mockFs.deletePath).toHaveBeenCalledTimes(1);
		});
	});

	// ── movePath ─────────────────────────────────────────

	describe("movePath", () => {
		it("moves/renames a path", async () => {
			await router.movePath({
				workspacePath: "/test",
				sourcePath: "src/old.ts",
				destinationPath: "src/new.ts",
			});
			expect(mockFs.movePath).toHaveBeenCalledTimes(1);
		});
	});

	// ── getMetadata ──────────────────────────────────────

	describe("getMetadata", () => {
		it("returns file metadata", async () => {
			const result = await router.getMetadata({
				workspacePath: "/test",
				relativePath: "src/index.ts",
			});

			expect(result.name).toBe("index.ts");
			expect(result.size).toBe(256);
			expect(result.isDirectory).toBe(false);
		});
	});
});
