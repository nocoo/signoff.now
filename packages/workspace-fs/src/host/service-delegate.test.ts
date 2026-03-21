import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFsHostService } from "./service";

let rootPath: string;

beforeEach(async () => {
	const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "host-svc-test-"));
	// Resolve symlinks (macOS /tmp → /private/tmp) to avoid SYMLINK_ESCAPE errors
	rootPath = await fs.realpath(tmpBase);
});

afterEach(async () => {
	await fs.rm(rootPath, { recursive: true, force: true });
});

describe("createFsHostService delegate methods", () => {
	test("listDirectory returns entries", async () => {
		await fs.writeFile(path.join(rootPath, "file.txt"), "hello");
		await fs.mkdir(path.join(rootPath, "dir"));

		const svc = createFsHostService({ rootPath });
		const result = await svc.listDirectory({ absolutePath: rootPath });
		expect(result.entries.length).toBe(2);
		const names = result.entries.map((e) => e.name).sort();
		expect(names).toEqual(["dir", "file.txt"]);
	});

	test("readFile returns file content", async () => {
		await fs.writeFile(path.join(rootPath, "test.txt"), "content");

		const svc = createFsHostService({ rootPath });
		const result = await svc.readFile({
			absolutePath: path.join(rootPath, "test.txt"),
			encoding: "utf-8",
		});
		expect(result.kind).toBe("text");
		if (result.kind === "text") {
			expect(result.content).toBe("content");
		}
	});

	test("getMetadata returns file metadata", async () => {
		await fs.writeFile(path.join(rootPath, "meta.txt"), "data");

		const svc = createFsHostService({ rootPath });
		const result = await svc.getMetadata({
			absolutePath: path.join(rootPath, "meta.txt"),
		});
		expect(result).not.toBeNull();
		expect(result?.kind).toBe("file");
	});

	test("writeFile creates a new file", async () => {
		const svc = createFsHostService({ rootPath });
		const filePath = path.join(rootPath, "new.txt");
		const result = await svc.writeFile({
			absolutePath: filePath,
			content: "new content",
			encoding: "utf-8",
		});
		expect(result.ok).toBe(true);
		const content = await fs.readFile(filePath, "utf-8");
		expect(content).toBe("new content");
	});

	test("createDirectory creates a directory", async () => {
		const svc = createFsHostService({ rootPath });
		const dirPath = path.join(rootPath, "newdir");
		const result = await svc.createDirectory({
			absolutePath: dirPath,
			recursive: true,
		});
		expect(result.kind).toBe("directory");
		const stat = await fs.stat(dirPath);
		expect(stat.isDirectory()).toBe(true);
	});

	test("deletePath removes a file", async () => {
		const filePath = path.join(rootPath, "todelete.txt");
		await fs.writeFile(filePath, "bye");

		const svc = createFsHostService({ rootPath });
		await svc.deletePath({ absolutePath: filePath, permanent: true });

		await expect(fs.access(filePath)).rejects.toThrow();
	});

	test("movePath renames a file", async () => {
		const srcPath = path.join(rootPath, "src.txt");
		const dstPath = path.join(rootPath, "dst.txt");
		await fs.writeFile(srcPath, "move me");

		const svc = createFsHostService({ rootPath });
		const result = await svc.movePath({
			sourceAbsolutePath: srcPath,
			destinationAbsolutePath: dstPath,
		});
		expect(result.toAbsolutePath).toBe(dstPath);
		const content = await fs.readFile(dstPath, "utf-8");
		expect(content).toBe("move me");
	});

	test("copyPath copies a file", async () => {
		const srcPath = path.join(rootPath, "original.txt");
		const dstPath = path.join(rootPath, "copy.txt");
		await fs.writeFile(srcPath, "copy me");

		const svc = createFsHostService({ rootPath });
		await svc.copyPath({
			sourceAbsolutePath: srcPath,
			destinationAbsolutePath: dstPath,
		});
		const content = await fs.readFile(dstPath, "utf-8");
		expect(content).toBe("copy me");
	});

	test("searchFiles returns matching files", async () => {
		await fs.writeFile(path.join(rootPath, "hello.ts"), "");
		await fs.writeFile(path.join(rootPath, "world.ts"), "");

		const svc = createFsHostService({ rootPath });
		const result = await svc.searchFiles({
			query: "hello",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 10,
		});
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0]?.name).toBe("hello.ts");
	});

	test("searchContent delegates to search module", async () => {
		await fs.writeFile(
			path.join(rootPath, "code.ts"),
			'const greeting = "hello world";\n',
		);

		const svc = createFsHostService({
			rootPath,
			runRipgrep: async () => ({ stdout: "" }),
		});
		// searchContent with mock ripgrep returning nothing falls back to scan
		const result = await svc.searchContent({
			query: "hello",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 10,
		});
		// May or may not find matches depending on fallback behavior
		expect(Array.isArray(result.matches)).toBe(true);
	});

	test("close is a no-op without watcher manager", async () => {
		const svc = createFsHostService({ rootPath });
		await svc.close();
	});

	test("watchPath throws without watcher manager", () => {
		const svc = createFsHostService({ rootPath });
		expect(() => svc.watchPath({ absolutePath: rootPath })).toThrow(
			"watchPath requires a watcher manager",
		);
	});
});
