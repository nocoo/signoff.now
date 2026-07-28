import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repo } from "@/models/entities";
import {
	archiveRepo,
	createRepo,
	listRepos,
	patchRepo,
	restoreRepo,
} from "@/models/entitiesApi";
import {
	repoDraftFrom,
	useRepoEditViewModel,
	useReposViewModel,
	validateRepoDraft,
} from "./useReposViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listRepos: vi.fn(),
	createRepo: vi.fn(),
	patchRepo: vi.fn(),
	archiveRepo: vi.fn(),
	restoreRepo: vi.fn(),
}));

const repo = (over: Partial<Repo> = {}): Repo => ({
	id: "r1",
	provider: "ado",
	org: "contoso",
	project: "Widgets",
	name: "api",
	remoteUrl: null,
	externalId: "repo-guid",
	projectExternalId: null,
	enabled: true,
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

const draft = (over: Partial<ReturnType<typeof repoDraftFrom>> = {}) => ({
	...repoDraftFrom(null),
	org: "contoso",
	project: "Widgets",
	name: "api",
	externalId: "repo-guid",
	...over,
});

beforeEach(() => {
	vi.mocked(listRepos).mockReset().mockResolvedValue([repo()]);
	vi.mocked(createRepo).mockReset().mockResolvedValue(repo());
	vi.mocked(patchRepo).mockReset().mockResolvedValue(repo());
	vi.mocked(archiveRepo).mockReset().mockResolvedValue(undefined);
	vi.mocked(restoreRepo).mockReset().mockResolvedValue(undefined);
});

const mounted = async () => {
	const hook = renderHook(() => useReposViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("repoDraftFrom / validateRepoDraft", () => {
	it("maps a row and renders nulls as empty text", () => {
		expect(
			repoDraftFrom(repo({ projectExternalId: "proj-guid", enabled: false })),
		).toEqual({
			provider: "ado",
			org: "contoso",
			project: "Widgets",
			name: "api",
			externalId: "repo-guid",
			projectExternalId: "proj-guid",
			enabled: false,
		});
		expect(repoDraftFrom(repo()).projectExternalId).toBe("");
	});

	it("a new binding starts as an enabled ADO repo", () => {
		expect(repoDraftFrom(null)).toEqual({
			provider: "ado",
			org: "",
			project: "",
			name: "",
			externalId: "",
			projectExternalId: "",
			enabled: true,
		});
	});

	it("requires org, project and name", () => {
		expect(validateRepoDraft(draft({ org: " " }))).toMatch(/Org/);
		expect(validateRepoDraft(draft({ project: " " }))).toMatch(/Project/);
		expect(validateRepoDraft(draft({ name: " " }))).toMatch(/name/);
	});

	it("requires a repository GUID for an enabled ADO repo", () => {
		// The server refuses this outright, so letting it through turns a
		// missing field into a 400 the user meets only on save.
		expect(validateRepoDraft(draft({ externalId: "  " }))).toMatch(/GUID/);
	});

	it("allows a disabled ADO repo without a GUID", () => {
		expect(
			validateRepoDraft(draft({ externalId: "", enabled: false })),
		).toBeNull();
	});

	it("allows a github repo without a GUID", () => {
		expect(
			validateRepoDraft(draft({ provider: "github", externalId: "" })),
		).toBeNull();
	});

	it("accepts a complete draft", () => {
		expect(validateRepoDraft(draft())).toBeNull();
	});
});

describe("useReposViewModel", () => {
	it("loads on mount", async () => {
		const { result } = await mounted();
		expect(result.current.items).toHaveLength(1);
		expect(result.current.error).toBeNull();
	});

	it("fetches archived rows so status filtering needs no round trip", async () => {
		await mounted();
		expect(listRepos).toHaveBeenCalledWith(true);
	});

	it("reports a load failure", async () => {
		vi.mocked(listRepos).mockRejectedValueOnce(new Error("down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("down");
	});

	it("coerces a non-Error load rejection", async () => {
		vi.mocked(listRepos).mockRejectedValueOnce("nope");
		const { result } = await mounted();
		expect(result.current.error).toBe("Load failed");
	});

	it("a slow first load cannot overwrite a newer one", async () => {
		let releaseSlow: (v: Repo[]) => void = () => {};
		vi.mocked(listRepos).mockReturnValueOnce(
			new Promise<Repo[]>((r) => {
				releaseSlow = r;
			}),
		);
		const hook = renderHook(() => useReposViewModel());

		vi.mocked(listRepos).mockResolvedValue([repo({ name: "fresh" })]);
		await act(async () => {
			await hook.result.current.reload();
		});
		expect(hook.result.current.items[0]?.name).toBe("fresh");

		await act(async () => {
			releaseSlow([repo({ name: "stale" })]);
			await Promise.resolve();
		});
		expect(hook.result.current.items[0]?.name).toBe("fresh");
	});

	it("filters the visible list without touching items", async () => {
		vi.mocked(listRepos).mockResolvedValue([
			repo({ id: "r1", name: "api" }),
			repo({ id: "r2", name: "web", provider: "github", enabled: false }),
			repo({ id: "r3", name: "legacy", archivedAt: 9 }),
		]);
		const { result } = await mounted();
		expect(result.current.visible.map((r) => r.id)).toEqual(["r1", "r2"]);

		act(() => {
			result.current.setFilter((f) => ({ ...f, provider: "github" }));
		});
		expect(result.current.visible.map((r) => r.id)).toEqual(["r2"]);

		act(() => {
			result.current.setFilter((f) => ({
				...f,
				provider: null,
				enabled: true,
			}));
		});
		expect(result.current.visible.map((r) => r.id)).toEqual(["r1"]);

		act(() => {
			result.current.setFilter((f) => ({
				...f,
				enabled: null,
				status: "archived",
			}));
		});
		expect(result.current.visible.map((r) => r.id)).toEqual(["r3"]);
		expect(result.current.items).toHaveLength(3);
	});

	it("offers only the providers actually present, deduped and sorted", async () => {
		vi.mocked(listRepos).mockResolvedValue([
			repo({ id: "r1", provider: "github" }),
			repo({ id: "r2", provider: "ado" }),
			repo({ id: "r3", provider: "ado" }),
		]);
		const { result } = await mounted();
		expect(result.current.providers).toEqual(["ado", "github"]);
	});

	it("creates with trimmed fields and a blank project GUID as null", async () => {
		// "" would fail the server's string check; null is how it spells
		// "not backfilled yet".
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit(
				draft({
					org: "  contoso  ",
					project: " Widgets ",
					name: " api ",
					externalId: " repo-guid ",
					projectExternalId: "   ",
				}),
			);
		});
		expect(createRepo).toHaveBeenCalledWith({
			provider: "ado",
			org: "contoso",
			project: "Widgets",
			name: "api",
			externalId: "repo-guid",
			projectExternalId: null,
			enabled: true,
		});
		expect(listRepos).toHaveBeenCalledTimes(2);
	});

	it("carries a project GUID through when one was given", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit(draft({ projectExternalId: " proj-guid " }));
		});
		expect(vi.mocked(createRepo).mock.calls[0]?.[0].projectExternalId).toBe(
			"proj-guid",
		);
	});

	it("patches the row being edited", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setEditing(repo());
		});
		await act(async () => {
			await result.current.submit(draft({ enabled: false }));
		});
		expect(patchRepo).toHaveBeenCalledWith(
			"r1",
			expect.objectContaining({ enabled: false, name: "api" }),
		);
		expect(createRepo).not.toHaveBeenCalled();
	});

	it("a failed submit rejects so the dialog can stay open", async () => {
		vi.mocked(createRepo).mockRejectedValueOnce(new Error("guid conflict"));
		const { result } = await mounted();
		await act(async () => {
			await expect(result.current.submit(draft())).rejects.toThrow(
				"guid conflict",
			);
		});
	});

	it("archives then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("r1");
		});
		expect(archiveRepo).toHaveBeenCalledWith("r1");
		expect(listRepos).toHaveBeenCalledTimes(2);
	});

	it("restores then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.restore("r1");
		});
		expect(restoreRepo).toHaveBeenCalledWith("r1");
		expect(listRepos).toHaveBeenCalledTimes(2);
	});

	it("reports a mutation failure", async () => {
		vi.mocked(archiveRepo).mockRejectedValueOnce("boom");
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("r1");
		});
		expect(result.current.error).toBe("Request failed");
	});

	it("a second mutation while one is in flight is dropped", async () => {
		let release: () => void = () => {};
		vi.mocked(archiveRepo).mockReturnValueOnce(
			new Promise<void>((r) => {
				release = r;
			}),
		);
		const { result } = await mounted();

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.archive("r1");
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.archive("r1")).toBe(false);
		});
		expect(archiveRepo).toHaveBeenCalledTimes(1);

		await act(async () => {
			release();
			await first;
		});
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
			result.current.setEditing(repo());
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
});

