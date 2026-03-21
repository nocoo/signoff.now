import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	copyPath,
	deletePath,
	getMetadata,
	listDirectory,
	movePath,
	WorkspaceFsPathError,
} from "./fs";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
	const tempPath = await fs.mkdtemp(
		path.join(os.tmpdir(), "ws-fs-integration-"),
	);
	const rootPath = await fs.realpath(tempPath);
	tempRoots.push(rootPath);
	return rootPath;
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map(async (rootPath) => {
			await fs.rm(rootPath, { recursive: true, force: true });
		}),
	);
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------
describe("getMetadata", () => {
	test("returns metadata for a regular file", async () => {
		const rootPath = await createTempRoot();
		const filePath = path.join(rootPath, "hello.txt");
		await fs.writeFile(filePath, "hello world");

		const meta = await getMetadata({ rootPath, absolutePath: filePath });

		expect(meta).not.toBeNull();
		expect(meta?.kind).toEqual("file");
		expect(meta?.size).toBeGreaterThan(0);
		expect(meta?.revision).toBeTruthy();
		// Dates should be valid ISO strings
		const createdAt = meta?.createdAt ?? "";
		const modifiedAt = meta?.modifiedAt ?? "";
		const accessedAt = meta?.accessedAt ?? "";
		expect(new Date(createdAt).toISOString()).toEqual(createdAt);
		expect(new Date(modifiedAt).toISOString()).toEqual(modifiedAt);
		expect(new Date(accessedAt).toISOString()).toEqual(accessedAt);
	});

	test("returns metadata for a directory", async () => {
		const rootPath = await createTempRoot();
		const dirPath = path.join(rootPath, "subdir");
		await fs.mkdir(dirPath);

		const meta = await getMetadata({ rootPath, absolutePath: dirPath });

		expect(meta).not.toBeNull();
		expect(meta?.kind).toEqual("directory");
	});

	test("returns null for a non-existent path", async () => {
		const rootPath = await createTempRoot();
		const missingPath = path.join(rootPath, "does-not-exist.txt");

		const meta = await getMetadata({
			rootPath,
			absolutePath: missingPath,
		});

		expect(meta).toBeNull();
	});

	test("returns metadata for a symlink with symlinkTarget", async () => {
		const rootPath = await createTempRoot();
		const targetPath = path.join(rootPath, "target.txt");
		const linkPath = path.join(rootPath, "link.txt");
		await fs.writeFile(targetPath, "target content");
		await fs.symlink(targetPath, linkPath);

		const meta = await getMetadata({ rootPath, absolutePath: linkPath });

		expect(meta).not.toBeNull();
		expect(meta?.kind).toEqual("symlink");
		expect(meta?.symlinkTarget).toEqual(targetPath);
	});
});

// ---------------------------------------------------------------------------
// listDirectory — sorting
// ---------------------------------------------------------------------------
describe("listDirectory", () => {
	test("returns directories before files, sorted alphabetically within each group", async () => {
		const rootPath = await createTempRoot();
		await fs.mkdir(path.join(rootPath, "zzz"));
		await fs.mkdir(path.join(rootPath, "aaa"));
		await fs.writeFile(path.join(rootPath, "bbb.txt"), "b");
		await fs.writeFile(path.join(rootPath, "aaa.txt"), "a");

		const entries = await listDirectory({
			rootPath,
			absolutePath: rootPath,
		});

		const names = entries.map((e) => e.name);
		expect(names).toEqual(["aaa", "zzz", "aaa.txt", "bbb.txt"]);

		// Verify kinds
		expect(entries[0]?.kind).toEqual("directory");
		expect(entries[1]?.kind).toEqual("directory");
		expect(entries[2]?.kind).toEqual("file");
		expect(entries[3]?.kind).toEqual("file");
	});
});

// ---------------------------------------------------------------------------
// deletePath
// ---------------------------------------------------------------------------
describe("deletePath", () => {
	test("deletes a regular file", async () => {
		const rootPath = await createTempRoot();
		const filePath = path.join(rootPath, "to-delete.txt");
		await fs.writeFile(filePath, "bye");

		await deletePath({ rootPath, absolutePath: filePath, permanent: true });

		await expect(fs.access(filePath)).rejects.toThrow();
	});

	test("deletes a directory recursively", async () => {
		const rootPath = await createTempRoot();
		const dirPath = path.join(rootPath, "nested");
		await fs.mkdir(path.join(dirPath, "deep"), { recursive: true });
		await fs.writeFile(path.join(dirPath, "deep", "file.txt"), "data");

		await deletePath({ rootPath, absolutePath: dirPath, permanent: true });

		await expect(fs.access(dirPath)).rejects.toThrow();
	});

	test("returns without error for a non-existent path", async () => {
		const rootPath = await createTempRoot();
		const missingPath = path.join(rootPath, "ghost.txt");

		const result = await deletePath({
			rootPath,
			absolutePath: missingPath,
			permanent: true,
		});

		expect(result.absolutePath).toEqual(missingPath);
	});

	test("throws for workspace root path", async () => {
		const rootPath = await createTempRoot();

		try {
			await deletePath({
				rootPath,
				absolutePath: rootPath,
				permanent: true,
			});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceFsPathError);
			expect((error as WorkspaceFsPathError).code).toEqual("INVALID_TARGET");
		}
	});

	test("calls trashItem callback when permanent=false and trashItem provided", async () => {
		const rootPath = await createTempRoot();
		const filePath = path.join(rootPath, "trash-me.txt");
		await fs.writeFile(filePath, "trash");

		let trashedPath: string | undefined;
		const trashItem = async (p: string) => {
			trashedPath = p;
		};

		await deletePath({
			rootPath,
			absolutePath: filePath,
			permanent: false,
			trashItem,
		});

		expect(trashedPath).toEqual(filePath);
		// The file should still exist on disk since trashItem is a no-op stub
		const stats = await fs.stat(filePath);
		expect(stats.isFile()).toEqual(true);
	});

	test("deletes a symlink without following it", async () => {
		const rootPath = await createTempRoot();
		const targetPath = path.join(rootPath, "real.txt");
		const linkPath = path.join(rootPath, "link.txt");
		await fs.writeFile(targetPath, "keep me");
		await fs.symlink(targetPath, linkPath);

		await deletePath({ rootPath, absolutePath: linkPath, permanent: true });

		// Symlink should be gone
		await expect(fs.lstat(linkPath)).rejects.toThrow();
		// Target should still exist
		const targetStats = await fs.stat(targetPath);
		expect(targetStats.isFile()).toEqual(true);
	});
});

