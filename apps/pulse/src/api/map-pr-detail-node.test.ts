import { describe, expect, test } from "bun:test";
import { mapPrDetailNode } from "./map-pr-detail-node.ts";
import type { GraphQLPrDetailNode } from "./types.ts";

function makeDetailNode(
	overrides?: Partial<GraphQLPrDetailNode>,
): GraphQLPrDetailNode {
	return {
		number: 42,
		title: "Add feature X",
		state: "OPEN",
		isDraft: false,
		merged: false,
		mergedAt: null,
		author: { login: "alice" },
		createdAt: "2025-01-15T10:00:00Z",
		updatedAt: "2025-01-16T12:00:00Z",
		closedAt: null,
		headRefName: "feature-x",
		baseRefName: "main",
		url: "https://github.com/acme/repo/pull/42",
		labels: { nodes: [{ name: "enhancement" }] },
		reviewDecision: "APPROVED",
		additions: 50,
		deletions: 10,
		changedFiles: 3,

		body: "## Summary\nAdds feature X",
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		mergedBy: null,
		totalCommentsCount: 5,
		headRefOid: "abc1234",
		baseRefOid: "def5678",
		isCrossRepository: false,
		participants: { nodes: [{ login: "alice" }, { login: "bob" }] },
		assignees: { nodes: [{ login: "alice" }] },
		reviewRequests: {
			nodes: [{ requestedReviewer: { login: "charlie" } }],
		},
		milestone: { title: "v1.0" },
		reviews: {
			nodes: [
				{
					author: { login: "bob" },
					state: "APPROVED",
					body: "LGTM",
					submittedAt: "2025-01-16T10:00:00Z",
					comments: { nodes: [] },
				},
			],
		},
		comments: {
			nodes: [
				{
					author: { login: "bob" },
					body: "Looks good",
					createdAt: "2025-01-15T11:00:00Z",
					updatedAt: "2025-01-15T11:00:00Z",
				},
			],
		},
		commits: {
			nodes: [
				{
					commit: {
						abbreviatedOid: "abc1234",
						message: "feat: add feature X",
						author: { user: { login: "alice" }, name: "Alice" },
						authoredDate: "2025-01-15T10:00:00Z",
						statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } },
					},
				},
			],
		},
		files: {
			nodes: [
				{
					path: "src/feature.ts",
					additions: 50,
					deletions: 10,
					changeType: "MODIFIED",
				},
			],
		},
		...overrides,
	};
}

