import { describe, expect, test } from "bun:test";
import type {
	PullRequestDetailReport,
	PullRequestDiffReport,
	PullRequestSearchReport,
	PullRequestsReport,
	RepositoryReport,
} from "../commands/types.ts";
import { formatOutput } from "./output.ts";

function makeReport(): PullRequestsReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 42,
		repository: {
			owner: "acme",
			name: "widget",
			url: "https://github.com/acme/widget",
		},
		identity: {
			resolvedUser: "alice",
			resolvedVia: "direct",
		},
		filters: {
			state: "open",
			author: null,
			limit: 0,
		},
		totalCount: 1,
		hasNextPage: false,
		endCursor: null,
		pullRequests: [
			{
				number: 7,
				title: "Add tests",
				state: "OPEN",
				isDraft: false,
				merged: false,
				mergedAt: null,
				author: "alice",
				createdAt: "2025-01-10T08:00:00Z",
				updatedAt: "2025-01-12T14:00:00Z",
				closedAt: null,
				headRefName: "add-tests",
				baseRefName: "main",
				url: "https://github.com/acme/widget/pull/7",
				labels: ["test"],
				reviewDecision: "APPROVED",
				additions: 100,
				deletions: 5,
				changedFiles: 4,
			},
		],
	};
}

function makeDetailReport(): PullRequestDetailReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 55,
		repository: {
			owner: "acme",
			name: "widget",
			url: "https://github.com/acme/widget",
		},
		pullRequest: {
			number: 7,
			title: "Add tests",
			state: "OPEN",
			isDraft: false,
			merged: false,
			mergedAt: null,
			author: "alice",
			createdAt: "2025-01-10T08:00:00Z",
			updatedAt: "2025-01-12T14:00:00Z",
			closedAt: null,
			headRefName: "add-tests",
			baseRefName: "main",
			url: "https://github.com/acme/widget/pull/7",
			labels: [],
			reviewDecision: null,
			additions: 100,
			deletions: 5,
			changedFiles: 4,
			body: "description",
			mergeable: "MERGEABLE",
			mergeStateStatus: "CLEAN",
			mergedBy: null,
			totalCommentsCount: 0,
			participants: ["alice"],
			reviewRequests: [],
			assignees: [],
			milestone: null,
			headRefOid: "abc123",
			baseRefOid: "def456",
			isCrossRepository: false,
			reviews: [],
			comments: [],
			commits: [],
			files: [],
		},
	};
}

function makeDiffReport(): PullRequestDiffReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 30,
		repository: {
			owner: "acme",
			name: "widget",
			url: "https://github.com/acme/widget",
		},
		pullRequest: { number: 7 },
		diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
		files: [
			{
				path: "file.ts",
				additions: 1,
				deletions: 1,
				changeType: "MODIFIED",
				patch: "@@ -1 +1 @@\n-old\n+new",
			},
		],
	};
}

function makeSearchReport(): PullRequestSearchReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 80,
		repository: {
			owner: "acme",
			name: "widget",
			url: "https://github.com/acme/widget",
		},
		identity: {
			resolvedUser: "alice",
			resolvedVia: "direct",
		},
		query: "label:bug",
		totalCount: 1,
		hasNextPage: false,
		endCursor: null,
		pullRequests: [
			{
				number: 42,
				title: "Fix bug",
				state: "OPEN",
				isDraft: false,
				merged: false,
				mergedAt: null,
				author: "alice",
				createdAt: "2025-01-10T08:00:00Z",
				updatedAt: "2025-01-12T14:00:00Z",
				closedAt: null,
				headRefName: "fix-bug",
				baseRefName: "main",
				url: "https://github.com/acme/widget/pull/42",
				labels: ["bug"],
				reviewDecision: null,
				additions: 5,
				deletions: 3,
				changedFiles: 1,
			},
		],
	};
}

function makeRepoReport(): RepositoryReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 120,
		repository: {
			owner: "acme",
			name: "widget",
			url: "https://github.com/acme/widget",
			description: "A cool widget",
			homepageUrl: null,
			stargazerCount: 100,
			forkCount: 10,
			isArchived: false,
			isPrivate: false,
			primaryLanguage: { name: "TypeScript", color: "#3178c6" },
			languages: [{ name: "TypeScript", color: "#3178c6" }],
			defaultBranchRef: "main",
			licenseInfo: "MIT",
			topics: ["cli"],
			pushedAt: "2025-01-15T10:00:00Z",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2025-01-15T09:00:00Z",
		},
	};
}

describe("formatOutput", () => {
	test("returns compact JSON when pretty=false", () => {
		const output = formatOutput(makeReport(), false);
		const parsed = JSON.parse(output);
		expect(parsed.repository.owner).toBe("acme");
		expect(parsed.pullRequests).toHaveLength(1);
		// Compact JSON: no newlines in the middle
		expect(output).not.toContain("\n");
	});

	test("returns human-readable text when pretty=true", () => {
		const output = formatOutput(makeReport(), true);
		expect(output).toContain("acme/widget");
		expect(output).toContain("#7");
		expect(output).toContain("Identity: alice");
		// Pretty format contains newlines
		expect(output).toContain("\n");
	});

	test("JSON output can be round-tripped", () => {
		const report = makeReport();
		const json = formatOutput(report, false);
		const parsed = JSON.parse(json) as PullRequestsReport;
		expect(parsed.repository).toEqual(report.repository);
		expect(parsed.identity).toEqual(report.identity);
		expect(parsed.pullRequests).toHaveLength(report.pullRequests.length);
	});

	test("formats search report when pretty=true", () => {
		const output = formatOutput(makeSearchReport(), true);
		expect(output).toContain("search: label:bug");
		expect(output).toContain("#42");
	});

	test("formats diff report when pretty=true", () => {
		const output = formatOutput(makeDiffReport(), true);
		expect(output).toContain("file.ts");
		expect(output).toContain("PR #7");
	});

	test("formats detail report when pretty=true", () => {
		const output = formatOutput(makeDetailReport(), true);
		expect(output).toContain("#7");
		expect(output).toContain("Add tests");
	});

	test("formats repo report when pretty=true", () => {
		const output = formatOutput(makeRepoReport(), true);
		expect(output).toContain("acme/widget");
		expect(output).toContain("A cool widget");
		expect(output).toContain("Stars: 100");
	});
});
