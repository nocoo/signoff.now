import { type DirectoryData, identityKey } from "@signoff/domain/insights";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createDirectoryEditor,
	DEFAULT_DIRECTORY_FILTER,
	directoryStorageKey,
	discoverAuthors,
	filterMembers,
	filterTags,
	filterTeams,
	readDirectoryFilters,
	writeDirectoryFilters,
} from "./directory";

const key = identityKey("ado", "Org", "ada-account");
const data: DirectoryData = {
	source: "cli",
	blockedContributorKeys: [],
	revision: 42,
	projects: [],
	repositories: [],
	members: [
		{
			id: "ada",
			name: "Ada Lovelace",
			avatarUrl: null,
			teamIds: ["core"],
			tagIds: ["web"],
			identityKeys: [key],
			archivedAt: null,
		},
		{
			id: "bob",
			name: "Bob Chen",
			avatarUrl: null,
			teamIds: [],
			tagIds: [],
			identityKeys: [],
			archivedAt: 3,
		},
		{
			id: "cy",
			name: "Cy Lee",
			avatarUrl: "https://example.com/cy.png",
			teamIds: ["other"],
			tagIds: [],
			identityKeys: [],
			archivedAt: null,
		},
	],
	teams: [
		{
			id: "core",
			name: "Core",
			avatarUrl: null,
			tagIds: ["web"],
			memberIds: ["ada"],
			archivedAt: null,
		},
		{
			id: "other",
			name: "Other",
			avatarUrl: null,
			tagIds: [],
			memberIds: ["cy"],
			archivedAt: 4,
		},
	],
	tags: [
		{ id: "web", name: "Web", color: "#336699", archivedAt: null },
		{ id: "retired", name: "Retired", color: "#112233", archivedAt: 5 },
	],
	identities: [
		{
			key,
			provider: "ado",
			organization: "Org",
			actorId: "ada-account",
			name: "A. Lovelace",
			handle: "ada@example.com",
			avatarUrl: null,
			lastSeenAt: 3,
			memberId: "ada",
		},
		{
			key: identityKey("github", "github.com", "guest"),
			provider: "github",
			organization: "github.com",
			actorId: "guest",
			name: "Guest Author",
			handle: null,
			avatarUrl: null,
			lastSeenAt: null,
			memberId: null,
		},
	],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("defaults to followed active members and persists page/source filters separately", () => {
	expect(readDirectoryFilters("cli", "members")).toEqual(
		DEFAULT_DIRECTORY_FILTER,
	);
	const filter = {
		...DEFAULT_DIRECTORY_FILTER,
		keyword: "Ada",
		teamId: "core",
		tagId: "web",
		view: "discover" as const,
		status: "all" as const,
	};
	writeDirectoryFilters("cli", "members", filter);
	expect(readDirectoryFilters("cli", "members")).toEqual(filter);
	expect(readDirectoryFilters("demo", "members")).toEqual(
		DEFAULT_DIRECTORY_FILTER,
	);
	expect(readDirectoryFilters("cli", "teams")).toEqual(
		DEFAULT_DIRECTORY_FILTER,
	);
});

it("recovers safely from corrupt and obsolete filter values or unavailable storage", () => {
	const storageKey = directoryStorageKey("demo", "tags");
	for (const value of [
		"oops",
		"[]",
		"null",
		"3",
		JSON.stringify({
			keyword: 4,
			status: "deleted",
			teamId: false,
			tagId: {},
			view: "other",
		}),
	]) {
		localStorage.setItem(storageKey, value);
		expect(readDirectoryFilters("demo", "tags")).toEqual(
			DEFAULT_DIRECTORY_FILTER,
		);
	}
	localStorage.setItem(storageKey, JSON.stringify({ keyword: "Web" }));
	expect(readDirectoryFilters("demo", "tags").keyword).toBe("Web");
	vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new Error("disabled");
	});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new Error("quota");
	});
	expect(readDirectoryFilters("cli", "members")).toEqual(
		DEFAULT_DIRECTORY_FILTER,
	);
	expect(() =>
		writeDirectoryFilters("cli", "members", DEFAULT_DIRECTORY_FILTER),
	).not.toThrow();
});

