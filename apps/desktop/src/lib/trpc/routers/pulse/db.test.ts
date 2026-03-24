/**
 * Unit tests for PR cache DB helpers.
 *
 * Uses in-memory SQLite via createTestDb (same pattern as other router tests).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projects } from "@signoff/local-db";
import type { PrDetail, PullRequestInfo } from "@signoff/pulse";
import { createTestDb, type TestDb } from "../workspaces/utils/test-db";
import {
	clearCache,
	getCachedPrDetail,
	getCachedPrs,
	getScanMeta,
	upsertPrDetail,
	upsertPrs,
	upsertScanMeta,
} from "./db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: TestDb;
let cleanup: () => void;

const PROJECT_ID = "test-project-1";

function seedProject(id = PROJECT_ID): void {
	db.insert(projects)
		.values({
			id,
			mainRepoPath: "/tmp/test-repo",
			name: "Test Project",
			color: "default",
			tabOrder: 0,
			lastOpenedAt: Date.now(),
			createdAt: Date.now(),
		})
		.run();
}

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
	return {
		number: 1,
		title: "feat: add tests",
		state: "open",
		draft: false,
		merged: false,
		mergedAt: null,
		author: "alice",
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-15T12:00:00Z",
		closedAt: null,
		headBranch: "feat/tests",
		baseBranch: "main",
		url: "https://github.com/org/repo/pull/1",
		labels: ["enhancement"],
		reviewDecision: null,
		additions: 100,
		deletions: 20,
		changedFiles: 5,
		...overrides,
	};
}

function makePrDetail(overrides: Partial<PrDetail> = {}): PrDetail {
	return {
		...makePr(),
		body: "## Summary\nAdds tests",
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		mergedBy: null,
		totalCommentsCount: 3,
		headRefOid: "abc1234",
		baseRefOid: "def5678",
		isCrossRepository: false,
		participants: ["alice", "bob"],
		requestedReviewers: ["bob"],
		assignees: ["alice"],
		milestone: null,
		reviews: [
			{
				author: "bob",
				state: "APPROVED",
				body: "LGTM",
				submittedAt: "2025-01-15T14:00:00Z",
			},
		],
		comments: [
			{
				author: "ci-bot",
				body: "Build passed",
				createdAt: "2025-01-15T13:00:00Z",
				updatedAt: "2025-01-15T13:00:00Z",
			},
		],
		commits: [
			{
				oid: "abc1234",
				message: "feat: add tests",
				author: "alice",
				authoredDate: "2025-01-15T10:00:00Z",
				statusCheckRollup: "SUCCESS",
			},
		],
		files: [
			{
				path: "src/test.ts",
				additions: 100,
				deletions: 20,
				changeType: "ADDED",
			},
		],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	const testDb = createTestDb();
	db = testDb.db;
	cleanup = testDb.cleanup;
	seedProject();
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// upsertPrs
// ---------------------------------------------------------------------------

describe("upsertPrs", () => {
	test("inserts new PRs", () => {
		const prs = [
			makePr({ number: 1 }),
			makePr({ number: 2, title: "fix: bug" }),
		];
		upsertPrs(db, PROJECT_ID, prs);

		const cached = getCachedPrs(db, PROJECT_ID);
		expect(cached).toHaveLength(2);
	});

	test("updates existing PRs on conflict", () => {
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1, title: "old title" })]);
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1, title: "new title" })]);

		const cached = getCachedPrs(db, PROJECT_ID);
		expect(cached).toHaveLength(1);
		expect(cached[0].title).toBe("new title");
	});

	test("preserves rows not in current batch (no delete)", () => {
		upsertPrs(db, PROJECT_ID, [
			makePr({ number: 1 }),
			makePr({ number: 2, title: "PR two" }),
		]);

		// Second batch only has PR #3
		upsertPrs(db, PROJECT_ID, [makePr({ number: 3, title: "PR three" })]);

		const cached = getCachedPrs(db, PROJECT_ID);
		expect(cached).toHaveLength(3);
	});

	test("handles empty array gracefully", () => {
		upsertPrs(db, PROJECT_ID, []);
		const cached = getCachedPrs(db, PROJECT_ID);
		expect(cached).toHaveLength(0);
	});

	test("updates state from open to closed", () => {
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1, state: "open" })]);
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1, state: "closed" })]);

		const cached = getCachedPrs(db, PROJECT_ID);
		expect(cached[0].state).toBe("closed");
	});
});

// ---------------------------------------------------------------------------
// getCachedPrs — state filter
// ---------------------------------------------------------------------------

describe("getCachedPrs", () => {
	beforeEach(() => {
		upsertPrs(db, PROJECT_ID, [
			makePr({ number: 1, state: "open", createdAt: "2025-01-10T00:00:00Z" }),
			makePr({ number: 2, state: "closed", createdAt: "2025-01-11T00:00:00Z" }),
			makePr({ number: 3, state: "open", createdAt: "2025-01-12T00:00:00Z" }),
		]);
	});

	test("returns all PRs when state is 'all'", () => {
		const result = getCachedPrs(db, PROJECT_ID, "all");
		expect(result).toHaveLength(3);
	});

	test("returns all PRs when state is omitted", () => {
		const result = getCachedPrs(db, PROJECT_ID);
		expect(result).toHaveLength(3);
	});

	test("filters by state 'open'", () => {
		const result = getCachedPrs(db, PROJECT_ID, "open");
		expect(result).toHaveLength(2);
		for (const pr of result) {
			expect(pr.state).toBe("open");
		}
	});

	test("filters by state 'closed'", () => {
		const result = getCachedPrs(db, PROJECT_ID, "closed");
		expect(result).toHaveLength(1);
		expect(result[0].state).toBe("closed");
	});

	test("orders by createdAt DESC", () => {
		const result = getCachedPrs(db, PROJECT_ID, "all");
		expect(result[0].number).toBe(3); // newest
		expect(result[2].number).toBe(1); // oldest
	});

	test("returns empty array for unknown project", () => {
		const result = getCachedPrs(db, "nonexistent");
		expect(result).toHaveLength(0);
	});

	test("returns correct PullRequestInfo shape", () => {
		const result = getCachedPrs(db, PROJECT_ID, "open");
		const pr = result[0];
		expect(pr).toHaveProperty("number");
		expect(pr).toHaveProperty("title");
		expect(pr).toHaveProperty("state");
		expect(pr).toHaveProperty("draft");
		expect(pr).toHaveProperty("merged");
		expect(pr).toHaveProperty("labels");
		expect(Array.isArray(pr.labels)).toBe(true);
		// Should NOT have detail-only fields
		expect(pr).not.toHaveProperty("body");
		expect(pr).not.toHaveProperty("reviews");
	});
});

// ---------------------------------------------------------------------------
// upsertPrDetail + getCachedPrDetail
// ---------------------------------------------------------------------------

describe("upsertPrDetail / getCachedPrDetail", () => {
	test("inserts and retrieves full PrDetail", () => {
		const detail = makePrDetail({ number: 42 });
		upsertPrDetail(db, PROJECT_ID, detail);

		const cached = getCachedPrDetail(db, PROJECT_ID, 42);
		expect(cached).not.toBeNull();
		expect(cached!.number).toBe(42);
		expect(cached!.body).toBe("## Summary\nAdds tests");
		expect(cached!.mergeable).toBe("MERGEABLE");
		expect(cached!.reviews).toHaveLength(1);
		expect(cached!.reviews[0].author).toBe("bob");
		expect(cached!.comments).toHaveLength(1);
		expect(cached!.commits).toHaveLength(1);
		expect(cached!.files).toHaveLength(1);
	});

	test("also refreshes list-level row", () => {
		const detail = makePrDetail({ number: 42, title: "Updated title" });
		upsertPrDetail(db, PROJECT_ID, detail);

		const listPrs = getCachedPrs(db, PROJECT_ID);
		expect(listPrs).toHaveLength(1);
		expect(listPrs[0].title).toBe("Updated title");
	});

	test("updates existing detail on conflict", () => {
		upsertPrDetail(db, PROJECT_ID, makePrDetail({ number: 1, body: "v1" }));
		upsertPrDetail(db, PROJECT_ID, makePrDetail({ number: 1, body: "v2" }));

		const cached = getCachedPrDetail(db, PROJECT_ID, 1);
		expect(cached!.body).toBe("v2");

		// Should still be one row in list table
		const listPrs = getCachedPrs(db, PROJECT_ID);
		expect(listPrs).toHaveLength(1);
	});

	test("returns null when detail not cached", () => {
		// Only insert list-level row, no detail
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1 })]);

		const cached = getCachedPrDetail(db, PROJECT_ID, 1);
		expect(cached).toBeNull();
	});

	test("returns null for unknown PR number", () => {
		const cached = getCachedPrDetail(db, PROJECT_ID, 999);
		expect(cached).toBeNull();
	});

	test("preserves JSON arrays through round-trip", () => {
		const detail = makePrDetail({
			number: 1,
			participants: ["alice", "bob", "charlie"],
			labels: ["bug", "critical"],
		});
		upsertPrDetail(db, PROJECT_ID, detail);

		const cached = getCachedPrDetail(db, PROJECT_ID, 1);
		expect(cached!.participants).toEqual(["alice", "bob", "charlie"]);
		expect(cached!.labels).toEqual(["bug", "critical"]);
	});
});

// ---------------------------------------------------------------------------
// Scan metadata
// ---------------------------------------------------------------------------

describe("upsertScanMeta / getScanMeta", () => {
	test("inserts and retrieves scan metadata", () => {
		upsertScanMeta(db, PROJECT_ID, {
			endCursor: "cursor123",
			hasNextPage: true,
			resolvedUser: "alice",
			resolvedVia: "direct",
			repoOwner: "org",
			repoName: "repo",
		});

		const meta = getScanMeta(db, PROJECT_ID);
		expect(meta).not.toBeNull();
		expect(meta!.endCursor).toBe("cursor123");
		expect(meta!.hasNextPage).toBe(true);
		expect(meta!.resolvedUser).toBe("alice");
		expect(meta!.resolvedVia).toBe("direct");
		expect(meta!.repoOwner).toBe("org");
		expect(meta!.repoName).toBe("repo");
	});

	test("updates existing scan metadata on conflict", () => {
		upsertScanMeta(db, PROJECT_ID, {
			endCursor: "page1",
			hasNextPage: true,
		});
		upsertScanMeta(db, PROJECT_ID, {
			endCursor: "page2",
			hasNextPage: false,
		});

		const meta = getScanMeta(db, PROJECT_ID);
		expect(meta!.endCursor).toBe("page2");
		expect(meta!.hasNextPage).toBe(false);
	});

	test("returns null for project with no scan", () => {
		const meta = getScanMeta(db, PROJECT_ID);
		expect(meta).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe("clearCache", () => {
	test("deletes all 3 tables for a project", () => {
		upsertPrs(db, PROJECT_ID, [makePr({ number: 1 })]);
		upsertPrDetail(db, PROJECT_ID, makePrDetail({ number: 1 }));
		upsertScanMeta(db, PROJECT_ID, {
			endCursor: "c1",
			hasNextPage: false,
		});

		clearCache(db, PROJECT_ID);

		expect(getCachedPrs(db, PROJECT_ID)).toHaveLength(0);
		expect(getCachedPrDetail(db, PROJECT_ID, 1)).toBeNull();
		expect(getScanMeta(db, PROJECT_ID)).toBeNull();
	});

	test("does not affect other projects", () => {
		const OTHER_ID = "other-project";
		seedProject(OTHER_ID);

		upsertPrs(db, PROJECT_ID, [makePr({ number: 1 })]);
		upsertPrs(db, OTHER_ID, [makePr({ number: 2 })]);

		clearCache(db, PROJECT_ID);

		expect(getCachedPrs(db, PROJECT_ID)).toHaveLength(0);
		expect(getCachedPrs(db, OTHER_ID)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Edge cases: fresh scan preserves detail rows
// ---------------------------------------------------------------------------

describe("fresh scan preserves detail rows", () => {
	test("upsert does not orphan pull_request_details", () => {
		// Step 1: Cache detail for PR #1
		upsertPrDetail(db, PROJECT_ID, makePrDetail({ number: 1 }));

		// Step 2: Fresh scan returns PR #2 and #3 (but not #1)
		upsertPrs(db, PROJECT_ID, [makePr({ number: 2 }), makePr({ number: 3 })]);

		// PR #1 still exists in list (no delete)
		const allPrs = getCachedPrs(db, PROJECT_ID);
		expect(allPrs).toHaveLength(3);

		// PR #1 detail still accessible
		const detail = getCachedPrDetail(db, PROJECT_ID, 1);
		expect(detail).not.toBeNull();
		expect(detail!.body).toBe("## Summary\nAdds tests");
	});
});
