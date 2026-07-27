import { describe, expect, test } from "bun:test";
import { activitySchema } from "../activity.js";
import { buildExternalRef } from "../external-ref.js";
import type { RawIteration, RawPr, RawThread } from "../raw.js";
import {
	type PrTransformInput,
	resolveIdentity,
	toUnixSeconds,
	transformPullRequests,
	voteComment,
} from "./pr.js";

const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const DEV_ID = "01K0DEV000000000000000000";

const common = {
	settings: { emailSuffixes: ["example.com"] },
	developers: [{ id: DEV_ID, alias: "ada" }],
	org: "acme",
	project: "Alpha",
	repo: { id: "01K0REPO00000000000000000", externalId: REPO_GUID },
	projectExternalId: PROJ_GUID,
};

function input(over: Partial<PrTransformInput> = {}): PrTransformInput {
	return {
		...common,
		prs: [],
		threadsByPr: new Map(),
		iterationsByPr: new Map(),
		...over,
	};
}

function pr(over: Partial<RawPr> = {}): RawPr {
	return {
		pullRequestId: 1001,
		status: "active",
		creationDate: "2026-07-01T10:00:00Z",
		createdBy: { id: "aid", uniqueName: "ada@example.com" },
		repository: { id: REPO_GUID, project: { id: PROJ_GUID } },
		...over,
	} as RawPr;
}

function voteThread(over: Partial<RawThread> = {}): RawThread {
	return {
		id: 500,
		publishedDate: "2026-07-02T09:00:00Z",
		properties: {
			CodeReviewThreadType: { $value: "VoteUpdate" },
			CodeReviewVoteResult: { $value: "10" },
		},
		comments: [
			{
				id: 1,
				commentType: "system",
				publishedDate: "2026-07-02T09:00:00Z",
				author: { id: "aid", uniqueName: "ada@example.com" },
			},
		],
		...over,
	} as RawThread;
}

const iteration = (over: Partial<RawIteration> = {}): RawIteration =>
	({
		id: 1,
		createdDate: "2026-07-01T10:00:00Z",
		updatedDate: "2026-07-03T08:00:00Z",
		author: { id: "aid", uniqueName: "ada@example.com" },
		...over,
	}) as RawIteration;

describe("toUnixSeconds", () => {
	test("converts ISO instants to positive UTC seconds", () => {
		const expected = Math.floor(Date.UTC(2026, 6, 1, 0, 0, 0) / 1000);
		expect(toUnixSeconds("2026-07-01T00:00:00Z")).toBe(expected);
		// ADO's sub-second precision must truncate, not round up into the next
		// second — a rounded timestamp can land on the wrong day_key.
		expect(toUnixSeconds("2026-07-01T00:00:00.9999999Z")).toBe(expected);
	});

	test("rejects anything unusable rather than coercing it", () => {
		expect(toUnixSeconds(null)).toBeNull();
		expect(toUnixSeconds(undefined)).toBeNull();
		expect(toUnixSeconds("")).toBeNull();
		expect(toUnixSeconds("not a date")).toBeNull();
		expect(toUnixSeconds("1969-01-01T00:00:00Z")).toBeNull();
	});
});

describe("resolveIdentity", () => {
	test("matches a developer by alias + suffix", () => {
		const r = resolveIdentity({ uniqueName: "ADA@Example.com" }, common);
		expect(r).toEqual({
			kind: "developer",
			developerId: DEV_ID,
			uniqueName: "ADA@Example.com",
		});
	});

	test("containers are skipped, not reported unmatched", () => {
		const r = resolveIdentity(
			{ uniqueName: "vstfs:///Classification/Group", isContainer: true },
			common,
		);
		expect(r).toEqual({ kind: "skip", reason: "container" });
	});

	test("non-email identities are skipped", () => {
		expect(resolveIdentity({ uniqueName: "DOMAIN\\svc" }, common)).toEqual({
			kind: "skip",
			reason: "non_email",
		});
		expect(resolveIdentity({ uniqueName: "" }, common)).toEqual({
			kind: "skip",
			reason: "non_email",
		});
		expect(resolveIdentity(undefined, common)).toEqual({
			kind: "skip",
			reason: "non_email",
		});
	});

	test("an unknown email is unmatched, not skipped", () => {
		expect(resolveIdentity({ uniqueName: "bob@example.com" }, common)).toEqual({
			kind: "unmatched",
			uniqueName: "bob@example.com",
		});
	});
});

describe("voteComment", () => {
	test("returns the single system comment", () => {
		expect(voteComment(voteThread())?.id).toBe(1);
	});

	test("is null when there is not exactly one", () => {
		expect(voteComment({ id: 1, comments: [] } as RawThread)).toBeNull();
		expect(
			voteComment({
				id: 1,
				comments: [
					{ id: 1, commentType: "system" },
					{ id: 2, commentType: "system" },
				],
			} as RawThread),
		).toBeNull();
	});
});

