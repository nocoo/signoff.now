import { describe, expect, test } from "vitest";
import {
	type Developer,
	EMPTY_DEVELOPER_FILTER,
	EMPTY_REPO_FILTER,
	EMPTY_TAG_FILTER,
	EMPTY_TEAM_FILTER,
	filterDevelopers,
	filterRepos,
	filterTags,
	filterTeams,
	parseDeveloper,
	parseRepo,
	parseTag,
	parseTeam,
	type Repo,
	type RepoFilter,
	type Tag,
	type TagFilter,
	type Team,
	type TeamFilter,
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

	test("tagIds parse like teamIds", () => {
		expect(parseDeveloper({ ...base, tagIds: ["g1"] }).tagIds).toEqual(["g1"]);
		expect(parseDeveloper(base).tagIds).toEqual([]);
		expect(parseDeveloper({ ...base, tagIds: "g1" }).tagIds).toEqual([]);
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
		tagIds: [],
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
	const gone = dev({
		id: "3",
		name: "Old Hand",
		alias: "old",
		tagIds: ["g1"],
		archivedAt: 99,
	});
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

	test("tag narrows to tagged developers", () => {
		// "3" carries g1 but is archived, so the default status filter hides it.
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, tagId: "g1" })).toEqual([]);
		expect(
			ids({ ...EMPTY_DEVELOPER_FILTER, status: "all", tagId: "g1" }),
		).toEqual(["3"]);
	});

	test("team and tag compose rather than override", () => {
		// Both set means BOTH must match; treating the second as a replacement
		// would quietly widen the result.
		expect(
			ids({ ...EMPTY_DEVELOPER_FILTER, teamId: "t1", tagId: "g1" }),
		).toEqual([]);
	});

	test("team narrows to members", () => {
		expect(ids({ ...EMPTY_DEVELOPER_FILTER, teamId: "t1" })).toEqual(["2"]);
	});

	test("filters compose rather than override", () => {
		expect(
			ids({ keyword: "bob", status: "active", teamId: "t1", tagId: null }),
		).toEqual(["2"]);
		expect(
			ids({ keyword: "ada", status: "active", teamId: "t1", tagId: null }),
		).toEqual([]);
	});

	test("does not mutate the input", () => {
		const input = [...all];
		filterDevelopers(input, { ...EMPTY_DEVELOPER_FILTER, keyword: "ada" });
		expect(input).toEqual(all);
	});
});

describe("filterTeams", () => {
	const team = (over: Partial<Team>): Team => ({
		id: "t",
		name: "Core",
		avatarUrl: null,
		tagIds: [],
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
		...over,
	});
	const core = team({ id: "1", name: "Core Platform", tagIds: ["g1"] });
	const infra = team({ id: "2", name: "Infra" });
	const gone = team({ id: "3", name: "Legacy", tagIds: ["g1"], archivedAt: 9 });
	const all = [core, infra, gone];
	const ids = (f: TeamFilter) => filterTeams(all, f).map((t) => t.id);

	test("hides archived by default", () => {
		expect(ids(EMPTY_TEAM_FILTER)).toEqual(["1", "2"]);
	});

	test("archived shows only archived", () => {
		expect(ids({ ...EMPTY_TEAM_FILTER, status: "archived" })).toEqual(["3"]);
	});

	test("all shows both", () => {
		expect(ids({ ...EMPTY_TEAM_FILTER, status: "all" })).toEqual([
			"1",
			"2",
			"3",
		]);
	});

	test("keyword matches the name case-insensitively", () => {
		expect(ids({ ...EMPTY_TEAM_FILTER, keyword: "PLATF" })).toEqual(["1"]);
	});

	test("a blank keyword is not a filter", () => {
		expect(ids({ ...EMPTY_TEAM_FILTER, keyword: "  " })).toEqual(["1", "2"]);
	});

	test("tag narrows to tagged teams", () => {
		expect(ids({ ...EMPTY_TEAM_FILTER, tagId: "g1" })).toEqual(["1"]);
	});

	test("keyword and tag compose rather than override", () => {
		expect(
			ids({ ...EMPTY_TEAM_FILTER, keyword: "infra", tagId: "g1" }),
		).toEqual([]);
	});

	test("does not mutate the input", () => {
		const input = [...all];
		filterTeams(input, { ...EMPTY_TEAM_FILTER, keyword: "core" });
		expect(input).toEqual(all);
	});
});

