import { describe, expect, test } from "bun:test";
import {
	applySearchPatchEvent,
	createPathFilterMatcher,
	formatPreviewLine,
	globToRegExp,
	isBinaryContent,
	matchesPathFilters,
	normalizeGlobPattern,
	normalizePathForGlob,
	rankContentMatches,
	searchContentWithRipgrep,
} from "./search";

describe("normalizePathForGlob", () => {
	test("passes through simple path", () => {
		expect(normalizePathForGlob("src/index.ts")).toBe("src/index.ts");
	});

	test("strips ./ prefix", () => {
		expect(normalizePathForGlob("./src/index.ts")).toBe("src/index.ts");
	});

	test("strips / prefix", () => {
		expect(normalizePathForGlob("/src/index.ts")).toBe("src/index.ts");
	});

	test("replaces backslashes", () => {
		expect(normalizePathForGlob("src\\lib\\utils.ts")).toBe("src/lib/utils.ts");
	});
});

describe("normalizeGlobPattern", () => {
	test("adds **/ prefix for patterns without /", () => {
		expect(normalizeGlobPattern("*.ts")).toBe("**/*.ts");
	});

	test("adds ** suffix for patterns ending with /", () => {
		expect(normalizeGlobPattern("src/")).toBe("src/**");
	});

	test("keeps pattern with / as-is", () => {
		expect(normalizeGlobPattern("src/*.ts")).toBe("src/*.ts");
	});
});

describe("globToRegExp", () => {
	test("matches ** glob (double star)", () => {
		const re = globToRegExp("**/*.ts");
		expect(re.test("src/index.ts")).toBe(true);
		expect(re.test("deep/nested/file.ts")).toBe(true);
		expect(re.test("index.ts")).toBe(true);
		expect(re.test("index.js")).toBe(false);
	});

	test("matches * glob (single star — no /)", () => {
		const re = globToRegExp("src/*.ts");
		expect(re.test("src/index.ts")).toBe(true);
		expect(re.test("src/deep/index.ts")).toBe(false);
	});

	test("matches ? glob (single character)", () => {
		const re = globToRegExp("src/?.ts");
		expect(re.test("src/a.ts")).toBe(true);
		expect(re.test("src/ab.ts")).toBe(false);
	});

	test("escapes regex special characters", () => {
		const re = globToRegExp("src/file.test.ts");
		expect(re.test("src/file.test.ts")).toBe(true);
		expect(re.test("src/fileXtestXts")).toBe(false);
	});
});

describe("createPathFilterMatcher + matchesPathFilters", () => {
	test("no filters → matches everything", () => {
		const matcher = createPathFilterMatcher({
			includePattern: "",
			excludePattern: "",
		});
		expect(matchesPathFilters("src/index.ts", matcher)).toBe(true);
	});

	test("include filter restricts matches", () => {
		const matcher = createPathFilterMatcher({
			includePattern: "*.ts",
			excludePattern: "",
		});
		expect(matchesPathFilters("src/index.ts", matcher)).toBe(true);
		expect(matchesPathFilters("src/index.js", matcher)).toBe(false);
	});

	test("exclude filter removes matches", () => {
		const matcher = createPathFilterMatcher({
			includePattern: "",
			excludePattern: "*.test.ts",
		});
		expect(matchesPathFilters("src/index.ts", matcher)).toBe(true);
		expect(matchesPathFilters("src/index.test.ts", matcher)).toBe(false);
	});

	test("include + exclude together", () => {
		const matcher = createPathFilterMatcher({
			includePattern: "*.ts",
			excludePattern: "*.test.ts",
		});
		expect(matchesPathFilters("src/index.ts", matcher)).toBe(true);
		expect(matchesPathFilters("src/index.test.ts", matcher)).toBe(false);
		expect(matchesPathFilters("src/style.css", matcher)).toBe(false);
	});
});

describe("isBinaryContent", () => {
	test("returns false for text content", () => {
		expect(isBinaryContent(Buffer.from("hello world"))).toBe(false);
	});

	test("returns true for content with null byte", () => {
		expect(isBinaryContent(Buffer.from([0x48, 0x00, 0x49]))).toBe(true);
	});

	test("returns false for empty buffer", () => {
		expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
	});
});

