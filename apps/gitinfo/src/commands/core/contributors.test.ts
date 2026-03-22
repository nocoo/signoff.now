import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectContributors,
	getActiveRecent,
	getAuthorStats,
	getAuthors,
} from "./contributors.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getAuthors", () => {
	it("parses shortlog output into author summaries", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": {
				stdout: [
					"    42\tAlice Smith <alice@example.com>",
					"    17\tBob Jones <bob@example.com>",
				].join("\n"),
			},
		});
		const authors = await getAuthors(exec, CWD, true);
		expect(authors).toEqual([
			{ name: "Alice Smith", email: "alice@example.com", commits: 42 },
			{ name: "Bob Jones", email: "bob@example.com", commits: 17 },
		]);
	});

	it("returns empty array when !hasHead", async () => {
		const exec = mockExec({});
		expect(await getAuthors(exec, CWD, false)).toEqual([]);
	});

	it("returns empty array on non-zero exit code", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getAuthors(exec, CWD, true)).toEqual([]);
	});

	it("handles single author", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": {
				stdout: "     1\tSolo Dev <solo@dev.com>",
			},
		});
		const authors = await getAuthors(exec, CWD, true);
		expect(authors).toEqual([
			{ name: "Solo Dev", email: "solo@dev.com", commits: 1 },
		]);
	});

	it("handles empty output", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": { stdout: "" },
		});
		expect(await getAuthors(exec, CWD, true)).toEqual([]);
	});
});

describe("getActiveRecent", () => {
	it("counts recently active authors", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges --since=90 days ago HEAD": {
				stdout: [
					"    10\tAlice Smith <alice@example.com>",
					"     3\tBob Jones <bob@example.com>",
					"     1\tCharlie <charlie@example.com>",
				].join("\n"),
			},
		});
		expect(await getActiveRecent(exec, CWD, true)).toBe(3);
	});

	it("returns 0 when !hasHead", async () => {
		const exec = mockExec({});
		expect(await getActiveRecent(exec, CWD, false)).toBe(0);
	});

	it("returns 0 on non-zero exit code", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges --since=90 days ago HEAD": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getActiveRecent(exec, CWD, true)).toBe(0);
	});

	it("returns 0 when no recent activity", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges --since=90 days ago HEAD": {
				stdout: "",
			},
		});
		expect(await getActiveRecent(exec, CWD, true)).toBe(0);
	});
});

describe("getAuthorStats", () => {
	it("parses numstat log into per-author stats", async () => {
		const exec = mockExec({
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: [
					"Alice <alice@example.com>",
					"",
					"10\t5\tsrc/app.ts",
					"20\t3\tsrc/utils.ts",
					"",
					"Bob <bob@example.com>",
					"",
					"7\t2\tsrc/index.ts",
				].join("\n"),
			},
		});
		const stats = await getAuthorStats(exec, CWD, true);
		expect(stats).toEqual([
			{
				name: "Alice",
				email: "alice@example.com",
				linesAdded: 30,
				linesDeleted: 8,
			},
			{ name: "Bob", email: "bob@example.com", linesAdded: 7, linesDeleted: 2 },
		]);
	});

	it("returns undefined when !hasHead", async () => {
		const exec = mockExec({});
		expect(await getAuthorStats(exec, CWD, false)).toBeUndefined();
	});

	it("returns undefined on non-zero exit code", async () => {
		const exec = mockExec({
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getAuthorStats(exec, CWD, true)).toBeUndefined();
	});

	it("skips binary files with dash values", async () => {
		const exec = mockExec({
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: [
					"Alice <alice@example.com>",
					"",
					"10\t5\tsrc/app.ts",
					"-\t-\timage.png",
					"3\t1\tsrc/lib.ts",
				].join("\n"),
			},
		});
		const stats = await getAuthorStats(exec, CWD, true);
		expect(stats).toEqual([
			{
				name: "Alice",
				email: "alice@example.com",
				linesAdded: 13,
				linesDeleted: 6,
			},
		]);
	});

	it("accumulates stats across multiple commits by same author", async () => {
		const exec = mockExec({
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: [
					"Alice <alice@example.com>",
					"",
					"10\t5\tsrc/app.ts",
					"",
					"Alice <alice@example.com>",
					"",
					"20\t10\tsrc/other.ts",
				].join("\n"),
			},
		});
		const stats = await getAuthorStats(exec, CWD, true);
		expect(stats).toEqual([
			{
				name: "Alice",
				email: "alice@example.com",
				linesAdded: 30,
				linesDeleted: 15,
			},
		]);
	});

	it("handles empty output", async () => {
		const exec = mockExec({
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: "",
			},
		});
		const stats = await getAuthorStats(exec, CWD, true);
		expect(stats).toEqual([]);
	});
});

describe("collectContributors", () => {
	it("collects all contributor fields without slow tier", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": {
				stdout: [
					"    42\tAlice <alice@example.com>",
					"    17\tBob <bob@example.com>",
				].join("\n"),
			},
			"git shortlog -sne --no-merges --since=90 days ago HEAD": {
				stdout: "     5\tAlice <alice@example.com>",
			},
		});
		const result = await collectContributors(exec, CWD, true, false);
		expect(result.authors).toHaveLength(2);
		expect(result.totalAuthors).toBe(2);
		expect(result.activeRecent).toBe(1);
		expect(result.authorStats).toBeUndefined();
	});

	it("includes authorStats when includeSlow is true", async () => {
		const exec = mockExec({
			"git shortlog -sne --no-merges HEAD": {
				stdout: "    10\tAlice <alice@example.com>",
			},
			"git shortlog -sne --no-merges --since=90 days ago HEAD": {
				stdout: "     3\tAlice <alice@example.com>",
			},
			"git log --numstat --pretty=tformat:%aN <%aE> -n 1000 HEAD": {
				stdout: ["Alice <alice@example.com>", "", "100\t50\tsrc/app.ts"].join(
					"\n",
				),
			},
		});
		const result = await collectContributors(exec, CWD, true, true);
		expect(result.authors).toHaveLength(1);
		expect(result.totalAuthors).toBe(1);
		expect(result.activeRecent).toBe(1);
		expect(result.authorStats).toEqual([
			{
				name: "Alice",
				email: "alice@example.com",
				linesAdded: 100,
				linesDeleted: 50,
			},
		]);
	});

	it("handles empty repo (no HEAD)", async () => {
		const exec = mockExec({});
		const result = await collectContributors(exec, CWD, false, true);
		expect(result.authors).toEqual([]);
		expect(result.totalAuthors).toBe(0);
		expect(result.activeRecent).toBe(0);
		expect(result.authorStats).toBeUndefined();
	});
});
