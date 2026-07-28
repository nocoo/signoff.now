import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/models/entities";
import {
	archiveTeam,
	createTeam,
	listTeams,
	patchTeam,
} from "@/models/entitiesApi";
import {
	teamDraftFrom,
	useTeamEditViewModel,
	useTeamsViewModel,
	validateTeamDraft,
} from "./useTeamsViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listTeams: vi.fn(),
	createTeam: vi.fn(),
	patchTeam: vi.fn(),
	archiveTeam: vi.fn(),
}));

const team = (over: Partial<Team> = {}): Team => ({
	id: "t1",
	name: "Core",
	avatarUrl: null,
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

beforeEach(() => {
	vi.mocked(listTeams).mockReset().mockResolvedValue([team()]);
	vi.mocked(createTeam).mockReset().mockResolvedValue(team());
	vi.mocked(patchTeam).mockReset().mockResolvedValue(team());
	vi.mocked(archiveTeam).mockReset().mockResolvedValue(undefined);
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
		});
		expect(teamDraftFrom(team()).avatarUrl).toBe("");
		expect(teamDraftFrom(null)).toEqual({ name: "", avatarUrl: "" });
	});

	it("requires a name and validates the avatar", () => {
		expect(validateTeamDraft({ name: "  ", avatarUrl: "" })).toMatch(/Name/);
		expect(
			validateTeamDraft({ name: "Core", avatarUrl: "javascript:alert(1)" }),
		).toMatch(/http/);
		expect(validateTeamDraft({ name: "Core", avatarUrl: "" })).toBeNull();
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
		act(() => {
			result.current.setName("   ");
		});
		await act(async () => {
			expect(await result.current.create()).toBe(false);
		});
		expect(createTeam).not.toHaveBeenCalled();
		expect(result.current.error).toMatch(/Name/);
	});

	it("creates with a trimmed name and clears the field", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setName("  Platform  ");
		});
		await act(async () => {
			await result.current.create();
		});
		expect(createTeam).toHaveBeenCalledWith("Platform");
		expect(result.current.name).toBe("");
	});

	it("keeps the typed name when the create fails", async () => {
		// Clearing it would make the user retype what they just lost.
		vi.mocked(createTeam).mockRejectedValueOnce(new Error("exists"));
		const { result } = await mounted();
		act(() => {
			result.current.setName("Platform");
		});
		await act(async () => {
			await result.current.create();
		});
		expect(result.current.name).toBe("Platform");
		expect(result.current.error).toBe("exists");
	});

	it("a second create while one is in flight is dropped", async () => {
		// Enter and the Add button both call this; a fast Enter-then-click
		// would otherwise create the team twice.
		let release: (v: Team) => void = () => {};
		vi.mocked(createTeam).mockReturnValueOnce(
			new Promise<Team>((r) => {
				release = r;
			}),
		);
		const { result } = await mounted();
		act(() => {
			result.current.setName("Platform");
		});

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.create();
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.create()).toBe(false);
		});
		expect(createTeam).toHaveBeenCalledTimes(1);

		await act(async () => {
			release(team());
			await first;
		});
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
		await act(async () => {
			await result.current.submitEdit({ name: "X", avatarUrl: "" });
		});
		expect(patchTeam).not.toHaveBeenCalled();
	});

	it("submitEdit sends a blank avatar as null", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setEditing(team());
		});
		await act(async () => {
			await result.current.submitEdit({ name: "Core", avatarUrl: "  " });
		});
		expect(patchTeam).toHaveBeenCalledWith("t1", {
			name: "Core",
			avatarUrl: null,
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
