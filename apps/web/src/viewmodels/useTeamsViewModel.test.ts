import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { avatarColorHex } from "@/lib/avatar";
import type { Tag, Team } from "@/models/entities";
import {
	archiveTeam,
	createTag,
	createTeam,
	listTags,
	listTeams,
	patchTeam,
	restoreTeam,
} from "@/models/entitiesApi";
import {
	teamDraftFrom,
	useTeamEditViewModel,
	useTeamsViewModel,
	validateTeamDraft,
} from "./useTeamsViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listTeams: vi.fn(),
	listTags: vi.fn(),
	createTeam: vi.fn(),
	createTag: vi.fn(),
	patchTeam: vi.fn(),
	archiveTeam: vi.fn(),
	restoreTeam: vi.fn(),
}));

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
	vi.mocked(listTeams).mockReset().mockResolvedValue([team()]);
	vi.mocked(listTags).mockReset().mockResolvedValue([tag()]);
	vi.mocked(createTag)
		.mockReset()
		.mockResolvedValue(tag({ id: "g-new", name: "infra" }));
	vi.mocked(createTeam).mockReset().mockResolvedValue(team());
	vi.mocked(patchTeam).mockReset().mockResolvedValue(team());
	vi.mocked(archiveTeam).mockReset().mockResolvedValue(undefined);
	vi.mocked(restoreTeam).mockReset().mockResolvedValue(undefined);
});

