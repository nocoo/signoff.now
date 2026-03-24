import { describe, expect, test } from "bun:test";
import type { PrDetail, PrDetailReport } from "../types.ts";
import { formatPrDetailReport } from "./format-pr-detail.ts";

function makePrDetail(overrides?: Partial<PrDetail>): PrDetail {
	return {
		number: 42,
		title: "Add feature X",
		state: "open",
		draft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-16T12:00:00Z",
		closedAt: null,
		headBranch: "feature-x",
		baseBranch: "main",
		url: "https://github.com/acme/repo/pull/42",
		labels: ["enhancement"],
		reviewDecision: "APPROVED",
		additions: 50,
		deletions: 10,
		changedFiles: 3,
		body: "## Summary\nAdds feature X",
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		mergedBy: null,
		totalCommentsCount: 5,
		participants: ["alice", "bob"],
		requestedReviewers: ["charlie"],
		assignees: ["alice"],
		milestone: "v1.0",
		headRefOid: "abc1234",
		baseRefOid: "def5678",
		isCrossRepository: false,
		reviews: [
			{
				author: "bob",
				state: "APPROVED",
				body: "LGTM",
				submittedAt: "2025-01-16T10:00:00Z",
				comments: [],
			},
		],
		comments: [
			{
				author: "bob",
				body: "Looks good",
				createdAt: "2025-01-15T11:00:00Z",
				updatedAt: "2025-01-15T11:00:00Z",
			},
		],
		commits: [
			{
				oid: "abc1234",
				message: "feat: add feature X",
				author: "alice",
				authoredDate: "2025-01-15T10:00:00Z",
				statusCheckRollup: "SUCCESS",
				checkRuns: [],
			},
		],
		files: [
			{
				path: "src/feature.ts",
				additions: 50,
				deletions: 10,
				changeType: "MODIFIED",
			},
		],
		...overrides,
	};
}

function makeReport(overrides?: Partial<PrDetailReport>): PrDetailReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 456,
		repository: {
			owner: "acme",
			repo: "repo",
			url: "https://github.com/acme/repo",
		},
		pr: makePrDetail(),
		...overrides,
	};
}

describe("formatPrDetailReport", () => {
	test("includes PR number and title in header", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("#42 Add feature X");
	});

	test("includes repo and branch info", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("acme/repo");
		expect(output).toContain("feature-x → main");
	});

	test("includes author", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("@alice");
	});

	test("includes merge status", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("mergeable (clean)");
	});

	test("includes state icon for open PR", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("●");
	});

	test("includes state icon for merged PR", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ merged: true }) }),
		);
		expect(output).toContain("⬣");
	});

	test("includes draft indication", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ draft: true }) }),
		);
		expect(output).toContain("(draft)");
	});

	test("includes description section", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("─── Description ───");
		expect(output).toContain("Adds feature X");
	});

	test("skips description when body is empty", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ body: "" }) }),
		);
		expect(output).not.toContain("─── Description ───");
	});

	test("includes reviews section", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("─── Reviews (1) ───");
		expect(output).toContain("@bob — approved");
	});

	test("includes comments section", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("─── Comments (1) ───");
		expect(output).toContain("Looks good");
	});

	test("includes commits section", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("─── Commits (1) ───");
		expect(output).toContain("abc1234 feat: add feature X");
		expect(output).toContain("[success]");
	});

	test("includes files section", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("─── Files (1) ───");
		expect(output).toContain("M src/feature.ts");
	});

	test("includes duration", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("Completed in 456ms");
	});

	test("includes milestone when present", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("Milestone: v1.0");
	});

	test("includes labels when present", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("Labels:    enhancement");
	});

	test("includes stats", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("+50 -10 (3 files)");
	});

	test("includes assignees", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("Assignees: @alice");
	});

	test("includes reviewers", () => {
		const output = formatPrDetailReport(makeReport());
		expect(output).toContain("Reviewers: charlie");
	});

	test("shows mergedBy when PR is merged", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ mergedBy: "deployer" }) }),
		);
		expect(output).toContain("Merged by: @deployer");
	});

	test("skips reviews section when empty", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ reviews: [] }) }),
		);
		expect(output).not.toContain("─── Reviews");
	});

	test("skips comments section when empty", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ comments: [] }) }),
		);
		expect(output).not.toContain("─── Comments");
	});

	test("skips commits section when empty", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ commits: [] }) }),
		);
		expect(output).not.toContain("─── Commits");
	});

	test("skips files section when empty", () => {
		const output = formatPrDetailReport(
			makeReport({ pr: makePrDetail({ files: [] }) }),
		);
		expect(output).not.toContain("─── Files");
	});
});
