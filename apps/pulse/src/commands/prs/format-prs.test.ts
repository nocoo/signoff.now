import { describe, expect, test } from "bun:test";
import type { PullRequestInfo, PullRequestsReport } from "../types.ts";
import { formatPrLine, formatPrsReport } from "./format-prs.ts";

function makePr(overrides?: Partial<PullRequestInfo>): PullRequestInfo {
	return {
		number: 42,
		title: "Add feature X",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-16T12:00:00Z",
		closedAt: null,
		headRefName: "feature-x",
		baseRefName: "main",
		url: "https://github.com/acme/repo/pull/42",
		labels: [],
		reviewDecision: null,
		additions: 50,
		deletions: 10,
		changedFiles: 3,
		...overrides,
	};
}

function makeReport(
	overrides?: Partial<PullRequestsReport>,
): PullRequestsReport {
	return {
		generatedAt: "2025-01-15T10:00:00Z",
		durationMs: 123,
		repository: {
			owner: "acme",
			name: "repo",
			url: "https://github.com/acme/repo",
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
		pullRequests: [makePr()],
		...overrides,
	};
}

describe("formatPrLine", () => {
	test("formats open PR with dot icon", () => {
		const line = formatPrLine(makePr());
		expect(line).toContain("●");
		expect(line).toContain("#42");
		expect(line).toContain("Add feature X");
		expect(line).toContain("+50 -10");
		expect(line).toContain("@alice");
	});

	test("formats draft PR with circle icon", () => {
		const line = formatPrLine(makePr({ isDraft: true }));
		expect(line).toContain("◌");
	});

	test("formats merged PR with hexagon icon", () => {
		const line = formatPrLine(makePr({ merged: true }));
		expect(line).toContain("⬣");
	});

	test("formats closed PR with empty circle icon", () => {
		const line = formatPrLine(
			makePr({ state: "CLOSED", merged: false, isDraft: false }),
		);
		expect(line).toContain("○");
	});

	test("includes labels", () => {
		const line = formatPrLine(makePr({ labels: ["bug", "urgent"] }));
		expect(line).toContain("[bug, urgent]");
	});

	test("excludes labels section when empty", () => {
		const line = formatPrLine(makePr({ labels: [] }));
		expect(line).not.toContain("[");
		expect(line).not.toContain("]");
	});

	test("includes review decision", () => {
		const line = formatPrLine(makePr({ reviewDecision: "APPROVED" }));
		expect(line).toContain("(approved)");
	});

	test("formats CHANGES_REQUESTED", () => {
		const line = formatPrLine(makePr({ reviewDecision: "CHANGES_REQUESTED" }));
		expect(line).toContain("(changes requested)");
	});

	test("formats REVIEW_REQUIRED", () => {
		const line = formatPrLine(makePr({ reviewDecision: "REVIEW_REQUIRED" }));
		expect(line).toContain("(review required)");
	});

	test("excludes review decision when null", () => {
		const line = formatPrLine(makePr({ reviewDecision: null }));
		expect(line).not.toContain("(");
	});
});

describe("formatPrsReport", () => {
	test("includes repo header", () => {
		const output = formatPrsReport(makeReport());
		expect(output).toContain("acme/repo — 1 PR(s)");
	});

	test("includes identity info", () => {
		const output = formatPrsReport(makeReport());
		expect(output).toContain("Identity: alice (via direct)");
	});

	test("includes state filter", () => {
		const output = formatPrsReport(makeReport());
		expect(output).toContain("state=open");
	});

	test("includes author filter when set", () => {
		const output = formatPrsReport(
			makeReport({ filters: { state: "open", author: "bob", limit: 0 } }),
		);
		expect(output).toContain("author=bob");
	});

	test("includes limit filter when set", () => {
		const output = formatPrsReport(
			makeReport({ filters: { state: "open", author: null, limit: 5 } }),
		);
		expect(output).toContain("limit=5");
	});

	test("excludes limit filter when zero", () => {
		const output = formatPrsReport(makeReport());
		expect(output).not.toContain("limit=");
	});

	test("shows 'No pull requests found' for empty list", () => {
		const output = formatPrsReport(
			makeReport({ pullRequests: [], totalCount: 0 }),
		);
		expect(output).toContain("No pull requests found.");
	});

	test("includes duration", () => {
		const output = formatPrsReport(makeReport());
		expect(output).toContain("Completed in 123ms");
	});

	test("formats multiple PRs", () => {
		const output = formatPrsReport(
			makeReport({
				pullRequests: [makePr({ number: 1 }), makePr({ number: 2 })],
				totalCount: 2,
			}),
		);
		expect(output).toContain("#1");
		expect(output).toContain("#2");
		expect(output).toContain("2 PR(s)");
	});
});
