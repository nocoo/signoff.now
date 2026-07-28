import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { avatarColorHex } from "@/lib/avatar";
import type { Developer, Tag, Team } from "@/models/entities";
import {
	archiveDeveloper,
	createDeveloper,
	createTag,
	listDevelopers,
	listTags,
	listTeams,
	patchDeveloper,
	restoreDeveloper,
} from "@/models/entitiesApi";
import {
	type DeveloperDraft,
	useDevelopersViewModel,
} from "./useDevelopersViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listDevelopers: vi.fn(),
	listTeams: vi.fn(),
	listTags: vi.fn(),
	createDeveloper: vi.fn(),
	createTag: vi.fn(),
	patchDeveloper: vi.fn(),
	archiveDeveloper: vi.fn(),
	restoreDeveloper: vi.fn(),
}));

const dev = (over: Partial<Developer> = {}): Developer => ({
	id: "d1",
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

const tag = (over: Partial<Tag> = {}): Tag => ({
	id: "g1",
	name: "frontend",
	color: "#FFFFFF",
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

const team = (over: Partial<Team> = {}): Team => ({
	id: "t1",
	name: "Core",
	avatarUrl: null,
	tagIds: [],
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

beforeEach(() => {
	vi.mocked(listDevelopers).mockReset().mockResolvedValue([dev()]);
	vi.mocked(listTeams).mockReset().mockResolvedValue([team()]);
	vi.mocked(listTags).mockReset().mockResolvedValue([tag()]);
	vi.mocked(createTag)
		.mockReset()
		.mockResolvedValue(tag({ id: "g-new", name: "infra" }));
	vi.mocked(createDeveloper).mockReset().mockResolvedValue(dev());
	vi.mocked(patchDeveloper).mockReset().mockResolvedValue(dev());
	vi.mocked(archiveDeveloper).mockReset().mockResolvedValue(undefined);
	vi.mocked(restoreDeveloper).mockReset().mockResolvedValue(undefined);
});

const mounted = async () => {
	const hook = renderHook(() => useDevelopersViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("loading", () => {
	it("fetches archived rows so the status filter needs no round trip", async () => {
		await mounted();
		expect(listDevelopers).toHaveBeenCalledWith(true);
	});

	it("a teams failure still shows the roster", async () => {
		// The roster is the entire point of this page; letting the decorative
		// team list reject would blank it.
		vi.mocked(listTeams).mockRejectedValueOnce(new Error("teams down"));
		const { result } = await mounted();
		expect(result.current.items).toHaveLength(1);
		expect(result.current.error).toBe("teams down");
	});

	it("a roster failure is reported", async () => {
		vi.mocked(listDevelopers).mockRejectedValueOnce(new Error("roster down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("roster down");
	});

	it("coerces a non-Error rejection", async () => {
		vi.mocked(listTeams).mockRejectedValueOnce("nope");
		const { result } = await mounted();
		expect(result.current.error).toBe("Load failed");
	});

	it("a slow first load cannot overwrite a newer one", async () => {
		// Otherwise a post-mutation refresh gets replaced by the stale initial
		// response and the change looks like it silently failed.
		let releaseSlow: (v: Developer[]) => void = () => {};
		vi.mocked(listDevelopers).mockReturnValueOnce(
			new Promise<Developer[]>((r) => {
				releaseSlow = r;
			}),
		);
		const hook = renderHook(() => useDevelopersViewModel());

		vi.mocked(listDevelopers).mockResolvedValue([dev({ name: "Fresh" })]);
		await act(async () => {
			await hook.result.current.reload();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");

		await act(async () => {
			releaseSlow([dev({ name: "Stale" })]);
			await Promise.resolve();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");
	});
});

describe("filtering", () => {
	it("hides archived rows by default and reports both counts", async () => {
		vi.mocked(listDevelopers).mockResolvedValue([
			dev({ id: "1" }),
			dev({ id: "2", alias: "old", archivedAt: 99 }),
		]);
		const { result } = await mounted();
		expect(result.current.items).toHaveLength(2);
		expect(result.current.visible).toHaveLength(1);
	});

	it("re-derives when the filter changes", async () => {
		vi.mocked(listDevelopers).mockResolvedValue([
			dev({ id: "1" }),
			dev({ id: "2", alias: "old", archivedAt: 99 }),
		]);
		const { result } = await mounted();
		act(() => {
			result.current.setFilter((f) => ({ ...f, status: "all" }));
		});
		expect(result.current.visible).toHaveLength(2);
	});

	it("indexes teams by id for the row renderer", async () => {
		const { result } = await mounted();
		expect(result.current.teamsById.get("t1")?.name).toBe("Core");
	});
});

describe("submit (create and edit share one path)", () => {
	const draft = (over: Partial<DeveloperDraft> = {}): DeveloperDraft => ({
		name: "Bob",
		alias: "bob",
		avatarUrl: "",
		teamIds: [],
		tagIds: [],
		...over,
	});

	it("creates when nothing is being edited", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit(draft({ tagIds: ["g1"] }));
		});
		expect(createDeveloper).toHaveBeenCalledWith("Bob", "bob", {
			avatarUrl: null,
			teamIds: [],
			tagIds: ["g1"],
		});
		expect(patchDeveloper).not.toHaveBeenCalled();
	});

	it("patches when a row is being edited", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setEditing(dev());
		});
		await act(async () => {
			await result.current.submit(draft({ name: "Ada", alias: "ada" }));
		});
		expect(patchDeveloper).toHaveBeenCalledWith("d1", {
			name: "Ada",
			alias: "ada",
			avatarUrl: null,
			teamIds: [],
			tagIds: [],
		});
		expect(createDeveloper).not.toHaveBeenCalled();
	});

	it("sends a blank avatar as null, not an empty string", async () => {
		// null is the API's one spelling of "no image"; "" would be a second.
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit(draft({ avatarUrl: "   " }));
		});
		expect(vi.mocked(createDeveloper).mock.calls[0]?.[2]).toMatchObject({
			avatarUrl: null,
		});
	});

	it("reloads after a successful write", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit(draft());
		});
		expect(listDevelopers).toHaveBeenCalledTimes(2);
	});

	it("propagates a failure so the dialog can stay open", async () => {
		// Swallowing it here would close the dialog and discard the edits.
		vi.mocked(createDeveloper).mockRejectedValueOnce(new Error("taken"));
		const { result } = await mounted();
		await expect(result.current.submit(draft())).rejects.toThrow("taken");
	});
});

describe("addTag", () => {
	it("derives the colour from the name and selects the new tag", async () => {
		// The API requires a colour; asking for a hex value mid-edit is a worse
		// trade than a stable generated one.
		const { result } = await mounted();
		let id = "";
		await act(async () => {
			id = await result.current.addTag("infra");
		});
		// Assert the SHAPE, not just `avatarColorHex(...)` echoed back: the
		// first version of this passed `avatarColor`, which returns
		// `hsl(10 62% 49%)`. The server validates `^#[0-9A-Fa-f]{6}$`, so every
		// inline tag creation was a 400 — and a test that compared the call
		// against the same function could never notice.
		const color = vi.mocked(createTag).mock.calls[0]?.[1] as string;
		expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
		expect(color).toBe(avatarColorHex("infra"));
		expect(id).toBe("g-new");
	});

	it("adds it to the local list without a full reload", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.addTag("infra");
		});
		expect(result.current.tags.map((t) => t.name)).toContain("infra");
		// One load on mount; creating a tag must not trigger a second.
		expect(listDevelopers).toHaveBeenCalledTimes(1);
	});

	it("keeps the list sorted by name", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.addTag("infra");
		});
		const names = result.current.tags.map((t) => t.name);
		expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
	});
});

