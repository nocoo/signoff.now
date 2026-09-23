import { describe, expect, test } from "bun:test";
import {
	contributionFiltersSchema,
	contributorBlockSchema,
	defaultContributionFilters,
	identityKey,
	memberDraftSchema,
	parseIdentityKey,
	repositoryKey,
	tagDraftSchema,
	teamDraftSchema,
} from "./insights";

describe("PR contribution scope", () => {
	test("uses an inclusive 90-day UTC created-date cohort and excludes drafts", () => {
		const filters = defaultContributionFilters(
			"cli",
			Date.parse("2026-03-01T00:05:00Z"),
		);
		expect(filters.from).toBe("2025-12-02");
		expect(filters.to).toBe("2026-03-01");
		expect(filters.includeDraft).toBe(false);
		expect(filters.states).toEqual(["closed", "merged", "open"]);
		expect(filters.audience).toBe("all");
	});

	test("canonicalizes set filters so ordering does not create a second cache", () => {
		const filters = contributionFiltersSchema.parse({
			source: "demo",
			from: null,
			to: null,
			teamIds: ["team-b", "team-a", "team-b"],
			states: ["merged", "open", "merged"],
		});
		expect(filters.teamIds).toEqual(["team-a", "team-b"]);
		expect(filters.states).toEqual(["merged", "open"]);
		expect(filters.contributorKeys).toEqual([]);
	});

	test("rejects invalid dates, half ranges, reversed or unbounded periods", () => {
		for (const range of [
			{ from: "2026-02-30", to: "2026-03-03" },
			{ from: "2026-03-01", to: null },
			{ from: null, to: "2026-03-01" },
			{ from: "2026-03-02", to: "2026-03-01" },
			{ from: "2024-01-01", to: "2026-03-01" },
		])
			expect(
				contributionFiltersSchema.safeParse({ source: "cli", ...range })
					.success,
			).toBe(false);
		expect(
			contributionFiltersSchema.safeParse({
				source: "cli",
				from: "2024-02-29",
				to: "2024-03-01",
			}).success,
		).toBe(true);
		expect(
			contributionFiltersSchema.safeParse({ source: "cli", states: [] })
				.success,
		).toBe(false);
		expect(
			contributionFiltersSchema.safeParse({ source: "unknown" }).success,
		).toBe(false);
		expect(
			contributionFiltersSchema.safeParse({
				source: "cli",
				includeDraft: "false",
			}).success,
		).toBe(false);
	});
});

describe("explicit provider identities", () => {
	test("validates directory drafts and canonicalizes account links and tag colors", () => {
		const key = identityKey("ado", "example", "User-A");
		expect(
			memberDraftSchema.parse({ name: "  Alice  ", identityKeys: [key, key] }),
		).toEqual({
			name: "Alice",
			avatarUrl: null,
			teamIds: [],
			tagIds: [],
			identityKeys: [key],
		});
		expect(
			memberDraftSchema.safeParse({
				name: "Alice",
				identityKeys: ["guessed-name"],
			}).success,
		).toBe(false);
		expect(tagDraftSchema.parse({ name: "Core", color: "#abcdef" })).toEqual({
			name: "Core",
			color: "#ABCDEF",
		});
		expect(
			tagDraftSchema.safeParse({ name: "Core", color: "red" }).success,
		).toBe(false);
		expect(
			teamDraftSchema.parse({ name: "Platform", memberIds: ["b", "a", "b"] }),
		).toMatchObject({ memberIds: ["a", "b"], tagIds: [], avatarUrl: null });
	});
	test("folds organization casing while retaining the provider and complete actor ID", () => {
		const key = identityKey("ado", "Example", "User-A");
		expect(key).toBe(identityKey("ado", "example", "User-A"));
		expect(key).not.toBe(identityKey("github", "example", "User-A"));
		expect(key).not.toBe(identityKey("ado", "elsewhere", "User-A"));
		expect(key).not.toBe(identityKey("ado", "example", "user-a"));
		expect(parseIdentityKey(key)).toEqual(["ado", "example", "User-A"]);
	});

	test("delimiters cannot alias two accounts or two repositories", () => {
		expect(identityKey("ado", "a:b", "c")).not.toBe(
			identityKey("ado", "a", "b:c"),
		);
		expect(repositoryKey("a:b", "c")).not.toBe(repositoryKey("a", "b:c"));
	});

	test("rejects malformed or noncanonical identity keys", () => {
		for (const key of [
			"",
			"null",
			"{}",
			"[]",
			'["ado","ORG","a"]',
			'["gitlab","org","a"]',
			'["ado","org",""]',
			'["ado","org","a","extra"]',
		]) {
			expect(parseIdentityKey(key)).toBeNull();
		}
	});
});

describe("contributor blocking", () => {
	test("accepts exact member or canonical account keys and requires an explicit state", () => {
		for (const key of [
			"member:person",
			`identity:${identityKey("ado", "org", "actor")}`,
		])
			expect(contributorBlockSchema.parse({ key, blocked: true })).toEqual({
				key,
				blocked: true,
			});
		for (const value of [
			{ key: "member:", blocked: true },
			{ key: "Alice", blocked: true },
			{ key: 'identity:["ado","ORG","actor"]', blocked: true },
			{ key: "member:person", blocked: "true" },
			{ key: "member:person" },
		])
			expect(contributorBlockSchema.safeParse(value).success).toBe(false);
	});
});