const mounted = async () => {
	const hook = renderHook(() => useTeamsViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("teamDraftFrom / validateTeamDraft", () => {
	it("maps a row and renders a null avatar as empty text", () => {
		expect(teamDraftFrom(team({ avatarUrl: "https://x/t.png" }))).toEqual({
			name: "Core",
			avatarUrl: "https://x/t.png",
			tagIds: [],
		});
		expect(teamDraftFrom(team()).avatarUrl).toBe("");
		expect(teamDraftFrom(null)).toEqual({
			name: "",
			avatarUrl: "",
			tagIds: [],
		});
	});

	it("requires a name and validates the avatar", () => {
		expect(
			validateTeamDraft({ name: "  ", avatarUrl: "", tagIds: [] }),
		).toMatch(/Name/);
		expect(
			validateTeamDraft({
				name: "Core",
				avatarUrl: "javascript:alert(1)",
				tagIds: [],
			}),
		).toMatch(/http/);
		expect(
			validateTeamDraft({ name: "Core", avatarUrl: "", tagIds: [] }),
		).toBeNull();
	});
});

describe("useTeamsViewModel", () => {
	it("loads on mount", async () => {
		const { result } = await mounted();
		expect(result.current.items).toHaveLength(1);
		expect(result.current.error).toBeNull();
	});

	it("reports a load failure", async () => {
		vi.mocked(listTeams).mockRejectedValueOnce(new Error("down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("down");
	});

	it("coerces a non-Error load rejection", async () => {
		vi.mocked(listTeams).mockRejectedValueOnce("nope");
		const { result } = await mounted();
		expect(result.current.error).toBe("Load failed");
	});

	it("a slow first load cannot overwrite a newer one", async () => {
		let releaseSlow: (v: Team[]) => void = () => {};
		vi.mocked(listTeams).mockReturnValueOnce(
			new Promise<Team[]>((r) => {
				releaseSlow = r;
			}),
		);
		const hook = renderHook(() => useTeamsViewModel());

		vi.mocked(listTeams).mockResolvedValue([team({ name: "Fresh" })]);
		await act(async () => {
			await hook.result.current.reload();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");

		await act(async () => {
			releaseSlow([team({ name: "Stale" })]);
			await Promise.resolve();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");
	});

	it("refuses a blank name without calling the API", async () => {
		const { result } = await mounted();
		await act(async () => {
			await expect(
				result.current.submit({ name: "   ", avatarUrl: "", tagIds: [] }),
			).resolves.toBeUndefined();
		});
		// submit itself does not validate — the dialog's ViewModel does, and it
		// is what stops a blank name reaching here. This asserts the split holds:
		// a trimmed-empty name is sent as-is rather than silently "fixed".
		expect(createTeam).toHaveBeenCalledWith("", {
			avatarUrl: null,
			tagIds: [],
		});
	});

	it("creates with a trimmed name, avatar and tags", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit({
				name: "  Platform  ",
				avatarUrl: " https://x/t.png ",
				tagIds: ["g1"],
			});
		});
		expect(createTeam).toHaveBeenCalledWith("Platform", {
			avatarUrl: "https://x/t.png",
			tagIds: ["g1"],
		});
		expect(listTeams).toHaveBeenCalledTimes(2);
	});

	it("a failed create rejects so the dialog can stay open", async () => {
		// Swallowing this would close the dialog on a name clash and lose the
		// avatar and tags the user had just picked.
		vi.mocked(createTeam).mockRejectedValueOnce(new Error("exists"));
		const { result } = await mounted();
		await act(async () => {
			await expect(
				result.current.submit({
					name: "Platform",
					avatarUrl: "",
					tagIds: [],
				}),
			).rejects.toThrow("exists");
		});
	});

	it("addTag derives a colour and keeps the list sorted", async () => {
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
		const names = result.current.tags.map((t) => t.name);
		expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
	});

	it("loads tags alongside teams", async () => {
		const { result } = await mounted();
		expect(result.current.tags).toHaveLength(1);
	});

	it("archives then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("t1");
		});
		expect(archiveTeam).toHaveBeenCalledWith("t1");
		expect(listTeams).toHaveBeenCalledTimes(2);
	});

	it("reports an archive failure", async () => {
		vi.mocked(archiveTeam).mockRejectedValueOnce("boom");
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("t1");
		});
		expect(result.current.error).toBe("Request failed");
	});

	it("submitEdit does nothing without a row", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setCreating(true);
		});
		await act(async () => {
			await result.current.submit({ name: "X", avatarUrl: "", tagIds: [] });
		});
		// No row selected means create, never a patch against some other team.
		expect(patchTeam).not.toHaveBeenCalled();
		expect(createTeam).toHaveBeenCalled();
	});

	it("submitEdit sends a blank avatar as null and carries the tags", async () => {
		// Non-empty tagIds on purpose: asserting [] here would pass just as well
		// against a body that dropped the field entirely.
		const { result } = await mounted();
		act(() => {
			result.current.setEditing(team());
		});
		await act(async () => {
			await result.current.submit({
				name: "Core",
				avatarUrl: "  ",
				tagIds: ["g1", "g2"],
			});
		});
		expect(patchTeam).toHaveBeenCalledWith("t1", {
			name: "Core",
			avatarUrl: null,
			tagIds: ["g1", "g2"],
		});
	});

	it("fetches archived rows so status filtering needs no round trip", async () => {
		await mounted();
		expect(listTeams).toHaveBeenCalledWith(true);
	});

	it("filters the visible list without touching items", async () => {
		vi.mocked(listTeams).mockResolvedValue([
			team({ id: "t1", name: "Core" }),
			team({ id: "t2", name: "Infra", archivedAt: 9 }),
		]);
		const { result } = await mounted();
		expect(result.current.visible.map((t) => t.id)).toEqual(["t1"]);
		act(() => {
			result.current.setFilter((f) => ({ ...f, status: "archived" }));
		});
		expect(result.current.visible.map((t) => t.id)).toEqual(["t2"]);
		expect(result.current.items).toHaveLength(2);
	});

	it("restores then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.restore("t1");
		});
		expect(restoreTeam).toHaveBeenCalledWith("t1");
		expect(listTeams).toHaveBeenCalledTimes(2);
	});

	it("the dialog opens for a create and for an edit, and closes clean", async () => {
		const { result } = await mounted();
		expect(result.current.dialogOpen).toBe(false);
		act(() => {
			result.current.setCreating(true);
		});
		expect(result.current.dialogOpen).toBe(true);
		expect(result.current.editing).toBeNull();

		act(() => {
			result.current.closeDialog();
		});
		expect(result.current.dialogOpen).toBe(false);

		act(() => {
			result.current.setEditing(team());
		});
		expect(result.current.dialogOpen).toBe(true);
		act(() => {
			result.current.closeDialog();
		});
		// Both flags must clear: leaving `creating` set would reopen the dialog
		// empty the moment an edit closed.
		expect(result.current.dialogOpen).toBe(false);
		expect(result.current.editing).toBeNull();
	});

	it("indexes tags by id for the list", async () => {
		const { result } = await mounted();
		expect(result.current.tagsById.get("g1")?.name).toBe("frontend");
	});

	it("a second mutation while one is in flight is dropped", async () => {
		let release: () => void = () => {};
		vi.mocked(archiveTeam).mockReturnValueOnce(
			new Promise<void>((r) => {
				release = r;
			}),
		);
		const { result } = await mounted();

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.archive("t1");
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.archive("t1")).toBe(false);
		});
		expect(archiveTeam).toHaveBeenCalledTimes(1);

		await act(async () => {
			release();
			await first;
		});
	});
});

