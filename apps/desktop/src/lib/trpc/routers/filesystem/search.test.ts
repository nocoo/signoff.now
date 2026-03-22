/**
 * Tests for the file search utility.
 */

import { describe, expect, it } from "bun:test";
import {
	createFileSearchIndex,
	fileNameFromPath,
	pathsToSearchableFiles,
} from "./search";

describe("fileNameFromPath", () => {
	it("extracts filename from path", () => {
		expect(fileNameFromPath("src/lib/utils.ts")).toBe("utils.ts");
	});

	it("handles root-level files", () => {
		expect(fileNameFromPath("package.json")).toBe("package.json");
	});

	it("handles deeply nested paths", () => {
		expect(fileNameFromPath("a/b/c/d/e.txt")).toBe("e.txt");
	});
});

describe("pathsToSearchableFiles", () => {
	it("converts paths to searchable files", () => {
		const result = pathsToSearchableFiles(["src/index.ts", "package.json"]);

		expect(result).toHaveLength(2);
		expect(result[0].path).toBe("src/index.ts");
		expect(result[0].name).toBe("index.ts");
		expect(result[1].name).toBe("package.json");
	});
});

describe("createFileSearchIndex", () => {
	const files = pathsToSearchableFiles([
		"src/index.ts",
		"src/utils/helpers.ts",
		"src/components/Button.tsx",
		"src/components/Modal.tsx",
		"package.json",
		"tsconfig.json",
		"README.md",
	]);

	it("returns empty results for empty query", () => {
		const search = createFileSearchIndex(files);
		expect(search("")).toHaveLength(0);
		expect(search("  ")).toHaveLength(0);
	});

	it("finds files by exact name", () => {
		const search = createFileSearchIndex(files);
		const results = search("package.json");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].file.name).toBe("package.json");
	});

	it("finds files by partial name", () => {
		const search = createFileSearchIndex(files);
		const results = search("Button");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].file.name).toBe("Button.tsx");
	});

	it("finds files by path fragment", () => {
		const search = createFileSearchIndex(files);
		const results = search("utils");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].file.path).toContain("utils");
	});

	it("respects limit parameter", () => {
		const search = createFileSearchIndex(files);
		const results = search("ts", 2);

		expect(results.length).toBeLessThanOrEqual(2);
	});

	it("results include score", () => {
		const search = createFileSearchIndex(files);
		const results = search("index");

		expect(results.length).toBeGreaterThan(0);
		expect(typeof results[0].score).toBe("number");
		expect(results[0].score).toBeGreaterThanOrEqual(0);
	});

	it("ranks exact matches higher", () => {
		const search = createFileSearchIndex(files);
		const results = search("index.ts");

		expect(results[0].file.name).toBe("index.ts");
		// The exact match should have a lower (better) score
		expect(results[0].score).toBeLessThan(0.3);
	});
});
