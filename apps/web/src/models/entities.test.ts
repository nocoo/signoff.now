import { describe, expect, test } from "vitest";
import {
	type Developer,
	EMPTY_DEVELOPER_FILTER,
	filterDevelopers,
	parseDeveloper,
	parseRepo,
	parseTag,
	parseTeam,
	validateAvatarUrl,
	validateDeveloperInput,
} from "./entities";

describe("parseDeveloper", () => {
	test("maps fields", () => {
		const d = parseDeveloper({
			id: "1",
			name: "Ada",
			alias: "ada",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(d.alias).toBe("ada");
		expect(d.archivedAt).toBeNull();
	});

	test("maps archivedAt", () => {
		const d = parseDeveloper({
			id: "1",
			name: "Ada",
			alias: "ada",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: 99,
		});
		expect(d.archivedAt).toBe(99);
	});
});

describe("parseTeam / parseTag / parseRepo", () => {
	test("team", () => {
		const t = parseTeam({
			id: "t",
			name: "Core",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(t.name).toBe("Core");
	});

	test("tag", () => {
		const t = parseTag({
			id: "g",
			name: "fe",
			color: "#FFFFFF",
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(t.color).toBe("#FFFFFF");
	});

	test("repo", () => {
		const r = parseRepo({
			id: "r",
			provider: "ado",
			org: "o",
			project: "p",
			name: "n",
			remoteUrl: null,
			externalId: "guid",
			projectExternalId: "pg-guid",
			enabled: true,
			createdAt: 1,
			updatedAt: 2,
			archivedAt: null,
		});
		expect(r.externalId).toBe("guid");
		expect(r.projectExternalId).toBe("pg-guid");
		expect(r.enabled).toBe(true);
	});

	test("archived team/tag/repo", () => {
		expect(
			parseTeam({
				id: "t",
				name: "X",
				createdAt: 1,
				updatedAt: 2,
				archivedAt: 5,
			}).archivedAt,
		).toBe(5);
		expect(
			parseTag({
				id: "g",
				name: "x",
				color: "#000000",
				createdAt: 1,
				updatedAt: 2,
				archivedAt: 6,
			}).archivedAt,
		).toBe(6);
		const r = parseRepo({
			id: "r",
			provider: "ado",
			org: "o",
			project: "p",
			name: "n",
			remoteUrl: "https://example.com",
			externalId: null,
			projectExternalId: null,
			enabled: false,
			createdAt: 1,
			updatedAt: 2,
			archivedAt: 7,
		});
		expect(r.archivedAt).toBe(7);
		expect(r.remoteUrl).toBe("https://example.com");
		expect(r.projectExternalId).toBeNull();
		expect(r.enabled).toBe(false);
	});
});

describe("validateDeveloperInput", () => {
	test("rejects empty", () => {
		expect(validateDeveloperInput("", "a")).toMatch(/Name/);
		expect(validateDeveloperInput("A", "a@b")).toMatch(/Alias/);
		expect(validateDeveloperInput("A", "ada")).toBeNull();
	});
});

describe("parseDeveloper profile fields", () => {
	const base = {
		id: "1",
		name: "Ada",
		alias: "ada",
		createdAt: 1,
		updatedAt: 2,
		archivedAt: null,
	};

	test("carries avatarUrl and teamIds", () => {
		const d = parseDeveloper({
			...base,
			avatarUrl: "https://x/a.png",
			teamIds: ["t1", "t2"],
		});
		expect(d.avatarUrl).toBe("https://x/a.png");
		expect(d.teamIds).toEqual(["t1", "t2"]);
	});

	test("a row without either field parses to null and []", () => {
		// Rows written before these columns existed still have to render.
		const d = parseDeveloper(base);
		expect(d.avatarUrl).toBeNull();
		expect(d.teamIds).toEqual([]);
	});

	test("a non-array teamIds does not become a broken list", () => {
		// `.map` on a string would yield per-character ids and render garbage
		// rather than fail loudly.
		expect(parseDeveloper({ ...base, teamIds: "t1" }).teamIds).toEqual([]);
	});

	test("a non-string avatarUrl is dropped", () => {
		expect(parseDeveloper({ ...base, avatarUrl: 42 }).avatarUrl).toBeNull();
	});

	test("team avatars parse the same way", () => {
		expect(
			parseTeam({
				id: "t",
				name: "Core",
				avatarUrl: "https://x/t.png",
				createdAt: 1,
				updatedAt: 2,
				archivedAt: null,
			}).avatarUrl,
		).toBe("https://x/t.png");
	});
});

describe("validateAvatarUrl", () => {
	test("accepts blank as 'no avatar'", () => {
		expect(validateAvatarUrl("")).toBeNull();
		expect(validateAvatarUrl("   ")).toBeNull();
	});

	test("accepts http(s)", () => {
		expect(validateAvatarUrl("https://x/a.png")).toBeNull();
		expect(validateAvatarUrl("http://x/a.png")).toBeNull();
	});

	test("rejects a scripting scheme", () => {
		expect(validateAvatarUrl("javascript:alert(1)")).toMatch(/http/);
	});

	test("rejects a relative path", () => {
		expect(validateAvatarUrl("/a.png")).toMatch(/absolute/);
	});
});

describe("filterDevelopers", () => {
	const dev = (over: Partial<Developer>): Developer => ({
		id: "d",
		name: "Ada Lovelace",
		alias: "ada",
		avatarUrl: null,
		teamIds: [],
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
		...over,
	});
	const ada = dev({ id: "1", name: "Ada Lovelace", alias: "ada" });
	const bob = dev({
		id: "2",
		name: "Bob Stone",
		alias: "bstone",
		teamIds: ["t1"],
	});
	const gone = dev({ id: "3", name: "Old Hand", alias: "old", archivedAt: 99 });
	const all = [ada, bob, gone];
	const ids = (f: Parameters<typeof filterDevelopers>[1]) =>
		filterDevelopers(all, f).map((d) => d.id);

	test("hides archived by default", () => {
		expect(ids(EMPTY_DEVELOPER_FILTER)).toEqual(["1", "2"]);
	});

	test("archived shows only archived, not everything", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, status: "archived" })).toEqual([
			"3",
		]);
	});

	test("all shows both", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, status: "all" })).toEqual([
			"1",
			"2",
			"3",
		]);
	});

	test("keyword matches the name case-insensitively", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, keyword: "LOVEL" })).toEqual(["1"]);
	});

	test("keyword also matches the alias", () => {
		// The alias is what the pipeline matches on, so it is what someone
		// chasing a missing developer will type.
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, keyword: "bstone" })).toEqual([
			"2",
		]);
	});

	test("a blank keyword is not a filter", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, keyword: "   " })).toEqual([
			"1",
			"2",
		]);
	});

	test("team narrows to members", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, teamId: "t1" })).toEqual(["2"]);
	});

	test("filters compose rather than override", () => {
		expect(ids({ keyword: "bob", status: "active", teamId: "t1" })).toEqual([
			"2",
		]);
		expect(ids({ keyword: "ada", status: "active", teamId: "t1" })).toEqual([]);
	});

	test("does not mutate the input", () => {
		const input = [...all];
		filterDevelopers(input, { ...EMPTY_DEVELOPER_FILTER, keyword: "ada" });
		expect(input).toEqual(all);
	});
});
