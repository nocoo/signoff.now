import { describe, expect, test } from "bun:test";
import type { RepositoryReport } from "../types.ts";
import { formatRepoReport } from "./format-repo.ts";

function makeReport(
	overrides?: Partial<RepositoryReport["repository"]>,
): RepositoryReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 150,
		repository: {
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
			description: "A cool project",
			homepageUrl: "https://acme.dev",
			stargazerCount: 1234,
			forkCount: 56,
			isArchived: false,
			isPrivate: false,
			primaryLanguage: { name: "TypeScript", color: "#3178c6" },
			languages: [
				{ name: "TypeScript", color: "#3178c6" },
				{ name: "JavaScript", color: "#f1e05a" },
			],
			defaultBranchRef: "main",
			licenseInfo: "MIT",
			topics: ["cli", "typescript"],
			pushedAt: "2025-01-15T10:00:00Z",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2025-01-15T09:00:00Z",
			...overrides,
		},
	};
}

describe("formatRepoReport", () => {
	test("includes owner/name header", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("acme/repo");
	});

	test("includes description", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("A cool project");
	});

	test("omits description when null", () => {
		const output = formatRepoReport(makeReport({ description: null }));
		const lines = output.split("\n");
		// Second line should be the URL, not a blank description
		expect(lines[1]).toBe("https://github.com/acme/repo");
	});

	test("includes url", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("https://github.com/acme/repo");
	});

	test("includes language info", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Language: TypeScript");
		expect(output).toContain("Languages: TypeScript, JavaScript");
	});

	test("includes license", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("License: MIT");
	});

	test("includes star and fork counts", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Stars: 1234");
		expect(output).toContain("Forks: 56");
	});

	test("includes default branch", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Default branch: main");
	});

	test("includes homepage", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Homepage: https://acme.dev");
	});

	test("omits homepage when null", () => {
		const output = formatRepoReport(makeReport({ homepageUrl: null }));
		expect(output).not.toContain("Homepage:");
	});

	test("omits default branch when null", () => {
		const output = formatRepoReport(makeReport({ defaultBranchRef: null }));
		expect(output).not.toContain("Default branch:");
	});

	test("includes topics", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Topics: cli, typescript");
	});

	test("omits topics when empty", () => {
		const output = formatRepoReport(makeReport({ topics: [] }));
		expect(output).not.toContain("Topics:");
	});

	test("shows private flag", () => {
		const output = formatRepoReport(makeReport({ isPrivate: true }));
		expect(output).toContain("Flags: private");
	});

	test("shows archived flag", () => {
		const output = formatRepoReport(makeReport({ isArchived: true }));
		expect(output).toContain("Flags: archived");
	});

	test("shows both flags", () => {
		const output = formatRepoReport(
			makeReport({ isPrivate: true, isArchived: true }),
		);
		expect(output).toContain("Flags: private, archived");
	});

	test("omits flags line when neither set", () => {
		const output = formatRepoReport(makeReport());
		expect(output).not.toContain("Flags:");
	});

	test("includes timestamps", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Created: 2024-01-01T00:00:00Z");
		expect(output).toContain("Updated: 2025-01-15T09:00:00Z");
		expect(output).toContain("Pushed:  2025-01-15T10:00:00Z");
	});

	test("includes duration", () => {
		const output = formatRepoReport(makeReport());
		expect(output).toContain("Completed in 150ms");
	});
});