describe("mapPrDetailNode", () => {
	test("maps basic PR fields from base mapPrNode", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.number).toBe(42);
		expect(detail.title).toBe("Add feature X");
		expect(detail.state).toBe("open");
		expect(detail.author).toBe("alice");
		expect(detail.labels).toEqual(["enhancement"]);
	});

	test("maps body and merge info", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.body).toBe("## Summary\nAdds feature X");
		expect(detail.mergeable).toBe("MERGEABLE");
		expect(detail.mergeStateStatus).toBe("CLEAN");
		expect(detail.mergedBy).toBeNull();
	});

	test("maps mergedBy when present", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({ mergedBy: { login: "deployer" } }),
		);
		expect(detail.mergedBy).toBe("deployer");
	});

	test("maps participants and assignees", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.participants).toEqual(["alice", "bob"]);
		expect(detail.assignees).toEqual(["alice"]);
		expect(detail.requestedReviewers).toEqual(["charlie"]);
	});

	test("maps team slug for requested reviewers", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				reviewRequests: {
					nodes: [{ requestedReviewer: { slug: "core-team" } }],
				},
			}),
		);
		expect(detail.requestedReviewers).toEqual(["core-team"]);
	});

	test("handles null requested reviewer gracefully", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				reviewRequests: { nodes: [{ requestedReviewer: null }] },
			}),
		);
		expect(detail.requestedReviewers).toEqual([]);
	});

	test("maps milestone", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.milestone).toBe("v1.0");
	});

	test("maps null milestone", () => {
		const detail = mapPrDetailNode(makeDetailNode({ milestone: null }));
		expect(detail.milestone).toBeNull();
	});

	test("maps reviews", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.reviews).toHaveLength(1);
		expect(detail.reviews[0]).toEqual({
			author: "bob",
			state: "APPROVED",
			body: "LGTM",
			submittedAt: "2025-01-16T10:00:00Z",
			comments: [],
		});
	});

	test("maps comments", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.comments).toHaveLength(1);
		expect(detail.comments[0]?.author).toBe("bob");
		expect(detail.comments[0]?.body).toBe("Looks good");
	});

	test("maps commits with status check", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.commits).toHaveLength(1);
		expect(detail.commits[0]).toEqual({
			oid: "abc1234",
			message: "feat: add feature X",
			author: "alice",
			authoredDate: "2025-01-15T10:00:00Z",
			statusCheckRollup: "SUCCESS",
			checkRuns: [],
		});
	});

	test("maps commit without status check", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				commits: {
					nodes: [
						{
							commit: {
								abbreviatedOid: "xyz",
								message: "wip",
								author: { user: null, name: "Ghost" },
								authoredDate: "2025-01-15T10:00:00Z",
								statusCheckRollup: null,
							},
						},
					],
				},
			}),
		);
		expect(detail.commits[0]?.author).toBe("Ghost");
		expect(detail.commits[0]?.statusCheckRollup).toBeNull();
	});

	test("maps files", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.files).toHaveLength(1);
		expect(detail.files[0]).toEqual({
			path: "src/feature.ts",
			additions: 50,
			deletions: 10,
			changeType: "MODIFIED",
		});
	});

	test("handles null files gracefully", () => {
		const detail = mapPrDetailNode(makeDetailNode({ files: null }));
		expect(detail.files).toEqual([]);
	});

	test("maps totalCommentsCount", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.totalCommentsCount).toBe(5);
	});

	test("handles null totalCommentsCount", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({ totalCommentsCount: null }),
		);
		expect(detail.totalCommentsCount).toBe(0);
	});

	test("maps ref OIDs and cross-repository flag", () => {
		const detail = mapPrDetailNode(makeDetailNode());
		expect(detail.headRefOid).toBe("abc1234");
		expect(detail.baseRefOid).toBe("def5678");
		expect(detail.isCrossRepository).toBe(false);
	});

	test("handles ghost author in reviews", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				reviews: {
					nodes: [
						{
							author: null,
							state: "COMMENTED",
							body: "auto-review",
							submittedAt: null,
							comments: { nodes: [] },
						},
					],
				},
			}),
		);
		expect(detail.reviews[0]?.author).toBe("ghost");
	});

	test("maps review comments", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				reviews: {
					nodes: [
						{
							author: { login: "bob" },
							state: "CHANGES_REQUESTED",
							body: "Needs fixes",
							submittedAt: "2025-01-16T10:00:00Z",
							comments: {
								nodes: [
									{
										author: { login: "bob" },
										path: "src/index.ts",
										line: 42,
										originalLine: 40,
										diffHunk: "@@ -38,6 +38,8 @@",
										body: "This needs a null check",
										createdAt: "2025-01-16T10:01:00Z",
										updatedAt: "2025-01-16T10:01:00Z",
									},
								],
							},
						},
					],
				},
			}),
		);
		expect(detail.reviews[0]?.comments).toHaveLength(1);
		expect(detail.reviews[0]?.comments[0]).toEqual({
			author: "bob",
			path: "src/index.ts",
			line: 42,
			originalLine: 40,
			diffHunk: "@@ -38,6 +38,8 @@",
			body: "This needs a null check",
			createdAt: "2025-01-16T10:01:00Z",
			updatedAt: "2025-01-16T10:01:00Z",
		});
	});

	test("handles ghost author in review comments", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				reviews: {
					nodes: [
						{
							author: { login: "bob" },
							state: "COMMENTED",
							body: "",
							submittedAt: null,
							comments: {
								nodes: [
									{
										author: null,
										path: "README.md",
										line: null,
										originalLine: null,
										diffHunk: "",
										body: "automated comment",
										createdAt: "2025-01-16T10:00:00Z",
										updatedAt: "2025-01-16T10:00:00Z",
									},
								],
							},
						},
					],
				},
			}),
		);
		expect(detail.reviews[0]?.comments[0]?.author).toBe("ghost");
	});

	test("maps check runs from commit contexts", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				commits: {
					nodes: [
						{
							commit: {
								abbreviatedOid: "abc1234",
								message: "feat: add feature X",
								author: { user: { login: "alice" }, name: "Alice" },
								authoredDate: "2025-01-15T10:00:00Z",
								statusCheckRollup: {
									state: "FAILURE",
									contexts: {
										nodes: [
											{
												__typename: "CheckRun",
												name: "build",
												status: "COMPLETED",
												conclusion: "SUCCESS",
												detailsUrl: "https://ci.example.com/build/1",
											},
											{
												__typename: "CheckRun",
												name: "test",
												status: "COMPLETED",
												conclusion: "FAILURE",
												detailsUrl: "https://ci.example.com/test/1",
											},
											{
												__typename: "StatusContext",
											},
										],
									},
								},
							},
						},
					],
				},
			}),
		);
		expect(detail.commits[0]?.checkRuns).toHaveLength(2);
		expect(detail.commits[0]?.checkRuns[0]).toEqual({
			name: "build",
			status: "COMPLETED",
			conclusion: "SUCCESS",
			detailsUrl: "https://ci.example.com/build/1",
		});
		expect(detail.commits[0]?.checkRuns[1]).toEqual({
			name: "test",
			status: "COMPLETED",
			conclusion: "FAILURE",
			detailsUrl: "https://ci.example.com/test/1",
		});
	});

	test("returns empty check runs when no statusCheckRollup", () => {
		const detail = mapPrDetailNode(
			makeDetailNode({
				commits: {
					nodes: [
						{
							commit: {
								abbreviatedOid: "xyz",
								message: "wip",
								author: { user: null, name: "Ghost" },
								authoredDate: "2025-01-15T10:00:00Z",
								statusCheckRollup: null,
							},
						},
					],
				},
			}),
		);
		expect(detail.commits[0]?.checkRuns).toEqual([]);
	});
});
