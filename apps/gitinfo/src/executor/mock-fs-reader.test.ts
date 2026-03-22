import { describe, expect, it } from "bun:test";
import { createMockFsReader } from "./mock-fs-reader.ts";

describe("createMockFsReader", () => {
	it("exists returns configured values", async () => {
		const fs = createMockFsReader({
			exists: new Map([
				["/path/a", true],
				["/path/b", false],
			]),
		});
		expect(await fs.exists("/path/a")).toBe(true);
		expect(await fs.exists("/path/b")).toBe(false);
		expect(await fs.exists("/path/unknown")).toBe(false);
	});

	it("readdir returns configured values", async () => {
		const fs = createMockFsReader({
			files: new Map([["/dir", ["a.ts", "b.ts"]]]),
		});
		expect(await fs.readdir("/dir")).toEqual(["a.ts", "b.ts"]);
		expect(await fs.readdir("/missing")).toEqual([]);
	});

	it("fileSize returns configured values", async () => {
		const fs = createMockFsReader({
			fileSizes: new Map([["/file.ts", 1024]]),
		});
		expect(await fs.fileSize("/file.ts")).toBe(1024);
	});

	it("fileSize throws for unconfigured path", async () => {
		const fs = createMockFsReader();
		expect(fs.fileSize("/unknown")).rejects.toThrow("No mock fileSize");
	});

	it("dirSizeKiB returns configured values", async () => {
		const fs = createMockFsReader({
			sizes: new Map([["/dir", 42]]),
		});
		expect(await fs.dirSizeKiB("/dir")).toBe(42);
		expect(await fs.dirSizeKiB("/missing")).toBe(0);
	});

	it("works with no options", async () => {
		const fs = createMockFsReader();
		expect(await fs.exists("/x")).toBe(false);
		expect(await fs.readdir("/x")).toEqual([]);
		expect(await fs.dirSizeKiB("/x")).toBe(0);
	});
});
