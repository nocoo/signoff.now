import { describe, expect, it } from "bun:test";
import type { GitInfoReport } from "../commands/types.ts";
import { formatJson, formatJsonPretty } from "./output.ts";

const mockReport: GitInfoReport = {
	generatedAt: "2024-01-01T00:00:00Z",
	tiers: ["instant", "moderate"],
	durationMs: 42,
	meta: {
		gitVersion: "2.43.0",
		repoRoot: "/repo",
		repoName: "test",
		head: "abc123",
		headShort: "abc123",
		currentBranch: "main",
		defaultBranch: "main",
		remotes: [],
		isShallow: false,
		firstCommitAuthorDate: null,
	},
	status: {
		staged: [],
		modified: [],
		untracked: [],
		conflicted: [],
		stashCount: 0,
		repoState: "clean",
	},
	branches: {
		current: "main",
		local: [],
		remote: [],
		totalLocal: 1,
		totalRemote: 0,
	},
	logs: {
		totalCommits: 10,
		totalMerges: 0,
		firstCommitDate: null,
		lastCommit: null,
	},
	contributors: {
		authors: [],
		totalAuthors: 0,
		activeRecent: 0,
	},
	tags: {
		count: 0,
		tags: [],
		latestReachableTag: null,
		commitsSinceTag: null,
	},
	files: {
		trackedCount: 5,
		typeDistribution: { ts: 3, json: 2 },
		totalLines: 100,
		largestTracked: [],
	},
	config: {
		gitDirSizeKiB: 100,
		objectStats: {
			count: 0,
			size: 0,
			inPack: 0,
			packs: 0,
			sizePackKiB: 0,
			prunePackable: 0,
			garbage: 0,
			sizeGarbageKiB: 0,
		},
		worktreeCount: 1,
		hooks: [],
		localConfig: {},
	},
	errors: [],
};

describe("formatJson", () => {
	it("formats full report as compact JSON", () => {
		const output = formatJson(mockReport, null);
		const parsed = JSON.parse(output);
		expect(parsed.meta.gitVersion).toBe("2.43.0");
		expect(output).not.toContain("\n");
	});

	it("formats single section as compact JSON", () => {
		const output = formatJson(mockReport, "meta");
		const parsed = JSON.parse(output);
		expect(parsed.gitVersion).toBe("2.43.0");
	});
});

describe("formatJsonPretty", () => {
	it("formats full report with indentation", () => {
		const output = formatJsonPretty(mockReport, null);
		expect(output).toContain("\n");
		expect(output).toContain("  ");
		const parsed = JSON.parse(output);
		expect(parsed.durationMs).toBe(42);
	});

	it("formats single section with indentation", () => {
		const output = formatJsonPretty(mockReport, "files");
		const parsed = JSON.parse(output);
		expect(parsed.trackedCount).toBe(5);
	});
});