it("filters members by exact memberships and tags, matching names and linked account handles", () => {
	expect(
		filterMembers(data, DEFAULT_DIRECTORY_FILTER).map((row) => row.id),
	).toEqual(["ada", "cy"]);
	expect(
		filterMembers(data, {
			...DEFAULT_DIRECTORY_FILTER,
			status: "archived",
		}).map((row) => row.id),
	).toEqual(["bob"]);
	expect(
		filterMembers(data, {
			...DEFAULT_DIRECTORY_FILTER,
			status: "all",
			keyword: "  EXAMPLE.COM ",
		}).map((row) => row.id),
	).toEqual(["ada"]);
	expect(
		filterMembers(data, {
			...DEFAULT_DIRECTORY_FILTER,
			teamId: "core",
			tagId: "web",
		}).map((row) => row.id),
	).toEqual(["ada"]);
	expect(
		filterMembers(data, { ...DEFAULT_DIRECTORY_FILTER, teamId: "missing" }),
	).toEqual([]);
	expect(
		filterMembers(data, { ...DEFAULT_DIRECTORY_FILTER, tagId: "missing" }),
	).toEqual([]);
	expect(
		filterMembers(data, {
			...DEFAULT_DIRECTORY_FILTER,
			status: "all",
			keyword: "bob",
		}).map((row) => row.id),
	).toEqual(["bob"]);
});

it("shows unlinked authors without guessing relationships from matching names", () => {
	const rows = discoverAuthors(data, "GITHUB");
	expect(rows.map((row) => row.actorId)).toEqual(["guest"]);
	expect(discoverAuthors(data, "ado")).toEqual([]);
	expect(discoverAuthors(data, "  ")).toHaveLength(1);
	expect(
		discoverAuthors(
			{ ...data, identities: [{ ...data.identities[0], memberId: null }] },
			"ada@example",
		),
	).toHaveLength(1);
});

it("filters teams by their own tags, and tags by status and name", () => {
	expect(
		filterTeams(data, {
			...DEFAULT_DIRECTORY_FILTER,
			keyword: "Co",
			tagId: "web",
		}).map((row) => row.id),
	).toEqual(["core"]);
	expect(
		filterTeams(data, { ...DEFAULT_DIRECTORY_FILTER, tagId: "missing" }),
	).toEqual([]);
	expect(
		filterTeams(data, { ...DEFAULT_DIRECTORY_FILTER, keyword: "missing" }),
	).toEqual([]);
	expect(
		filterTeams(data, { ...DEFAULT_DIRECTORY_FILTER, status: "archived" }).map(
			(row) => row.id,
		),
	).toEqual(["other"]);
	expect(
		filterTags(data, { ...DEFAULT_DIRECTORY_FILTER, keyword: "we" }).map(
			(row) => row.id,
		),
	).toEqual(["web"]);
	expect(
		filterTags(data, { ...DEFAULT_DIRECTORY_FILTER, status: "all" }),
	).toHaveLength(2);
});

it("builds detached full drafts and refuses missing or archived entities", () => {
	for (const kind of ["members", "teams", "tags"] as const) {
		expect(createDirectoryEditor(kind, data)).toMatchObject({
			kind,
			id: null,
			revision: 42,
			draft: { name: "" },
		});
		expect(createDirectoryEditor(kind, data, "missing")).toBeNull();
	}
	const member = createDirectoryEditor("members", data, "ada");
	expect(member).toMatchObject({
		id: "ada",
		kind: "members",
		revision: 42,
		draft: { name: "Ada Lovelace", identityKeys: [key] },
	});
	if (member?.kind === "members") member.draft.identityKeys.push("test");
	expect(data.members[0].identityKeys).toEqual([key]);
	expect(createDirectoryEditor("teams", data, "core")).toMatchObject({
		revision: 42,
		draft: { memberIds: ["ada"] },
	});
	expect(createDirectoryEditor("tags", data, "web")).toMatchObject({
		revision: 42,
		draft: { name: "Web", color: "#336699" },
	});
	expect(createDirectoryEditor("members", data, "bob")).toBeNull();
	expect(createDirectoryEditor("teams", data, "other")).toBeNull();
	expect(createDirectoryEditor("tags", data, "retired")).toBeNull();
});