describe("useRepoEditViewModel", () => {
	const mount = (
		r: Repo | null,
		onSubmit = vi.fn().mockResolvedValue(undefined),
		onDone = vi.fn(),
	) => ({
		...renderHook(({ r: cur }) => useRepoEditViewModel(cur, onSubmit, onDone), {
			initialProps: { r },
		}),
		onSubmit,
		onDone,
	});

	it("resets when a different repo is edited", () => {
		const { result, rerender } = mount(repo({ id: "r1", name: "api" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ r: repo({ id: "r2", name: "web" }) });
		expect(result.current.draft.name).toBe("web");
	});

	it("does not reset while editing the same repo", () => {
		const { result, rerender } = mount(repo({ id: "r1", name: "api" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ r: repo({ id: "r1", name: "api" }) });
		expect(result.current.draft.name).toBe("typed");
	});

	it("refuses an invalid draft", async () => {
		const { result, onSubmit } = mount(repo());
		act(() => {
			result.current.setField("org", "");
		});
		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(result.current.error).toMatch(/Org/);
	});

	it("submits and signals done", async () => {
		const { result, onSubmit, onDone } = mount(repo());
		await act(async () => {
			expect(await result.current.save()).toBe(true);
		});
		expect(onSubmit).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
	});

	it("stays open on failure", async () => {
		const onSubmit = vi.fn().mockRejectedValue(new Error("guid conflict"));
		const { result, onDone } = mount(repo(), onSubmit);
		await act(async () => {
			await result.current.save();
		});
		expect(onDone).not.toHaveBeenCalled();
		expect(result.current.error).toBe("guid conflict");
	});

	it("coerces a non-Error rejection", async () => {
		const onSubmit = vi.fn().mockRejectedValue("nope");
		const { result } = mount(repo(), onSubmit);
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
		const { result } = mount(repo(), onSubmit);

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
