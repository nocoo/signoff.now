import { describe, expect, test } from "bun:test";
import { buildExternalRef } from "./external-ref.js";

const repo = "11111111-1111-1111-1111-111111111111";
const proj = "22222222-2222-2222-2222-222222222222";

describe("buildExternalRef", () => {
	test("pr.merged", () => {
		expect(buildExternalRef("pr.merged", { prRepoGuid: repo, prId: 12 })).toBe(
			`ado:pr:${repo}:12:merged`,
		);
	});

	test("pr.vote", () => {
		expect(
			buildExternalRef("pr.vote", {
				prRepoGuid: repo,
				prId: 1,
				voterIdentityId: "v",
				threadId: 2,
				commentId: 3,
			}),
		).toBe(`ado:pr:${repo}:1:vote:v:2:3`);
	});

	test("pr.active", () => {
		expect(
			buildExternalRef("pr.active", {
				prRepoGuid: repo,
				prId: 9,
				iterationId: 4,
			}),
		).toBe(`ado:pr:${repo}:9:iter:4`);
	});

	test("wi.updated", () => {
		expect(
			buildExternalRef("wi.updated", {
				projectGuid: proj,
				wiId: 5,
				revisionId: 7,
			}),
		).toBe(`ado:wi:${proj}:5:rev:7`);
	});

	test("wi.created", () => {
		expect(buildExternalRef("wi.created", { projectGuid: proj, wiId: 5 })).toBe(
			`ado:wi:${proj}:5:created`,
		);
	});

	test("pr.created / pr.closed / wi.closed", () => {
		expect(buildExternalRef("pr.created", { prRepoGuid: repo, prId: 1 })).toBe(
			`ado:pr:${repo}:1:created`,
		);
		expect(buildExternalRef("pr.closed", { prRepoGuid: repo, prId: 1 })).toBe(
			`ado:pr:${repo}:1:closed`,
		);
		expect(buildExternalRef("wi.closed", { projectGuid: proj, wiId: 1 })).toBe(
			`ado:wi:${proj}:1:closed`,
		);
	});

	test("rejects non-object sourceIds", () => {
		expect(() => buildExternalRef("pr.merged", null)).toThrow();
	});
});