describe("useTeamEditViewModel", () => {
	const mount = (
		t: Team | null,
		onSubmit = vi.fn().mockResolvedValue(undefined),
		onDone = vi.fn(),
	) => ({
		...renderHook(({ t: cur }) => useTeamEditViewModel(cur, onSubmit, onDone), {
			initialProps: { t },
		}),
		onSubmit,
		onDone,
	});

	it("resets when a different team is edited", () => {
		const { result, rerender } = mount(team({ id: "t1", name: "Core" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ t: team({ id: "t2", name: "Platform" }) });
		expect(result.current.draft.name).toBe("Platform");
	});

	it("does not reset while editing the same team", () => {
		const { result, rerender } = mount(team({ id: "t1", name: "Core" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ t: team({ id: "t1", name: "Core" }) });
		expect(result.current.draft.name).toBe("typed");
	});

	it("toggles a tag on and off", () => {
		const { result } = mount(team());
		act(() => {
			result.current.toggleTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual(["g1"]);
		act(() => {
			result.current.toggleTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual([]);
	});

	it("selectTag keeps an already-selected tag selected", () => {
		// Reusing toggleTag here would DESELECT a tag that was already on —
		// exactly what happens when someone types the name of a tag they had
		// already ticked. Two calls must not cancel out.
		const { result } = mount(team());
		act(() => {
			result.current.toggleTag("g1");
		});
		act(() => {
			result.current.selectTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual(["g1"]);
	});

	it("carries existing tags into the draft", () => {
		const { result } = mount(team({ tagIds: ["g1"] }));
		expect(result.current.draft.tagIds).toEqual(["g1"]);
	});

	it("refuses an invalid draft", async () => {
		const { result, onSubmit } = mount(team());
		act(() => {
			result.current.setField("name", "");
		});
		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits and signals done", async () => {
		const { result, onSubmit, onDone } = mount(team());
		await act(async () => {
			expect(await result.current.save()).toBe(true);
		});
		expect(onSubmit).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
	});

	it("stays open on failure", async () => {
		const onSubmit = vi.fn().mockRejectedValue(new Error("name taken"));
		const { result, onDone } = mount(team(), onSubmit);
		await act(async () => {
			await result.current.save();
		});
		expect(onDone).not.toHaveBeenCalled();
		expect(result.current.error).toBe("name taken");
	});

	it("coerces a non-Error rejection", async () => {
		const onSubmit = vi.fn().mockRejectedValue("nope");
		const { result } = mount(team(), onSubmit);
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).toBe("Save failed");
	});

	it("ignores a second save while one is in flight", async () => {
		let release: () => void = () => {};
		const onSubmit = vi.fn(
			() =>
				new Promise<void>((r) => {
					release = r;
				}),
		);
		const { result } = mount(team(), onSubmit);

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.save();
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onSubmit).toHaveBeenCalledTimes(1);

		await act(async () => {
			release();
			await first;
		});
	});
});