describe("pull request activities", () => {
	test("pr.created is emitted from creationDate", () => {
		const r = transformPullRequests(input({ prs: [pr()] }));
		expect(r.activities).toHaveLength(1);
		const a = r.activities[0]!;
		expect(a.type).toBe("pr.created");
		expect(a.occurredAt).toBe(toUnixSeconds("2026-07-01T10:00:00Z") as number);
		expect(a.developerId).toBe(DEV_ID);
		expect(a.repoId).toBe(common.repo.id);
		expect(a.provider).toBe("ado");
	});

	test("a completed PR with a merge commit yields created + merged", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						status: "completed",
						closedDate: "2026-07-05T12:00:00Z",
						lastMergeCommit: { commitId: "abc" },
					}),
				],
			}),
		);
		expect(
			r.activities.map((a) => a.type).sort((x, y) => x.localeCompare(y)),
		).toEqual(["pr.created", "pr.merged"]);
		const merged = r.activities.find((a) => a.type === "pr.merged")!;
		expect(merged.occurredAt).toBe(
			toUnixSeconds("2026-07-05T12:00:00Z") as number,
		);
	});

	test("an abandoned PR yields pr.closed", () => {
		const r = transformPullRequests(
			input({
				prs: [pr({ status: "abandoned", closedDate: "2026-07-05T12:00:00Z" })],
			}),
		);
		expect(
			r.activities.map((a) => a.type).sort((x, y) => x.localeCompare(y)),
		).toEqual(["pr.closed", "pr.created"]);
	});

	test("pr.vote credits the voter, not the PR author", () => {
		const r = transformPullRequests(
			input({
				prs: [pr()],
				threadsByPr: new Map([
					[
						1001,
						[
							voteThread({
								comments: [
									{
										id: 7,
										commentType: "system",
										publishedDate: "2026-07-02T09:00:00Z",
										author: { id: "vid", uniqueName: "ada@example.com" },
									},
								],
							}),
						],
					],
				]),
			}),
		);
		const vote = r.activities.find((a) => a.type === "pr.vote")!;
		expect(vote.occurredAt).toBe(
			toUnixSeconds("2026-07-02T09:00:00Z") as number,
		);
		expect(vote.sourceIds).toMatchObject({
			voterIdentityId: "vid",
			threadId: 500,
			commentId: 7,
		});
	});

	test("negative votes count; withdrawal does not", () => {
		const mk = (v: string) =>
			transformPullRequests(
				input({
					prs: [pr()],
					threadsByPr: new Map([
						[
							1001,
							[
								voteThread({
									properties: {
										CodeReviewThreadType: { $value: "VoteUpdate" },
										CodeReviewVoteResult: { $value: v },
									},
								}),
							],
						],
					]),
				}),
			);
		// "Personal vote", not "approval" — a rejection is still participation.
		expect(mk("-10").activities.some((a) => a.type === "pr.vote")).toBe(true);
		expect(mk("-5").activities.some((a) => a.type === "pr.vote")).toBe(true);
		// The string "0" must not slip through as truthy.
		const withdrawn = mk("0");
		expect(withdrawn.activities.some((a) => a.type === "pr.vote")).toBe(false);
		expect(withdrawn.skipped.vote_withdrawn).toBe(1);
	});

	test("non-vote threads are ignored", () => {
		const r = transformPullRequests(
			input({
				prs: [pr()],
				threadsByPr: new Map([[1001, [{ id: 9, comments: [] } as RawThread]]]),
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.vote")).toBe(false);
	});

	test("pr.active is emitted per iteration, credited to its author", () => {
		const r = transformPullRequests(
			input({
				prs: [pr()],
				iterationsByPr: new Map([
					[1001, [iteration({ id: 1 }), iteration({ id: 2 })]],
				]),
			}),
		);
		const actives = r.activities.filter((a) => a.type === "pr.active");
		expect(actives).toHaveLength(2);
		expect(
			actives.map((a) => (a.sourceIds as { iterationId: number }).iterationId),
		).toEqual([1, 2]);
	});
});

describe("discard rules (07 §6.4)", () => {
	test("a completed PR without closedDate produces no pr.merged", () => {
		const r = transformPullRequests(
			input({
				prs: [pr({ status: "completed", lastMergeCommit: { commitId: "a" } })],
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.merged")).toBe(false);
		expect(r.skipped.no_timestamp).toBe(1);
	});

	test("a completed PR without a merge commit is an anomaly, not a silent drop", () => {
		const r = transformPullRequests(
			input({
				prs: [pr({ status: "completed", closedDate: "2026-07-05T12:00:00Z" })],
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.merged")).toBe(false);
		expect(r.skipped.no_merge_commit).toBe(1);
		expect(r.anomalies).toHaveLength(1);
		expect(r.anomalies[0]).toContain("lastMergeCommit");
	});

	test("an unmatched author is recorded once, with no activity", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({ createdBy: { uniqueName: "bob@example.com" } }),
					pr({
						pullRequestId: 1002,
						createdBy: { uniqueName: "bob@example.com" },
					}),
				],
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.unmatched).toHaveLength(1);
		expect(r.unmatched[0]).toEqual({
			uniqueName: "bob@example.com",
			sampleOrg: "acme",
			sampleProject: "Alpha",
		});
		expect(r.skipped.unmatched).toBe(2);
	});

	test("a container author is counted but never reported unmatched", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						createdBy: { uniqueName: "vstfs:///Group", isContainer: true },
					}),
				],
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.unmatched).toHaveLength(0);
		expect(r.skipped.container).toBe(1);
	});

	test("a vote thread without exactly one system comment is discarded", () => {
		const r = transformPullRequests(
			input({
				prs: [pr()],
				threadsByPr: new Map([[1001, [voteThread({ comments: [] })]]]),
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.vote")).toBe(false);
		expect(r.skipped.vote_ambiguous).toBe(1);
	});

	test("a vote whose author has no stable id is discarded", () => {
		// external_ref needs the identity GUID and activitySchema requires it to
		// be non-empty; emitting a blank one would only fail at the server.
		const r = transformPullRequests(
			input({
				prs: [pr()],
				threadsByPr: new Map([
					[
						1001,
						[
							voteThread({
								comments: [
									{
										id: 7,
										commentType: "system",
										publishedDate: "2026-07-02T09:00:00Z",
										author: { uniqueName: "ada@example.com" },
									},
								],
							}),
						],
					],
				]),
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.vote")).toBe(false);
		expect(r.skipped.vote_ambiguous).toBe(1);
	});

	test("an iteration without updatedDate is discarded", () => {
		const r = transformPullRequests(
			input({
				prs: [pr()],
				iterationsByPr: new Map([[1001, [iteration({ updatedDate: null })]]]),
			}),
		);
		expect(r.activities.some((a) => a.type === "pr.active")).toBe(false);
		expect(r.skipped.no_timestamp).toBe(1);
	});

	test("a PR from another repository is rejected, not attributed", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						repository: {
							id: "99999999-9999-4999-8999-999999999999",
							project: { id: PROJ_GUID },
						},
					} as Partial<RawPr>),
				],
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.skipped.guid_mismatch).toBe(1);
		expect(r.anomalies[0]).toContain("GUID");
	});

	test("a PR from another project is rejected", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						repository: {
							id: REPO_GUID,
							project: { id: "88888888-8888-4888-8888-888888888888" },
						},
					} as Partial<RawPr>),
				],
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.skipped.guid_mismatch).toBe(1);
	});
});