// ---------------------------------------------------------------------------
// movePath
// ---------------------------------------------------------------------------
describe("movePath", () => {
	test("moves a file to a new name", async () => {
		const rootPath = await createTempRoot();
		const srcPath = path.join(rootPath, "old.txt");
		const dstPath = path.join(rootPath, "new.txt");
		await fs.writeFile(srcPath, "content");

		const result = await movePath({
			rootPath,
			sourceAbsolutePath: srcPath,
			destinationAbsolutePath: dstPath,
		});

		expect(result.fromAbsolutePath).toEqual(srcPath);
		expect(result.toAbsolutePath).toEqual(dstPath);
		await expect(fs.access(srcPath)).rejects.toThrow();
		expect(await fs.readFile(dstPath, "utf-8")).toEqual("content");
	});

	test("throws when destination already exists", async () => {
		const rootPath = await createTempRoot();
		const srcPath = path.join(rootPath, "src.txt");
		const dstPath = path.join(rootPath, "dst.txt");
		await fs.writeFile(srcPath, "source");
		await fs.writeFile(dstPath, "destination");

		try {
			await movePath({
				rootPath,
				sourceAbsolutePath: srcPath,
				destinationAbsolutePath: dstPath,
			});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("already exists");
		}
	});

	test("throws when source does not exist", async () => {
		const rootPath = await createTempRoot();
		const srcPath = path.join(rootPath, "nope.txt");
		const dstPath = path.join(rootPath, "dst.txt");

		try {
			await movePath({
				rootPath,
				sourceAbsolutePath: srcPath,
				destinationAbsolutePath: dstPath,
			});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/ENOENT|no such file/i);
		}
	});
});

// ---------------------------------------------------------------------------
// copyPath
// ---------------------------------------------------------------------------
describe("copyPath", () => {
	test("copies a file", async () => {
		const rootPath = await createTempRoot();
		const srcPath = path.join(rootPath, "original.txt");
		const dstPath = path.join(rootPath, "copy.txt");
		await fs.writeFile(srcPath, "original");

		const result = await copyPath({
			rootPath,
			sourceAbsolutePath: srcPath,
			destinationAbsolutePath: dstPath,
		});

		expect(result.fromAbsolutePath).toEqual(srcPath);
		expect(result.toAbsolutePath).toEqual(dstPath);
		expect(await fs.readFile(dstPath, "utf-8")).toEqual("original");
		// Source should still exist
		expect(await fs.readFile(srcPath, "utf-8")).toEqual("original");
	});

	test("copies a directory recursively", async () => {
		const rootPath = await createTempRoot();
		const srcDir = path.join(rootPath, "src-dir");
		await fs.mkdir(path.join(srcDir, "child"), { recursive: true });
		await fs.writeFile(path.join(srcDir, "a.txt"), "a");
		await fs.writeFile(path.join(srcDir, "child", "b.txt"), "b");

		const dstDir = path.join(rootPath, "dst-dir");
		await copyPath({
			rootPath,
			sourceAbsolutePath: srcDir,
			destinationAbsolutePath: dstDir,
		});

		expect(await fs.readFile(path.join(dstDir, "a.txt"), "utf-8")).toEqual("a");
		expect(
			await fs.readFile(path.join(dstDir, "child", "b.txt"), "utf-8"),
		).toEqual("b");
	});
});

// ---------------------------------------------------------------------------
// WorkspaceFsPathError
// ---------------------------------------------------------------------------
describe("WorkspaceFsPathError", () => {
	test("constructor sets name, message, and code correctly", () => {
		const error = new WorkspaceFsPathError("test message", "OUTSIDE_ROOT");

		expect(error.name).toEqual("WorkspaceFsPathError");
		expect(error.message).toEqual("test message");
		expect(error.code).toEqual("OUTSIDE_ROOT");
		expect(error).toBeInstanceOf(Error);
	});

	test("supports all error codes", () => {
		const codes = ["OUTSIDE_ROOT", "INVALID_TARGET", "SYMLINK_ESCAPE"] as const;

		for (const code of codes) {
			const error = new WorkspaceFsPathError(`error: ${code}`, code);
			expect(error.code).toEqual(code);
			expect(error.name).toEqual("WorkspaceFsPathError");
		}
	});
});
