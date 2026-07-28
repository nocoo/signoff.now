import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Developer } from "@/models/entities";
import {
	draftFrom,
	useDeveloperEditViewModel,
	validateDraft,
} from "./useDeveloperEditViewModel";

const dev = (over: Partial<Developer> = {}): Developer => ({
	id: "d1",
	name: "Ada",
	alias: "ada",
	avatarUrl: null,
	teamIds: [],
	tagIds: [],
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
	...over,
});

describe("draftFrom", () => {
	it("maps a row onto editable text", () => {
		expect(
			draftFrom(dev({ avatarUrl: "https://x/a.png", teamIds: ["t1"] })),
		).toEqual({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
			teamIds: ["t1"],
			tagIds: [],
		});
	});

	it("renders a null avatar as an empty input, not the string 'null'", () => {
		expect(draftFrom(dev()).avatarUrl).toBe("");
	});

	it("gives an empty draft for no row", () => {
		expect(draftFrom(null)).toEqual({
			name: "",
			alias: "",
			avatarUrl: "",
			teamIds: [],
			tagIds: [],
		});
	});
});

describe("validateDraft", () => {
	const draft = (over: Partial<ReturnType<typeof draftFrom>> = {}) => ({
		name: "Ada",
		alias: "ada",
		avatarUrl: "",
		teamIds: [],
		tagIds: [],
		...over,
	});

	it("passes a good draft", () => {
		expect(validateDraft(draft())).toBeNull();
	});

	it("reports identity problems before the avatar", () => {
		// Both wrong: the name is what the user must fix first, and reporting
		// the avatar would send them to the wrong field.
		expect(validateDraft(draft({ name: "", avatarUrl: "nope" }))).toMatch(
			/Name/,
		);
	});

	it("catches a bad avatar when identity is fine", () => {
		expect(validateDraft(draft({ avatarUrl: "javascript:alert(1)" }))).toMatch(
			/http/,
		);
	});
});

describe("useDeveloperEditViewModel", () => {
	const mount = (
		developer: Developer | null,
		onSubmit = vi.fn().mockResolvedValue(undefined),
		onDone = vi.fn(),
	) => ({
		...renderHook(({ d }) => useDeveloperEditViewModel(d, onSubmit, onDone), {
			initialProps: { d: developer },
		}),
		onSubmit,
		onDone,
	});

	it("starts from the row", () => {
		const { result } = mount(dev({ name: "Grace" }));
		expect(result.current.draft.name).toBe("Grace");
	});

	it("resets when a different row is edited", () => {
		const { result, rerender } = mount(dev({ id: "d1", name: "Ada" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ d: dev({ id: "d2", name: "Grace" }) });
		expect(result.current.draft.name).toBe("Grace");
	});

	it("does NOT reset while editing the same row", () => {
		// A parent re-render hands down a new object for the same person;
		// wiping the field would delete what they are typing.
		const { result, rerender } = mount(dev({ id: "d1", name: "Ada" }));
		act(() => {
			result.current.setField("name", "typed");
		});
		rerender({ d: dev({ id: "d1", name: "Ada" }) });
		expect(result.current.draft.name).toBe("typed");
	});

	it("toggles a team on and off", () => {
		const { result } = mount(dev());
		act(() => {
			result.current.toggleTeam("t1");
		});
		expect(result.current.draft.teamIds).toEqual(["t1"]);
		act(() => {
			result.current.toggleTeam("t1");
		});
		expect(result.current.draft.teamIds).toEqual([]);
	});

	it("toggles a tag on and off", () => {
		const { result } = mount(dev());
		act(() => {
			result.current.toggleTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual(["g1"]);
		act(() => {
			result.current.toggleTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual([]);
	});

	it("tags and teams do not interfere", () => {
		// Both live on the same draft; a shared toggle that ignored the key
		// would move ids between the two lists.
		const { result } = mount(dev());
		act(() => {
			result.current.toggleTeam("t1");
			result.current.toggleTag("g1");
		});
		expect(result.current.draft.teamIds).toEqual(["t1"]);
		expect(result.current.draft.tagIds).toEqual(["g1"]);
	});

	it("selectTag keeps an already-selected tag selected", () => {
		// Reusing toggleTag here would DESELECT a tag that was already on —
		// exactly what happens when someone types the name of a tag they had
		// already ticked. Two calls must not cancel out.
		const { result } = mount(dev());
		act(() => {
			result.current.toggleTag("g1");
		});
		act(() => {
			result.current.selectTag("g1");
		});
		expect(result.current.draft.tagIds).toEqual(["g1"]);
	});

	it("carries existing tags into the draft", () => {
		const { result } = mount(dev({ tagIds: ["g1", "g2"] }));
		expect(result.current.draft.tagIds).toEqual(["g1", "g2"]);
	});

	it("refuses to submit an invalid draft", async () => {
		const { result, onSubmit } = mount(dev());
		act(() => {
			result.current.setField("alias", "has@at");
		});
		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(result.current.error).toMatch(/Alias/);
	});

	it("submits and signals done", async () => {
		const { result, onSubmit, onDone } = mount(dev());
		await act(async () => {
			expect(await result.current.save()).toBe(true);
		});
		expect(onSubmit).toHaveBeenCalledWith(result.current.draft);
		expect(onDone).toHaveBeenCalled();
	});

	it("stays open and explains itself when the save fails", async () => {
		// Closing would throw away the edits along with the reason.
		const onSubmit = vi.fn().mockRejectedValue(new Error("alias taken"));
		const { result, onDone } = mount(dev(), onSubmit);
		await act(async () => {
			expect(await result.current.save()).toBe(false);
		});
		expect(onDone).not.toHaveBeenCalled();
		expect(result.current.error).toBe("alias taken");
	});

	it("coerces a non-Error rejection", async () => {
		const onSubmit = vi.fn().mockRejectedValue("nope");
		const { result } = mount(dev(), onSubmit);
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
		const { result } = mount(dev(), onSubmit);

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

	it("clears busy and error when switching rows mid-edit", async () => {
		const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
		const { result, rerender } = mount(dev({ id: "d1" }), onSubmit);
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).toBe("boom");

		rerender({ d: dev({ id: "d2", name: "Grace" }) });
		expect(result.current.error).toBeNull();
		expect(result.current.busy).toBe(false);
	});
});