describe("output validity", () => {
	test("every emitted activity satisfies the frozen wire schema", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						status: "completed",
						closedDate: "2026-07-05T12:00:00Z",
						lastMergeCommit: { commitId: "abc" },
					}),
				],
				threadsByPr: new Map([[1001, [voteThread()]]]),
				iterationsByPr: new Map([[1001, [iteration()]]]),
			}),
		);
		expect(r.activities.length).toBeGreaterThan(3);
		for (const a of r.activities) {
			// The server re-validates with this exact schema; a mismatch here is
			// a guaranteed 400 in production.
			expect(() => activitySchema.parse(a)).not.toThrow();
			// And the sourceIds must be shaped for the ref the server computes.
			expect(() => buildExternalRef(a.type, a.sourceIds)).not.toThrow();
		}
	});

	test("external refs are distinct per event", () => {
		const r = transformPullRequests(
			input({
				prs: [
					pr({
						status: "completed",
						closedDate: "2026-07-05T12:00:00Z",
						lastMergeCommit: { commitId: "abc" },
					}),
				],
				iterationsByPr: new Map([
					[1001, [iteration({ id: 1 }), iteration({ id: 2 })]],
				]),
			}),
		);
		const refs = r.activities.map((a) => buildExternalRef(a.type, a.sourceIds));
		expect(new Set(refs).size).toBe(refs.length);
	});

	test("an empty input produces an empty, well-formed result", () => {
		const r = transformPullRequests(input());
		expect(r.activities).toEqual([]);
		expect(r.unmatched).toEqual([]);
		expect(r.anomalies).toEqual([]);
		expect(Object.values(r.skipped).every((n) => n === 0)).toBe(true);
	});
});
