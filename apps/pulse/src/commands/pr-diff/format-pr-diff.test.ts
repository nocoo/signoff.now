import { describe, expect, test } from "bun:test";
import type { PullRequestDiffReport } from "../types.ts";
import { formatPrDiffReport } from "./format-pr-diff.ts";

function makeReport(
	overrides?: Partial<PullRequestDiffReport>,
): PullRequestDiffReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 150,
		repository: {
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
		},
		pullRequest: { number: 42 },
		diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n+new line",
		files: [
			{
				path: "a.ts",
				additions: 1,
				deletions: 0,
				changeType: "MODIFIED",
				patch: "@@ -1 +1,2 @@\n+new line",
			},
		],
		...overrides,
	};
}

describe("formatPrDiffReport", () => {
	test("includes PR number and repo", () => {
		const output = formatPrDiffReport(makeReport());
		expect(output).toContain("PR #42");
		expect(output).toContain("acme/repo");
	});

	test("includes file summary", () => {
		const output = formatPrDiffReport(makeReport());
		expect(output).toContain("Files (1)");
		expect(output).toContain("M a.ts  +1 -0");
	});

	test("includes diff content", () => {
		const output = formatPrDiffReport(makeReport());
		expect(output).toContain("─── Diff ───");
		expect(output).toContain("diff --git");
		expect(output).toContain("+new line");
	});

	test("includes duration", () => {
		const output = formatPrDiffReport(makeReport());
		expect(output).toContain("Completed in 150ms");
	});

	test("handles empty files", () => {
		const output = formatPrDiffReport(makeReport({ files: [] }));
		expect(output).not.toContain("Files");
	});

	test("handles empty diff", () => {
		const output = formatPrDiffReport(makeReport({ diff: "" }));
		expect(output).not.toContain("─── Diff ───");
	});
});