describe("formatPreviewLine", () => {
	test("trims whitespace", () => {
		expect(formatPreviewLine("  hello  ")).toBe("hello");
	});

	test("returns empty string for blank line", () => {
		expect(formatPreviewLine("   ")).toBe("");
	});

	test("truncates long lines with ...", () => {
		const long = "a".repeat(500);
		const result = formatPreviewLine(long);
		expect(result.endsWith("...")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(203);
	});

	test("keeps short lines as-is", () => {
		expect(formatPreviewLine("short line")).toBe("short line");
	});
});

describe("rankContentMatches", () => {
	test("returns empty array for empty input", () => {
		expect(rankContentMatches([], "query", 10)).toEqual([]);
	});

	test("ranks matches using Fuse.js", () => {
		const matches = [
			{
				absolutePath: "/root/src/far.ts",
				relativePath: "src/far.ts",
				name: "far.ts",
				line: 1,
				column: 1,
				preview: "unrelated content",
			},
			{
				absolutePath: "/root/src/query.ts",
				relativePath: "src/query.ts",
				name: "query.ts",
				line: 1,
				column: 1,
				preview: "the query value here",
			},
		];
		const ranked = rankContentMatches(matches, "query", 10);
		expect(ranked.length).toBeGreaterThan(0);
		// The match with "query" in preview/name should rank higher
		expect(ranked[0]?.name).toBe("query.ts");
	});

	test("falls back to original order when Fuse returns nothing", () => {
		const matches = [
			{
				absolutePath: "/root/a.ts",
				relativePath: "a.ts",
				name: "a.ts",
				line: 1,
				column: 1,
				preview: "aaaa",
			},
			{
				absolutePath: "/root/b.ts",
				relativePath: "b.ts",
				name: "b.ts",
				line: 1,
				column: 1,
				preview: "bbbb",
			},
		];
		// Use a query that won't match anything well
		const ranked = rankContentMatches(matches, "zzzzzzzzz", 10);
		expect(ranked.length).toBe(2);
	});

	test("respects limit", () => {
		const matches = Array.from({ length: 50 }, (_, i) => ({
			absolutePath: `/root/file${i}.ts`,
			relativePath: `file${i}.ts`,
			name: `file${i}.ts`,
			line: 1,
			column: 1,
			preview: `content ${i}`,
		}));
		const ranked = rankContentMatches(matches, "content", 5);
		expect(ranked.length).toBeLessThanOrEqual(5);
	});
});

describe("searchContentWithRipgrep", () => {
	test("parses ripgrep JSON output", async () => {
		const rgOutput = [
			JSON.stringify({
				type: "match",
				data: {
					path: { text: "src/index.ts" },
					line_number: 10,
					lines: { text: "const query = 'hello';\n" },
					submatches: [{ match: { text: "hello" }, start: 16, end: 21 }],
				},
			}),
			JSON.stringify({
				type: "match",
				data: {
					path: { text: "src/utils.ts" },
					line_number: 5,
					lines: { text: "function hello() {\n" },
					submatches: [{ match: { text: "hello" }, start: 9, end: 14 }],
				},
			}),
			"",
		].join("\n");

		const result = await searchContentWithRipgrep({
			rootPath: "/tmp/test-root",
			query: "hello",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 20,
			runRipgrep: async () => ({ stdout: rgOutput }),
		});

		expect(result.length).toBe(2);
		const paths = result.map((r) => r.relativePath).sort();
		expect(paths).toEqual(["src/index.ts", "src/utils.ts"]);
		expect(result[0]?.line).toBeGreaterThan(0);
		expect(result[0]?.column).toBeGreaterThan(0);
	});

	test("returns empty for ripgrep exit code 1 (no matches)", async () => {
		const error = new Error("exit code 1") as NodeJS.ErrnoException;
		error.code = "1";

		const result = await searchContentWithRipgrep({
			rootPath: "/tmp/test-root",
			query: "nonexistent",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 20,
			runRipgrep: async () => {
				throw error;
			},
		});

		expect(result).toEqual([]);
	});

	test("throws for ripgrep errors other than exit code 1", async () => {
		const error = new Error("permission denied") as NodeJS.ErrnoException;
		error.code = "EPERM";

		await expect(
			searchContentWithRipgrep({
				rootPath: "/tmp/test-root",
				query: "test",
				includeHidden: false,
				includePattern: "",
				excludePattern: "",
				limit: 20,
				runRipgrep: async () => {
					throw error;
				},
			}),
		).rejects.toThrow("permission denied");
	});

	test("deduplicates matches by file:line:column", async () => {
		const line = JSON.stringify({
			type: "match",
			data: {
				path: { text: "src/file.ts" },
				line_number: 5,
				lines: { text: "hello world\n" },
				submatches: [{ match: { text: "hello" }, start: 0, end: 5 }],
			},
		});

		const result = await searchContentWithRipgrep({
			rootPath: "/tmp/test-root",
			query: "hello",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 20,
			runRipgrep: async () => ({
				stdout: `${line}\n${line}\n`,
			}),
		});

		expect(result.length).toBe(1);
	});

	test("skips non-match type entries", async () => {
		const rgOutput = [
			JSON.stringify({
				type: "begin",
				data: { path: { text: "src/file.ts" } },
			}),
			JSON.stringify({
				type: "match",
				data: {
					path: { text: "src/file.ts" },
					line_number: 1,
					lines: { text: "hello\n" },
					submatches: [],
				},
			}),
			JSON.stringify({ type: "end", data: {} }),
			"",
		].join("\n");

		const result = await searchContentWithRipgrep({
			rootPath: "/tmp/test-root",
			query: "hello",
			includeHidden: false,
			includePattern: "",
			excludePattern: "",
			limit: 20,
			runRipgrep: async () => ({ stdout: rgOutput }),
		});

		expect(result.length).toBe(1);
	});
});

describe("applySearchPatchEvent", () => {
	test("handles create event — adds file to index", () => {
		const items = new Map<
			string,
			{ absolutePath: string; relativePath: string; name: string }
		>();
		applySearchPatchEvent({
			itemsByPath: items,
			rootPath: "/root",
			includeHidden: false,
			event: {
				kind: "create",
				absolutePath: "/root/src/new.ts",
				isDirectory: false,
			},
		});
		expect(items.size).toBe(1);
		expect(items.get("/root/src/new.ts")?.name).toBe("new.ts");
	});

	test("handles delete event — removes file from index", () => {
		const items = new Map([
			[
				"/root/src/old.ts",
				{
					absolutePath: "/root/src/old.ts",
					relativePath: "src/old.ts",
					name: "old.ts",
				},
			],
		]);
		applySearchPatchEvent({
			itemsByPath: items,
			rootPath: "/root",
			includeHidden: false,
			event: {
				kind: "delete",
				absolutePath: "/root/src/old.ts",
				isDirectory: false,
			},
		});
		expect(items.size).toBe(0);
	});

	test("handles rename event — removes old, adds new", () => {
		const items = new Map([
			[
				"/root/src/old.ts",
				{
					absolutePath: "/root/src/old.ts",
					relativePath: "src/old.ts",
					name: "old.ts",
				},
			],
		]);
		applySearchPatchEvent({
			itemsByPath: items,
			rootPath: "/root",
			includeHidden: false,
			event: {
				kind: "rename",
				absolutePath: "/root/src/new.ts",
				oldAbsolutePath: "/root/src/old.ts",
				isDirectory: false,
			},
		});
		expect(items.has("/root/src/old.ts")).toBe(false);
		expect(items.has("/root/src/new.ts")).toBe(true);
		expect(items.get("/root/src/new.ts")?.name).toBe("new.ts");
	});

	test("skips directories for create events", () => {
		const items = new Map<
			string,
			{ absolutePath: string; relativePath: string; name: string }
		>();
		applySearchPatchEvent({
			itemsByPath: items,
			rootPath: "/root",
			includeHidden: false,
			event: {
				kind: "create",
				absolutePath: "/root/src/newdir",
				isDirectory: true,
			},
		});
		expect(items.size).toBe(0);
	});
});
