import { describe, expect, it } from "bun:test";
import type { GitInfoReport } from "../types.ts";
import { formatPretty, formatPrettySection } from "./format.ts";

const mockReport: GitInfoReport = {
	generatedAt: "2024-01-01T00:00:00Z",
	tiers: ["instant", "moderate"],
	durationMs: 42,
	meta: {
		gitVersion: "2.43.0",
		repoRoot: "/repo",
		repoName: "test-repo",
		head: "abc123def",
		headShort: "abc123d",
		currentBranch: "main",
		defaultBranch: "main",
		remotes: [
			{
				name: "origin",
				fetchUrl: "git@github.com:org/test-repo.git",
				pushUrls: ["git@github.com:org/test-repo.git"],
			},
		],
		isShallow: false,
		firstCommitAuthorDate: "2024-01-01T00:00:00Z",
	},
	status: {
		staged: [],
		modified: [{ path: "file.ts", indexStatus: ".", workTreeStatus: "M" }],
		untracked: ["new.ts"],
		conflicted: [],
		stashCount: 1,
		repoState: "clean",
	},
	branches: {
		current: "main",
		local: [
			{
				name: "main",
				upstream: "origin/main",
				aheadBehind: { ahead: 2, behind: 0 },
				lastCommitDate: "2024-01-01T00:00:00Z",
				isMerged: false,
			},
			{
				name: "feature",
				upstream: null,
				aheadBehind: null,
				lastCommitDate: "2024-01-01T00:00:00Z",
				isMerged: true,
			},
		],
		remote: ["origin/main"],
		totalLocal: 2,
		totalRemote: 1,
	},
	logs: {
		totalCommits: 100,
		totalMerges: 5,
		firstCommitDate: "2024-01-01T00:00:00Z",
		lastCommit: {
			sha: "abc123def456",
			shaShort: "abc123d",
			author: "Dev <dev@test.com>",
			date: "2024-06-01T12:00:00Z",
			subject: "feat: add feature",
		},
		conventionalTypes: { feat: 50, fix: 30, docs: 20 },
	},
	contributors: {
		authors: [
			{ name: "Dev", email: "dev@test.com", commits: 80 },
			{ name: "Other", email: "other@test.com", commits: 20 },
		],
		totalAuthors: 2,
		activeRecent: 1,
	},
	tags: {
		count: 3,
		tags: [
			{
				name: "v1.0.0",
				type: "annotated",
				sha: "abc",
				date: "2024-01-01",
				message: "Release",
			},
			{
				name: "v0.1.0",
				type: "lightweight",
				sha: "def",
				date: null,
				message: null,
			},
		],
		latestReachableTag: "v1.0.0",
		commitsSinceTag: 5,
	},
	files: {
		trackedCount: 50,
		typeDistribution: { ts: 30, json: 10, md: 10 },
		totalLines: 5000,
		largestTracked: [
			{ path: "big-file.ts", sizeBytes: 102400 },
			{ path: "data.json", sizeBytes: 51200 },
		],
	},
	config: {
		gitDirSizeKiB: 500,
		objectStats: {
			count: 42,
			size: 168,
			inPack: 1234,
			packs: 3,
			sizePackKiB: 5678,
			prunePackable: 0,
			garbage: 0,
			sizeGarbageKiB: 0,
		},
		worktreeCount: 1,
		hooks: ["pre-commit", "pre-push"],
		localConfig: {},
	},
	errors: [],
};

describe("formatPretty", () => {
	it("formats full report with all sections", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("gitinfo");
		expect(output).toContain("Meta");
		expect(output).toContain("Status");
		expect(output).toContain("Branches");
		expect(output).toContain("Logs");
		expect(output).toContain("Contributors");
		expect(output).toContain("Tags");
		expect(output).toContain("Files");
		expect(output).toContain("Config");
		expect(output).toContain("2.43.0");
		expect(output).toContain("test-repo");
	});

	it("shows collector errors when present", () => {
		const reportWithErrors = {
			...mockReport,
			errors: [{ collector: "meta", message: "failed" }],
		};
		const output = formatPretty(reportWithErrors);
		expect(output).toContain("1 collector error");
	});

	it("includes remote details", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("origin");
		expect(output).toContain("github.com");
	});

	it("includes branch tracking info", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("origin/main");
		expect(output).toContain("(merged)");
	});

	it("includes last commit details", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("abc123d");
		expect(output).toContain("feat: add feature");
	});

	it("includes contributor info", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("Dev");
		expect(output).toContain("80 commits");
	});

	it("includes tag info", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("v1.0.0");
		expect(output).toContain("annotated");
	});

	it("includes file distribution", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain(".ts:");
		expect(output).toContain("5000");
	});

	it("includes hooks", () => {
		const output = formatPretty(mockReport);
		expect(output).toContain("pre-commit");
	});
});

describe("formatPrettySection", () => {
	it("formats single section", () => {
		const output = formatPrettySection(mockReport, "meta");
		expect(output).toContain("Meta");
		expect(output).toContain("2.43.0");
		expect(output).not.toContain("Status");
	});

	it("falls back to JSON for unknown section", () => {
		const output = formatPrettySection(mockReport, "invalid");
		expect(output).toContain('"generatedAt"');
	});
});
