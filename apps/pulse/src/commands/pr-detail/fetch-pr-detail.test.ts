import { describe, expect, test } from "bun:test";
import { MockGitHubClient } from "../../api/mock-client.ts";
import type { PrDetail } from "../types.ts";
import { fetchPrDetail } from "./fetch-pr-detail.ts";

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

describe("fetchPrDetail", () => {
	test("assembles PrDetailReport from API response", async () => {
		const pr = makePrDetail();
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			{ pr },
		);

		const report = await fetchPrDetail(client, {
			owner: "acme",
			repo: "repo",
			number: 42,
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.repository).toEqual({
			owner: "acme",
			repo: "repo",
			url: "https://github.com/acme/repo",
		});
		expect(report.pr.number).toBe(42);
		expect(report.pr.title).toBe("Add feature X");
		expect(report.pr.body).toBe("## Summary\nAdds feature X");
		expect(report.pr.reviews).toHaveLength(1);
		expect(report.pr.commits).toHaveLength(1);
		expect(report.pr.files).toHaveLength(1);
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
		expect(report.generatedAt).toBeTruthy();
	});

	test("passes correct parameters to API client", async () => {
		const pr = makePrDetail();
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			{ pr },
		);

		await fetchPrDetail(client, {
			owner: "acme",
			repo: "repo",
			number: 99,
			resolvedUser: "alice",
			resolvedVia: "org",
		});

		expect(client.detailCalls).toHaveLength(1);
		expect(client.detailCalls[0]).toEqual({
			owner: "acme",
			repo: "repo",
			number: 99,
		});
	});
});
