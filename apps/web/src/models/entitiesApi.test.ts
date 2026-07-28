/**
 * Contract tests for the entity HTTP client.
 *
 * This file is why `entitiesApi.ts` is now INSIDE the coverage gate. Without
 * tests a wrong path, verb or body shape breaks production while every other
 * suite stays green — the ViewModel tests mock this module, so they cannot see
 * it. These assert the wire contract itself: what URL, what method, what JSON.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	archiveDeveloper,
	archiveRepo,
	archiveTag,
	archiveTeam,
	createDeveloper,
	createRepo,
	createTag,
	createTeam,
	fetchMe,
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
	patchDeveloper,
	patchRepo,
	patchTeam,
	restoreDeveloper,
} from "./entitiesApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const devRow = {
	id: "d1",
	name: "Ada",
	alias: "ada",
	avatarUrl: "https://x/a.png",
	teamIds: ["t1"],
	createdAt: 1,
	updatedAt: 2,
	archivedAt: null,
};

const call = () => vi.mocked(apiFetch).mock.calls[0] as [string, RequestInit?];
const body = () => JSON.parse(String(call()[1]?.body));

beforeEach(() => {
	vi.mocked(apiFetch).mockReset().mockResolvedValue({ items: [] });
});

describe("listDevelopers", () => {
	it("omits archived rows by default", async () => {
		await listDevelopers();
		expect(call()[0]).toBe("/api/developers");
	});

	it("asks for archived rows when told to", async () => {
		// The roster page relies on this to filter status without refetching.
		await listDevelopers(true);
		expect(call()[0]).toBe("/api/developers?includeArchived=1");
	});

	it("parses each item rather than passing raw JSON through", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ items: [{ ...devRow }] });
		const [d] = await listDevelopers();
		expect(d).toMatchObject({ avatarUrl: "https://x/a.png", teamIds: ["t1"] });
	});
});

describe("createDeveloper", () => {
	it("posts name and alias", async () => {
		vi.mocked(apiFetch).mockResolvedValue(devRow);
		await createDeveloper("Ada", "ada");
		expect(call()[0]).toBe("/api/developers");
		expect(call()[1]?.method).toBe("POST");
		expect(body()).toEqual({ name: "Ada", alias: "ada" });
	});

	it("merges optional avatar and teams into the same body", async () => {
		vi.mocked(apiFetch).mockResolvedValue(devRow);
		await createDeveloper("Ada", "ada", {
			avatarUrl: "https://x/a.png",
			teamIds: ["t1"],
		});
		expect(body()).toEqual({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
			teamIds: ["t1"],
		});
	});
});

describe("patchDeveloper", () => {
	it("PATCHes only the keys given", async () => {
		// Sending absent keys as null would wipe fields the caller never named.
		vi.mocked(apiFetch).mockResolvedValue(devRow);
		await patchDeveloper("d1", { alias: "ada2" });
		expect(call()[0]).toBe("/api/developers/d1");
		expect(call()[1]?.method).toBe("PATCH");
		expect(body()).toEqual({ alias: "ada2" });
	});

	it("carries an explicit null through as a clear", async () => {
		vi.mocked(apiFetch).mockResolvedValue(devRow);
		await patchDeveloper("d1", { avatarUrl: null, teamIds: [] });
		expect(body()).toEqual({ avatarUrl: null, teamIds: [] });
	});
});

describe("archive / restore", () => {
	it("posts to the archive path", async () => {
		await archiveDeveloper("d1");
		expect(call()[0]).toBe("/api/developers/d1/archive");
		expect(call()[1]?.method).toBe("POST");
	});

	it("posts to the restore path", async () => {
		// A typo here silently turns Restore into a second Archive.
		await restoreDeveloper("d1");
		expect(call()[0]).toBe("/api/developers/d1/restore");
		expect(call()[1]?.method).toBe("POST");
	});
});

describe("teams", () => {
	it("lists, with and without archived", async () => {
		await listTeams();
		expect(call()[0]).toBe("/api/teams");
		vi.mocked(apiFetch).mockClear();
		await listTeams(true);
		expect(call()[0]).toBe("/api/teams?includeArchived=1");
	});

	it("creates with an optional avatar", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ id: "t1", name: "Core" });
		await createTeam("Core", { avatarUrl: "https://x/t.png" });
		expect(body()).toEqual({ name: "Core", avatarUrl: "https://x/t.png" });
	});

	it("patches by id", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ id: "t1", name: "Core" });
		await patchTeam("t1", { avatarUrl: null });
		expect(call()[0]).toBe("/api/teams/t1");
		expect(call()[1]?.method).toBe("PATCH");
		expect(body()).toEqual({ avatarUrl: null });
	});
});

describe("tags", () => {
	it("lists, with and without archived", async () => {
		await listTags();
		expect(call()[0]).toBe("/api/tags");
		vi.mocked(apiFetch).mockClear();
		await listTags(true);
		expect(call()[0]).toBe("/api/tags?includeArchived=1");
	});

	it("creates with a colour", async () => {
		vi.mocked(apiFetch).mockResolvedValue({
			id: "g1",
			name: "fe",
			color: "#FFFFFF",
		});
		await createTag("fe", "#FFFFFF");
		expect(call()[0]).toBe("/api/tags");
		expect(body()).toEqual({ name: "fe", color: "#FFFFFF" });
	});

	it("archives by id", async () => {
		await archiveTag("g1");
		expect(call()[0]).toBe("/api/tags/g1/archive");
		expect(call()[1]?.method).toBe("POST");
	});
});

describe("repos", () => {
	const repoRow = {
		id: "r1",
		provider: "ado",
		org: "o",
		project: "p",
		name: "n",
		remoteUrl: null,
		externalId: "guid",
		projectExternalId: "pguid",
		enabled: true,
		createdAt: 1,
		updatedAt: 1,
		archivedAt: null,
	};

	it("lists, with and without archived", async () => {
		await listRepos();
		expect(call()[0]).toBe("/api/repos");
		vi.mocked(apiFetch).mockClear();
		await listRepos(true);
		expect(call()[0]).toBe("/api/repos?includeArchived=1");
	});

	it("posts the body through unchanged", async () => {
		// The repo body carries the ADO GUIDs that ingest matches on; a dropped
		// key here surfaces much later as a 422 during collection.
		vi.mocked(apiFetch).mockResolvedValue(repoRow);
		await createRepo({
			org: "o",
			project: "p",
			name: "n",
			externalId: "guid",
			projectExternalId: "pguid",
			enabled: true,
		});
		expect(call()[0]).toBe("/api/repos");
		expect(body()).toEqual({
			org: "o",
			project: "p",
			name: "n",
			externalId: "guid",
			projectExternalId: "pguid",
			enabled: true,
		});
	});

	it("patches only the keys given", async () => {
		vi.mocked(apiFetch).mockResolvedValue(repoRow);
		await patchRepo("r1", { enabled: false });
		expect(call()[0]).toBe("/api/repos/r1");
		expect(call()[1]?.method).toBe("PATCH");
		expect(body()).toEqual({ enabled: false });
	});

	it("archives by id", async () => {
		await archiveRepo("r1");
		expect(call()[0]).toBe("/api/repos/r1/archive");
	});
});

describe("teams archive and me", () => {
	it("archives a team", async () => {
		await archiveTeam("t1");
		expect(call()[0]).toBe("/api/teams/t1/archive");
		expect(call()[1]?.method).toBe("POST");
	});

	it("fetches the caller identity", async () => {
		vi.mocked(apiFetch).mockResolvedValue({
			email: "a@b",
			name: "Ada",
			authenticated: true,
		});
		expect(await fetchMe()).toMatchObject({ authenticated: true });
		expect(call()[0]).toBe("/api/me");
	});
});
