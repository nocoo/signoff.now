import { describe, expect, test } from "bun:test";
import type { Activity } from "./activity.js";
import { DEFAULT_WEIGHTS } from "./constants.js";
import { type ActivityWithDayKey, aggregateScores } from "./score.js";

const repo = "11111111-1111-1111-1111-111111111111";
const proj = "22222222-2222-2222-2222-222222222222";
const D1 = "dev-1";
const DAY = "2026-07-01";

function base(
	partial: Partial<Activity> & Pick<Activity, "type" | "sourceIds" | "repoId">,
): ActivityWithDayKey {
	return {
		occurredAt: 1_720_000_000,
		provider: "ado",
		org: "acme",
		project: "Alpha",
		developerId: D1,
		matchedUniqueName: "ada@example.com",
		dayKey: DAY,
		...partial,
	} as ActivityWithDayKey;
}

describe("aggregateScores boundary table", () => {
	test("B1: 1× pr.merged", () => {
		const rows = aggregateScores(
			[
				base({
					type: "pr.merged",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
			],
			DEFAULT_WEIGHTS,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.total).toBe(10);
		expect(rows[0]!.activityCount).toBe(1);
		expect(rows[0]!.breakdown).toEqual({ "pr.merged": 10 });
	});

	test("B2: created + merged same PR → only merged", () => {
		const rows = aggregateScores(
			[
				base({
					type: "pr.created",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
				base({
					type: "pr.merged",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
			],
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(10);
		expect(rows[0]!.activityCount).toBe(2);
		expect(rows[0]!.breakdown).toEqual({ "pr.merged": 10 });
	});

	test("B5: pr.active ×3 fold to one weight", () => {
		const rows = aggregateScores(
			[1, 2, 3].map((iterationId) =>
				base({
					type: "pr.active",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1, iterationId },
				}),
			),
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(2);
		expect(rows[0]!.activityCount).toBe(3);
	});

	test("B6: wi.updated ×4 fold", () => {
		const rows = aggregateScores(
			[1, 2, 3, 4].map((revisionId) =>
				base({
					type: "wi.updated",
					repoId: null,
					sourceIds: { projectGuid: proj, wiId: 9, revisionId },
				}),
			),
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(1);
		expect(rows[0]!.activityCount).toBe(4);
	});

	test("B8: pr.vote ×2 no fold", () => {
		const rows = aggregateScores(
			[
				base({
					type: "pr.vote",
					repoId: "r1",
					sourceIds: {
						prRepoGuid: repo,
						prId: 1,
						voterIdentityId: "v1",
						threadId: 1,
						commentId: 0,
					},
				}),
				base({
					type: "pr.vote",
					repoId: "r1",
					sourceIds: {
						prRepoGuid: repo,
						prId: 1,
						voterIdentityId: "v1",
						threadId: 2,
						commentId: 0,
					},
				}),
			],
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(6);
		expect(rows[0]!.activityCount).toBe(2);
	});

	test("B9: merged + vote same PR", () => {
		const rows = aggregateScores(
			[
				base({
					type: "pr.merged",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
				base({
					type: "pr.vote",
					repoId: "r1",
					sourceIds: {
						prRepoGuid: repo,
						prId: 1,
						voterIdentityId: "v",
						threadId: 1,
						commentId: 0,
					},
				}),
			],
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(13);
	});

	test("B11: empty", () => {
		expect(aggregateScores([], DEFAULT_WEIGHTS)).toEqual([]);
	});

	test("B13: order independent (B2 shuffled)", () => {
		const a = base({
			type: "pr.merged",
			repoId: "r1",
			sourceIds: { prRepoGuid: repo, prId: 1 },
		});
		const b = base({
			type: "pr.created",
			repoId: "r1",
			sourceIds: { prRepoGuid: repo, prId: 1 },
		});
		const r1 = aggregateScores([a, b], DEFAULT_WEIGHTS);
		const r2 = aggregateScores([b, a], DEFAULT_WEIGHTS);
		expect(r1[0]!.total).toBe(r2[0]!.total);
		expect(r1[0]!.breakdown).toEqual(r2[0]!.breakdown);
	});

	test("B14: zero weights omit breakdown keys", () => {
		const zero = Object.fromEntries(
			Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]),
		) as typeof DEFAULT_WEIGHTS;
		const rows = aggregateScores(
			[
				base({
					type: "pr.merged",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
			],
			zero,
		);
		expect(rows[0]!.total).toBe(0);
		expect(rows[0]!.breakdown).toEqual({});
		expect(rows[0]!.activityCount).toBe(1);
	});

	test("B4: created + active×2 → only created", () => {
		const rows = aggregateScores(
			[
				base({
					type: "pr.created",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1 },
				}),
				base({
					type: "pr.active",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1, iterationId: 1 },
				}),
				base({
					type: "pr.active",
					repoId: "r1",
					sourceIds: { prRepoGuid: repo, prId: 1, iterationId: 2 },
				}),
			],
			DEFAULT_WEIGHTS,
		);
		expect(rows[0]!.total).toBe(2);
		expect(rows[0]!.activityCount).toBe(3);
		expect(rows[0]!.breakdown).toEqual({ "pr.created": 2 });
	});
});
