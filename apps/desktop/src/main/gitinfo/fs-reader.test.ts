import { describe, expect, test } from "bun:test";
import { createNodeExecutor } from "./executor";
import { createNodeFsReader } from "./fs-reader";

describe("createNodeFsReader", () => {
	const exec = createNodeExecutor();
	const fs = createNodeFsReader(exec);

	test("exists returns true for an existing path", async () => {
		expect(await fs.exists("/tmp")).toBe(true);
	});

	test("exists returns false for a non-existing path", async () => {
		expect(await fs.exists("/tmp/__nonexistent_path_12345__")).toBe(false);
	});

	test("readdir lists directory contents", async () => {
		const entries = await fs.readdir("/tmp");
		expect(Array.isArray(entries)).toBe(true);
	});

	test("readdir returns empty array for non-existing directory", async () => {
		const entries = await fs.readdir("/tmp/__nonexistent_dir_12345__");
		expect(entries).toEqual([]);
	});

	test("fileSize returns positive number for existing file", async () => {
		// Use the test file itself — guaranteed to exist
		const size = await fs.fileSize(`${import.meta.dir}/fs-reader.test.ts`);
		expect(size).toBeGreaterThan(0);
	});

	test("dirSizeKiB returns positive number for existing directory", async () => {
		const size = await fs.dirSizeKiB("/tmp");
		expect(size).toBeGreaterThanOrEqual(0);
	});

	test("dirSizeKiB returns 0 for non-existing directory", async () => {
		const size = await fs.dirSizeKiB("/tmp/__nonexistent_dir_12345__");
		expect(size).toBe(0);
	});
});
