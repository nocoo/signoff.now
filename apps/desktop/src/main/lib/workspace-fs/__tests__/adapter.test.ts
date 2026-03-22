/**
 * Tests for the workspace-fs adapter.
 *
 * Verifies that the adapter correctly translates between the router's
 * { workspacePath, path } convention and FsHostService's { absolutePath }.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { FsHostService } from "@signoff/workspace-fs/host";

// Mock the factory module before importing the adapter
const mockFsService = {
	listDirectory: mock(() =>
		Promise.resolve({
			entries: [
				{ absolutePath: "/ws/src", name: "src", kind: "directory" as const },
				{
					absolutePath: "/ws/README.md",
					name: "README.md",
					kind: "file" as const,
				},
				{
					absolutePath: "/ws/link",
					name: "link",
					kind: "symlink" as const,
				},
			],
		}),
	),
	readFile: mock(() =>
		Promise.resolve({
			kind: "text" as const,
			content: "hello world",
			byteLength: 11,
			exceededLimit: false,
			revision: "rev1",
		}),
	),
	writeFile: mock(() =>
		Promise.resolve({ ok: true as const, revision: "rev2" }),
	),
	createDirectory: mock(() =>
		Promise.resolve({ absolutePath: "/ws/newdir", kind: "directory" as const }),
	),
	deletePath: mock(() => Promise.resolve({ absolutePath: "/ws/old.ts" })),
	movePath: mock(() =>
		Promise.resolve({
			fromAbsolutePath: "/ws/old.ts",
			toAbsolutePath: "/ws/new.ts",
		}),
	),
	getMetadata: mock(() =>
		Promise.resolve({
			absolutePath: "/ws/index.ts",
			kind: "file" as const,
			size: 256,
			createdAt: "2026-01-01T00:00:00.000Z",
			modifiedAt: "2026-03-15T12:30:00.000Z",
			accessedAt: "2026-03-20T08:00:00.000Z",
			symlinkTarget: null,
			revision: "rev3",
		}),
	),
	close: mock(() => Promise.resolve()),
} satisfies Record<string, unknown>;

// Mock getFsHostService to return our mock service
mock.module("../index", () => ({
	getFsHostService: (_rootPath: string) =>
		mockFsService as unknown as FsHostService,
	closeAllFsHostServices: mock(() => Promise.resolve()),
}));

// Import adapter after mocking
const { createFsAdapter } = await import("../adapter");

describe("createFsAdapter", () => {
	let adapter: ReturnType<typeof createFsAdapter>;

	beforeEach(() => {
		adapter = createFsAdapter();
		// Reset all mocks before each test
		for (const fn of Object.values(mockFsService)) {
			if (typeof fn === "function" && "mockClear" in fn) {
				(fn as ReturnType<typeof mock>).mockClear();
			}
		}
	});

	afterEach(() => {
		// Note: do NOT call mock.restore() here — it would undo mock.module()
		// for other test files sharing the process.
	});

	// ── listDirectory ────────────────────────────────────

	describe("listDirectory", () => {
		it("translates FsEntry to DirectoryEntry", async () => {
			const result = await adapter.listDirectory({
				workspacePath: "/ws",
				path: "/ws",
			});

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({
				name: "src",
				isDirectory: true,
				isSymlink: false,
				size: 0,
			});
			expect(result[1]).toEqual({
				name: "README.md",
				isDirectory: false,
				isSymlink: false,
				size: 0,
			});
			expect(result[2]).toEqual({
				name: "link",
				isDirectory: false,
				isSymlink: true,
				size: 0,
			});
		});

		it("passes absolutePath to FsHostService", async () => {
			await adapter.listDirectory({
				workspacePath: "/ws",
				path: "/ws/src",
			});

			expect(mockFsService.listDirectory).toHaveBeenCalledWith({
				absolutePath: "/ws/src",
			});
		});
	});

	// ── readFile ─────────────────────────────────────────

	describe("readFile", () => {
		it("returns text content with utf-8 encoding", async () => {
			const result = await adapter.readFile({
				workspacePath: "/ws",
				path: "/ws/index.ts",
			});

			expect(result).toEqual({
				content: "hello world",
				encoding: "utf-8",
			});
		});

		it("returns binary content with binary encoding", async () => {
			mockFsService.readFile.mockImplementationOnce(() =>
				Promise.resolve({
					kind: "bytes" as const,
					content: new Uint8Array([0xff, 0xd8, 0xff]),
					byteLength: 3,
					exceededLimit: false,
					revision: "rev1",
				}),
			);

			const result = await adapter.readFile({
				workspacePath: "/ws",
				path: "/ws/image.jpg",
			});

			expect(result.encoding).toBe("binary");
			expect(result.content.length).toBe(3);
		});

		it("passes absolutePath to FsHostService", async () => {
			await adapter.readFile({
				workspacePath: "/ws",
				path: "/ws/index.ts",
			});

			expect(mockFsService.readFile).toHaveBeenCalledWith({
				absolutePath: "/ws/index.ts",
			});
		});
	});

	// ── writeFile ────────────────────────────────────────

	describe("writeFile", () => {
		it("delegates to FsHostService writeFile", async () => {
			await adapter.writeFile({
				workspacePath: "/ws",
				path: "/ws/index.ts",
				content: "new content",
			});

			expect(mockFsService.writeFile).toHaveBeenCalledWith({
				absolutePath: "/ws/index.ts",
				content: "new content",
			});
		});

		it("throws on write failure", async () => {
			mockFsService.writeFile.mockImplementationOnce(() =>
				Promise.resolve({
					ok: false as const,
					reason: "conflict" as const,
					currentRevision: "rev1",
				}),
			);

			await expect(
				adapter.writeFile({
					workspacePath: "/ws",
					path: "/ws/index.ts",
					content: "content",
				}),
			).rejects.toThrow("writeFile failed: conflict");
		});
	});

	// ── createDirectory ──────────────────────────────────

	describe("createDirectory", () => {
		it("delegates to FsHostService createDirectory", async () => {
			await adapter.createDirectory({
				workspacePath: "/ws",
				path: "/ws/newdir",
			});

			expect(mockFsService.createDirectory).toHaveBeenCalledWith({
				absolutePath: "/ws/newdir",
			});
		});
	});

	// ── deletePath ───────────────────────────────────────

	describe("deletePath", () => {
		it("delegates to FsHostService deletePath", async () => {
			await adapter.deletePath({
				workspacePath: "/ws",
				path: "/ws/old.ts",
				permanent: true,
			});

			expect(mockFsService.deletePath).toHaveBeenCalledWith({
				absolutePath: "/ws/old.ts",
				permanent: true,
			});
		});

		it("passes undefined permanent when not specified", async () => {
			await adapter.deletePath({
				workspacePath: "/ws",
				path: "/ws/old.ts",
			});

			expect(mockFsService.deletePath).toHaveBeenCalledWith({
				absolutePath: "/ws/old.ts",
				permanent: undefined,
			});
		});
	});

	// ── movePath ─────────────────────────────────────────

	describe("movePath", () => {
		it("translates sourcePath/destinationPath to absolute paths", async () => {
			await adapter.movePath({
				workspacePath: "/ws",
				sourcePath: "/ws/old.ts",
				destinationPath: "/ws/new.ts",
			});

			expect(mockFsService.movePath).toHaveBeenCalledWith({
				sourceAbsolutePath: "/ws/old.ts",
				destinationAbsolutePath: "/ws/new.ts",
			});
		});
	});

	// ── getMetadata ──────────────────────────────────────

	describe("getMetadata", () => {
		it("translates FsMetadata to FileMetadata", async () => {
			const result = await adapter.getMetadata({
				workspacePath: "/ws",
				path: "/ws/index.ts",
			});

			expect(result).toEqual({
				name: "index.ts",
				isDirectory: false,
				isSymlink: false,
				size: 256,
				mtime: new Date("2026-03-15T12:30:00.000Z").getTime(),
			});
		});

		it("detects symlinks via symlinkTarget", async () => {
			mockFsService.getMetadata.mockImplementationOnce(() =>
				Promise.resolve({
					absolutePath: "/ws/link",
					kind: "file" as const,
					size: 100,
					createdAt: null,
					modifiedAt: null,
					accessedAt: null,
					symlinkTarget: "/ws/target",
					revision: "rev4",
				}),
			);

			const result = await adapter.getMetadata({
				workspacePath: "/ws",
				path: "/ws/link",
			});

			expect(result.isSymlink).toBe(true);
		});

		it("throws when file not found", async () => {
			mockFsService.getMetadata.mockImplementationOnce(() =>
				Promise.resolve(null),
			);

			await expect(
				adapter.getMetadata({
					workspacePath: "/ws",
					path: "/ws/missing.ts",
				}),
			).rejects.toThrow("File not found: /ws/missing.ts");
		});

		it("handles null modifiedAt as mtime 0", async () => {
			mockFsService.getMetadata.mockImplementationOnce(() =>
				Promise.resolve({
					absolutePath: "/ws/file.ts",
					kind: "file" as const,
					size: null,
					createdAt: null,
					modifiedAt: null,
					accessedAt: null,
					revision: "rev5",
				}),
			);

			const result = await adapter.getMetadata({
				workspacePath: "/ws",
				path: "/ws/file.ts",
			});

			expect(result.mtime).toBe(0);
			expect(result.size).toBe(0);
		});
	});
});