describe("filterTags", () => {
	const tag = (over: Partial<Tag>): Tag => ({
		id: "g",
		name: "frontend",
		color: "#FFFFFF",
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
		...over,
	});
	const fe = tag({ id: "1", name: "Frontend" });
	const be = tag({ id: "2", name: "Backend" });
	const gone = tag({ id: "3", name: "Deprecated", archivedAt: 9 });
	const all = [fe, be, gone];
	const ids = (f: TagFilter) => filterTags(all, f).map((t) => t.id);

	test("hides archived by default", () => {
		expect(ids(EMPTY_TAG_FILTER)).toEqual(["1", "2"]);
	});

	test("archived shows only archived", () => {
		expect(ids({ ...EMPTY_TAG_FILTER, status: "archived" })).toEqual(["3"]);
	});

	test("all shows both", () => {
		expect(ids({ ...EMPTY_TAG_FILTER, status: "all" })).toEqual([
			"1",
			"2",
			"3",
		]);
	});

	test("keyword matches the name case-insensitively", () => {
		expect(ids({ ...EMPTY_TAG_FILTER, keyword: "END" })).toEqual(["1", "2"]);
	});

	test("a blank keyword is not a filter", () => {
		expect(ids({ ...EMPTY_TAG_FILTER, keyword: " " })).toEqual(["1", "2"]);
	});

	test("does not mutate the input", () => {
		const input = [...all];
		filterTags(input, { ...EMPTY_TAG_FILTER, keyword: "front" });
		expect(input).toEqual(all);
	});
});

describe("filterRepos", () => {
	const repo = (over: Partial<Repo>): Repo => ({
		id: "r",
		provider: "ado",
		org: "contoso",
		project: "Widgets",
		name: "api",
		remoteUrl: null,
		externalId: "guid-1",
		projectExternalId: null,
		enabled: true,
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
		...over,
	});
	const api = repo({ id: "1", name: "api" });
	const web = repo({ id: "2", name: "web", org: "fabrikam", enabled: false });
	const gh = repo({
		id: "3",
		provider: "github",
		project: "Tools",
		name: "docs",
	});
	const gone = repo({ id: "4", name: "legacy", archivedAt: 9 });
	const all = [api, web, gh, gone];
	const ids = (f: RepoFilter) => filterRepos(all, f).map((r) => r.id);

	test("hides archived by default", () => {
		expect(ids(EMPTY_REPO_FILTER)).toEqual(["1", "2", "3"]);
	});

	test("archived shows only archived", () => {
		expect(ids({ ...EMPTY_REPO_FILTER, status: "archived" })).toEqual(["4"]);
	});

	test("keyword matches the repo name", () => {
		expect(ids({ ...EMPTY_REPO_FILTER, keyword: "API" })).toEqual(["1"]);
	});

	test("keyword also matches org and project", () => {
		// Someone chasing a binding types what they see in the ADO URL, which is
		// org/project far more often than the bare repo name.
		expect(ids({ ...EMPTY_REPO_FILTER, keyword: "fabrikam" })).toEqual(["2"]);
		expect(ids({ ...EMPTY_REPO_FILTER, keyword: "tools" })).toEqual(["3"]);
	});

	test("a blank keyword is not a filter", () => {
		expect(ids({ ...EMPTY_REPO_FILTER, keyword: "  " })).toEqual([
			"1",
			"2",
			"3",
		]);
	});

	test("provider narrows to one provider", () => {
		expect(ids({ ...EMPTY_REPO_FILTER, provider: "github" })).toEqual(["3"]);
		expect(ids({ ...EMPTY_REPO_FILTER, provider: "ado" })).toEqual(["1", "2"]);
	});

	test("enabled narrows both ways", () => {
		expect(ids({ ...EMPTY_REPO_FILTER, enabled: true })).toEqual(["1", "3"]);
		expect(ids({ ...EMPTY_REPO_FILTER, enabled: false })).toEqual(["2"]);
	});

	test("provider and enabled compose rather than override", () => {
		expect(
			ids({ ...EMPTY_REPO_FILTER, provider: "ado", enabled: false }),
		).toEqual(["2"]);
	});

	test("does not mutate the input", () => {
		const input = [...all];
		filterRepos(input, { ...EMPTY_REPO_FILTER, keyword: "api" });
		expect(input).toEqual(all);
	});
});
