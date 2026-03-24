import { describe, expect, test } from "bun:test";
import type { PrsReport } from "../commands/types.ts";
import { formatOutput } from "./output.ts";

function makeReport(): PrsReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 42,
		repository: {
			owner: "acme",
			repo: "widget",
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
		prs: [
			{
				number: 7,
				title: "Add tests",
				state: "open",
				draft: false,
				merged: false,
				mergedAt: null,
				author: "alice",
				createdAt: "2025-01-10T08:00:00Z",
				updatedAt: "2025-01-12T14:00:00Z",
				closedAt: null,
				headBranch: "add-tests",
				baseBranch: "main",
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

describe("formatOutput", () => {
	test("returns compact JSON when pretty=false", () => {
		const output = formatOutput(makeReport(), false);
		const parsed = JSON.parse(output);
		expect(parsed.repository.owner).toBe("acme");
		expect(parsed.prs).toHaveLength(1);
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
		const parsed = JSON.parse(json) as PrsReport;
		expect(parsed.repository).toEqual(report.repository);
		expect(parsed.identity).toEqual(report.identity);
		expect(parsed.prs).toHaveLength(report.prs.length);
	});
});
