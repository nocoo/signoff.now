import { describe, expect, test } from "bun:test";
import { activitySchema } from "./activity.js";

const prBase = {
	occurredAt: 1720000123,
	provider: "ado" as const,
	org: "acme",
	project: "Alpha",
	repoId: "repo-1",
	developerId: "dev-1",
	matchedUniqueName: "ada@example.com",
	sourceIds: {
		prRepoGuid: "11111111-1111-4111-8111-111111111111",
		prId: 1234,
	},
};

const wiBase = {
	occurredAt: 1720000123,
	provider: "ado" as const,
	org: "acme",
	project: "Alpha",
	repoId: null,
	developerId: "dev-1",
	matchedUniqueName: "ada@example.com",
	sourceIds: {
		projectGuid: "22222222-2222-4222-8222-222222222222",
		wiId: 99,
	},
};

describe("activitySchema", () => {
	test("accepts pr.merged", () => {
		const r = activitySchema.safeParse({ ...prBase, type: "pr.merged" });
		expect(r.success).toBe(true);
	});

	test("accepts pr.vote with full sourceIds", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.vote",
			sourceIds: {
				...prBase.sourceIds,
				voterIdentityId: "v1",
				threadId: 1,
				commentId: 0,
			},
		});
		expect(r.success).toBe(true);
	});

	test("accepts wi.updated with revisionId", () => {
		const r = activitySchema.safeParse({
			...wiBase,
			type: "wi.updated",
			sourceIds: { ...wiBase.sourceIds, revisionId: 3 },
		});
		expect(r.success).toBe(true);
	});

	test("rejects forbidden fields id / externalRef / dayKey / config_version", () => {
		for (const field of ["id", "externalRef", "dayKey", "config_version"]) {
			const r = activitySchema.safeParse({
				...prBase,
				type: "pr.merged",
				[field]: "x",
			});
			expect(r.success).toBe(false);
		}
	});

	test("rejects unknown type", () => {
		const r = activitySchema.safeParse({ ...prBase, type: "pr.unknown" });
		expect(r.success).toBe(false);
	});

	test("rejects sourceIds mismatch: wi.updated with PR sourceIds", () => {
		const r = activitySchema.safeParse({
			...wiBase,
			type: "wi.updated",
			sourceIds: prBase.sourceIds,
		});
		expect(r.success).toBe(false);
	});

	test("rejects pr.vote missing threadId", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.vote",
			sourceIds: {
				...prBase.sourceIds,
				voterIdentityId: "v1",
				commentId: 0,
			},
		});
		expect(r.success).toBe(false);
	});

	test("rejects pr.merged with repoId null", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.merged",
			repoId: null,
		});
		expect(r.success).toBe(false);
	});

	test("rejects wi.created with non-null repoId", () => {
		const r = activitySchema.safeParse({
			...wiBase,
			type: "wi.created",
			repoId: "repo-1",
		});
		expect(r.success).toBe(false);
	});

	test("accepts pr.active with iterationId", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.active",
			sourceIds: { ...prBase.sourceIds, iterationId: 2 },
		});
		expect(r.success).toBe(true);
	});
});
