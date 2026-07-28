import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tag } from "@/models/entities";
import {
	archiveTag,
	createTag,
	listTags,
	patchTag,
	restoreTag,
} from "@/models/entitiesApi";
import {
	DEFAULT_TAG_COLOR,
	tagDraftFrom,
	useTagEditViewModel,
	useTagsViewModel,
	validateTagDraft,
} from "./useTagsViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listTags: vi.fn(),
	createTag: vi.fn(),
	patchTag: vi.fn(),
	archiveTag: vi.fn(),
	restoreTag: vi.fn(),
}));

const tag = (over: Partial<Tag> = {}): Tag => ({
	id: "g1",
	name: "frontend",
	color: "#00A4EF",
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

beforeEach(() => {
	vi.mocked(listTags).mockReset().mockResolvedValue([tag()]);
	vi.mocked(createTag).mockReset().mockResolvedValue(tag());
	vi.mocked(patchTag).mockReset().mockResolvedValue(tag());
	vi.mocked(archiveTag).mockReset().mockResolvedValue(undefined);
	vi.mocked(restoreTag).mockReset().mockResolvedValue(undefined);
});

const mounted = async () => {
	const hook = renderHook(() => useTagsViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("tagDraftFrom / validateTagDraft", () => {
	it("maps a row and starts a new tag on the default colour", () => {
		expect(tagDraftFrom(tag({ name: "fe", color: "#123456" }))).toEqual({
			name: "fe",
			color: "#123456",
		});
		expect(tagDraftFrom(null)).toEqual({
			name: "",
			color: DEFAULT_TAG_COLOR,
		});
	});

	it("requires a name", () => {
		expect(validateTagDraft({ name: "  ", color: "#FFFFFF" })).toMatch(/Name/);
	});

	it("requires a six-digit hex colour", () => {
		// The server's normalizeColor accepts nothing else, so anything that
		// slips past here is a 400 the user meets only on save.
		expect(validateTagDraft({ name: "fe", color: "#FFF" })).toMatch(/hex/);
		expect(validateTagDraft({ name: "fe", color: "hsl(10 62% 49%)" })).toMatch(
			/hex/,
		);
		expect(validateTagDraft({ name: "fe", color: "#FFFFFF" })).toBeNull();
		expect(validateTagDraft({ name: "fe", color: " #ffffff " })).toBeNull();
	});
});

describe("useTagsViewModel", () => {
	it("loads on mount", async () => {
		const { result } = await mounted();
		expect(result.current.items).toHaveLength(1);
		expect(result.current.error).toBeNull();
	});

	it("fetches archived rows so status filtering needs no round trip", async () => {
		await mounted();
		expect(listTags).toHaveBeenCalledWith(true);
	});

	it("reports a load failure", async () => {
		vi.mocked(listTags).mockRejectedValueOnce(new Error("down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("down");
	});

	it("coerces a non-Error load rejection", async () => {
		vi.mocked(listTags).mockRejectedValueOnce("nope");
		const { result } = await mounted();
		expect(result.current.error).toBe("Load failed");
	});

	it("a slow first load cannot overwrite a newer one", async () => {
		let releaseSlow: (v: Tag[]) => void = () => {};
		vi.mocked(listTags).mockReturnValueOnce(
			new Promise<Tag[]>((r) => {
				releaseSlow = r;
			}),
		);
		const hook = renderHook(() => useTagsViewModel());

		vi.mocked(listTags).mockResolvedValue([tag({ name: "Fresh" })]);
		await act(async () => {
			await hook.result.current.reload();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");

		await act(async () => {
			releaseSlow([tag({ name: "Stale" })]);
			await Promise.resolve();
		});
		expect(hook.result.current.items[0]?.name).toBe("Fresh");
	});

	it("filters the visible list without touching items", async () => {
		vi.mocked(listTags).mockResolvedValue([
			tag({ id: "g1", name: "frontend" }),
			tag({ id: "g2", name: "legacy", archivedAt: 9 }),
		]);
		const { result } = await mounted();
		expect(result.current.visible.map((t) => t.id)).toEqual(["g1"]);
		act(() => {
			result.current.setFilter((f) => ({ ...f, status: "archived" }));
		});
		expect(result.current.visible.map((t) => t.id)).toEqual(["g2"]);
		act(() => {
			result.current.setFilter((f) => ({
				...f,
				status: "all",
				keyword: "front",
			}));
		});
		expect(result.current.visible.map((t) => t.id)).toEqual(["g1"]);
		expect(result.current.items).toHaveLength(2);
	});

	it("creates with a trimmed name and an upper-cased colour", async () => {
		// The server upper-cases on write; sending the same shape keeps a
		// just-created tag from appearing to change colour on the next reload.
		const { result } = await mounted();
		await act(async () => {
			await result.current.submit({ name: "  infra  ", color: "#00a4ef" });
		});
		expect(createTag).toHaveBeenCalledWith("infra", "#00A4EF");
		expect(listTags).toHaveBeenCalledTimes(2);
	});

	it("patches the row being edited", async () => {
		const { result } = await mounted();
		act(() => {
			result.current.setEditing(tag());
		});
		await act(async () => {
			await result.current.submit({ name: "backend", color: "#112233" });
		});
		expect(patchTag).toHaveBeenCalledWith("g1", {
			name: "backend",
			color: "#112233",
		});
		expect(createTag).not.toHaveBeenCalled();
	});

	it("a failed submit rejects so the dialog can stay open", async () => {
		vi.mocked(createTag).mockRejectedValueOnce(new Error("exists"));
		const { result } = await mounted();
		await act(async () => {
			await expect(
				result.current.submit({ name: "infra", color: "#FFFFFF" }),
			).rejects.toThrow("exists");
		});
	});

	it("archives then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("g1");
		});
		expect(archiveTag).toHaveBeenCalledWith("g1");
		expect(listTags).toHaveBeenCalledTimes(2);
	});

	it("restores then reloads", async () => {
		const { result } = await mounted();
		await act(async () => {
			await result.current.restore("g1");
		});
		expect(restoreTag).toHaveBeenCalledWith("g1");
		expect(listTags).toHaveBeenCalledTimes(2);
	});

	it("reports a mutation failure", async () => {
		vi.mocked(archiveTag).mockRejectedValueOnce("boom");
		const { result } = await mounted();
		await act(async () => {
			await result.current.archive("g1");
		});
		expect(result.current.error).toBe("Request failed");
	});

	it("a second mutation while one is in flight is dropped", async () => {
		let release: () => void = () => {};
		vi.mocked(archiveTag).mockReturnValueOnce(
			new Promise<void>((r) => {
				release = r;
			}),
		);
		const { result } = await mounted();

		let first: Promise<boolean> = Promise.resolve(false);
		act(() => {
			first = result.current.archive("g1");
		});
		await waitFor(() => expect(result.current.busy).toBe(true));

		await act(async () => {
			expect(await result.current.archive("g1")).toBe(false);
		});
		expect(archiveTag).toHaveBeenCalledTimes(1);

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
			result.current.setEditing(tag());
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

describe("useTagEditViewModel", () => {
	const mount = (
		t: Tag | null,
		onSubmit = vi.fn().mockResolvedValue(undefined),
		onDone = vi.fn(),
	) => ({
		...renderHook(({ t: cur }) => useTagEditViewModel(cur, onSubmit, onDone), {
			initialProps: { t },
		}),
		onSubmit,
		onDone,
	});

	it("resets when a different tag is edited", () => {
		const { result, rerender } = mount(tag({ id: "g1", name: "fe" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ t: tag({ id: "g2", name: "be" }) });
		expect(result.current.draft.name).toBe("be");
	});

	it("does not reset while editing the same tag", () => {
		const { result, rerender } = mount(tag({ id: "g1", name: "fe" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ t: tag({ id: "g1", name: "fe" }) });
		expect(result.current.draft.name).toBe("typed");
	});

	it("refuses an invalid draft", async () => {
		const { result, onSubmit } = mount(tag());
		act(() => {
			result.current.setField("name", "");
		});
		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(result.current.error).toMatch(/Name/);
	});

	it("submits and signals done", async () => {
		const { result, onSubmit, onDone } = mount(tag());
		await act(async () => {
			expect(await result.current.save()).toBe(true);
		});
		expect(onSubmit).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
	});

	it("stays open on failure", async () => {
		const onSubmit = vi.fn().mockRejectedValue(new Error("name taken"));
		const { result, onDone } = mount(tag(), onSubmit);
		await act(async () => {
			await result.current.save();
		});
		expect(onDone).not.toHaveBeenCalled();
		expect(result.current.error).toBe("name taken");
	});

	it("coerces a non-Error rejection", async () => {
		const onSubmit = vi.fn().mockRejectedValue("nope");
		const { result } = mount(tag(), onSubmit);
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
		const { result } = mount(tag(), onSubmit);

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