describe("archive / restore", () => {
	it("archives then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("d1");
		});
		expect(archiveDeveloper).toHaveBeenCalledWith("d1");
		expect(listDevelopers).toHaveBeenCalledTimes(2);
	});

	it("restores then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.restore("d1");
		});
		expect(restoreDeveloper).toHaveBeenCalledWith("d1");
	});

	it("a second mutation while one is in flight is dropped", async () => {
		// A double-clicked Archive otherwise fires twice, and the second one's
		// error surfaces after the first already succeeded.
		let release: () => void = () => {};
		vi.mocked(archiveDeveloper).mockReturnValueOnce(
			new Promise<void>((r) => {
				release = r;
			}),
		);
		const { result } = await mounted();

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.archive("d1");
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.archive("d1")).toBe(false);
		});
		expect(archiveDeveloper).toHaveBeenCalledTimes(1);

		await act(async () => {
			release();
			await first;
		});
		expect(result.current.busy).toBe(false);
	});

	it("reports a failure", async () => {
		vi.mocked(archiveDeveloper).mockRejectedValueOnce(new Error("gone"));
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("d1");
		});
		expect(result.current.error).toBe("gone");
	});

	it("coerces a non-Error mutation rejection", async () => {
		vi.mocked(archiveDeveloper).mockRejectedValueOnce("boom");
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("d1");
		});
		expect(result.current.error).toBe("Request failed");
	});
});
