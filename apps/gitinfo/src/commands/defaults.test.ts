import { describe, expect, it } from "bun:test";
import {
	EMPTY_BRANCHES,
	EMPTY_CONFIG,
	EMPTY_CONTRIBUTORS,
	EMPTY_FILES,
	EMPTY_LOGS,
	EMPTY_META,
	EMPTY_STATUS,
	EMPTY_TAGS,
} from "./defaults.ts";
import { formatPretty, formatPrettySection } from "./pretty/format.ts";
import type { GitInfoReport } from "./types.ts";

function buildReportWithDefaults(
	overrides: Partial<GitInfoReport> = {},
): GitInfoReport {
	return {
		generatedAt: "2024-01-01T00:00:00Z",
		tiers: ["instant", "moderate"],
		durationMs: 0,
		meta: EMPTY_META,
		status: EMPTY_STATUS,
		branches: EMPTY_BRANCHES,
		logs: EMPTY_LOGS,
		contributors: EMPTY_CONTRIBUTORS,
		tags: EMPTY_TAGS,
		files: EMPTY_FILES,
		config: EMPTY_CONFIG,
		errors: [],
		...overrides,
	};
}

describe("section defaults", () => {
	it("EMPTY_META has valid structure", () => {
		expect(EMPTY_META.gitVersion).toBe("unknown");
		expect(EMPTY_META.remotes).toEqual([]);
		expect(EMPTY_META.head).toBeNull();
	});

	it("EMPTY_STATUS has valid structure", () => {
		expect(EMPTY_STATUS.staged).toEqual([]);
		expect(EMPTY_STATUS.stashCount).toBe(0);
		expect(EMPTY_STATUS.repoState).toBe("clean");
	});

	it("EMPTY_BRANCHES has valid structure", () => {
		expect(EMPTY_BRANCHES.current).toBeNull();
		expect(EMPTY_BRANCHES.local).toEqual([]);
		expect(EMPTY_BRANCHES.totalLocal).toBe(0);
	});

	it("EMPTY_LOGS has valid structure", () => {
		expect(EMPTY_LOGS.totalCommits).toBe(0);
		expect(EMPTY_LOGS.lastCommit).toBeNull();
	});

	it("EMPTY_CONTRIBUTORS has valid structure", () => {
		expect(EMPTY_CONTRIBUTORS.authors).toEqual([]);
		expect(EMPTY_CONTRIBUTORS.totalAuthors).toBe(0);
	});

	it("EMPTY_TAGS has valid structure", () => {
		expect(EMPTY_TAGS.count).toBe(0);
		expect(EMPTY_TAGS.tags).toEqual([]);
	});

	it("EMPTY_FILES has valid structure", () => {
		expect(EMPTY_FILES.trackedCount).toBe(0);
		expect(EMPTY_FILES.largestTracked).toEqual([]);
	});

	it("EMPTY_CONFIG has valid structure", () => {
		expect(EMPTY_CONFIG.gitDirSizeKiB).toBe(0);
		expect(EMPTY_CONFIG.hooks).toEqual([]);
		expect(EMPTY_CONFIG.objectStats.count).toBe(0);
	});
});

describe("report with defaults survives formatters", () => {
	it("formatPretty does not throw with all-default sections", () => {
		const report = buildReportWithDefaults();
		const output = formatPretty(report);
		expect(output).toContain("gitinfo");
		expect(output).toContain("Meta");
		expect(output).toContain("Status");
		expect(output).toContain("Branches");
		expect(output).toContain("Logs");
		expect(output).toContain("Contributors");
		expect(output).toContain("Tags");
		expect(output).toContain("Files");
		expect(output).toContain("Config");
	});

	it("formatPretty handles errors array with default sections", () => {
		const report = buildReportWithDefaults({
			errors: [
				{ collector: "meta", message: "exec failed" },
				{ collector: "files", message: "timeout" },
			],
		});
		const output = formatPretty(report);
		expect(output).toContain("2 collector error");
	});

	it("formatPrettySection works for each section with defaults", () => {
		const report = buildReportWithDefaults();
		const sections = [
			"meta",
			"status",
			"branches",
			"logs",
			"contributors",
			"tags",
			"files",
			"config",
		];
		for (const section of sections) {
			const output = formatPrettySection(report, section);
			expect(output.length).toBeGreaterThan(0);
		}
	});

	it("JSON.stringify does not throw with all-default sections", () => {
		const report = buildReportWithDefaults();
		const json = JSON.stringify(report);
		const parsed = JSON.parse(json);
		expect(parsed.meta.gitVersion).toBe("unknown");
		expect(parsed.status.staged).toEqual([]);
	});
});
