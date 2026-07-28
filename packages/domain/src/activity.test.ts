import { describe, expect, test } from "bun:test";
import { activitySchema, MAX_OCCURRED_AT } from "./activity.js";
import { dayKey } from "./day-key.js";

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

	test("rejects meta over 4 KiB", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.merged",
			meta: { x: "a".repeat(5000) },
		});
		expect(r.success).toBe(false);
	});

	test("accepts small meta", () => {
		const r = activitySchema.safeParse({
			...prBase,
			type: "pr.merged",
			meta: { title: "ok" },
		});
		expect(r.success).toBe(true);
	});
});

describe("occurredAt bounds", () => {
	const base = {
		type: "pr.merged" as const,
		provider: "ado" as const,
		org: "o",
		project: "p",
		repoId: "01K0R00000000000000000000",
		developerId: "01K0D00000000000000000000",
		matchedUniqueName: "a@x.com",
		sourceIds: {
			prRepoGuid: "11111111-1111-4111-8111-111111111111",
			prId: 1,
		},
	};

	test("a timestamp past year 9999 is refused at the door", () => {
		// Unbounded, it yields `10000-01-01`, which SQLite's `date()` rejects —
		// the Dashboard's union guard then reads the entry as corrupt and blanks
		// the window. Refusing here names the real problem: the timestamp.
		expect(
			activitySchema.safeParse({ ...base, occurredAt: MAX_OCCURRED_AT + 1 })
				.success,
		).toBe(false);
	});

	test("the last second of year 9999 is still accepted", () => {
		expect(
			activitySchema.safeParse({ ...base, occurredAt: MAX_OCCURRED_AT })
				.success,
		).toBe(true);
	});

	test("the bound holds in every timezone, not just UTC", () => {
		// Day keys are derived in the CONFIGURED timezone. Bounding at
		// `9999-12-31T23:59:59Z` looked right and was not: under Asia/Shanghai —
		// the production setting — that instant is already `10000-01-01`, which
		// SQLite's `date()` rejects and the union guard reads as corruption.
		for (const tz of [
			"UTC",
			"Asia/Shanghai",
			"Pacific/Kiritimati",
			"America/Los_Angeles",
		]) {
			const key = dayKey(MAX_OCCURRED_AT, tz);
			expect(`${tz}: ${key}`).toBe(`${tz}: 9999-12-3${key.slice(-1)}`);
			expect(key.startsWith("9999-")).toBe(true);
		}
	});
});
