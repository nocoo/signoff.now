import {
	type DataSource,
	type DirectoryData,
	identityKey,
} from "@signoff/domain/insights";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
	DEFAULT_DIRECTORY_FILTER,
	type DirectoryKind,
	writeDirectoryFilters,
} from "@/models/directory";
import {
	fetchDirectory,
	saveDirectoryEntity,
	setDirectoryArchived,
} from "@/models/directoryApi";
import { useDirectoryViewModel } from "./useDirectoryViewModel";

vi.mock("@/models/directoryApi", () => ({
	fetchDirectory: vi.fn(),
	saveDirectoryEntity: vi.fn(),
	setDirectoryArchived: vi.fn(),
}));

const linkedKey = identityKey("ado", "org", "ada");
const freeKey = identityKey("ado", "org", "guest");
const initial: DirectoryData = {
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
			identityKeys: [linkedKey],
			archivedAt: null,
		},
		{
			id: "archived",
			name: "Past Member",
			avatarUrl: null,
			teamIds: [],
			tagIds: [],
			identityKeys: [],
			archivedAt: 10,
		},
	],
	teams: [
		{
			id: "core",
			name: "Core",
			avatarUrl: null,
			memberIds: ["ada"],
			tagIds: ["web"],
			archivedAt: null,
		},
	],
	tags: [{ id: "web", name: "Web", color: "#336699", archivedAt: null }],
	identities: [
		{
			key: linkedKey,
			provider: "ado",
			organization: "org",
			actorId: "ada",
			name: "Ada",
			handle: "ada@example.com",
			avatarUrl: null,
			memberId: "ada",
			lastSeenAt: 10,
		},
		{
			key: freeKey,
			provider: "ado",
			organization: "org",
			actorId: "guest",
			name: "Guest",
			handle: "guest@example.com",
			avatarUrl: "https://example.com/g.png",
			memberId: null,
			lastSeenAt: 10,
		},
	],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	localStorage.clear();
	vi.mocked(fetchDirectory)
		.mockReset()
		.mockImplementation(async (source) => ({
			...structuredClone(initial),
			source,
		}));
	vi.mocked(saveDirectoryEntity)
		.mockReset()
		.mockResolvedValue({ id: "new-id" });
	vi.mocked(setDirectoryArchived).mockReset().mockResolvedValue();
});
afterEach(cleanup);

async function mount(kind: DirectoryKind = "members") {
	const mounted = renderHook(
		({ source, page }) => useDirectoryViewModel(source, page),
		{ initialProps: { source: "cli" as DataSource, page: kind } },
	);
	await waitFor(() => expect(mounted.result.current.loading).toBe(false));
	return mounted;
}

it("loads a source once, persists filters per source/page, and exposes exact directory results", async () => {
	const { result, rerender } = await mount();
	expect(fetchDirectory).toHaveBeenCalledTimes(1);
	expect(result.current.members.map((row) => row.id)).toEqual(["ada"]);
	expect(result.current.teams).toHaveLength(1);
	expect(result.current.tags).toHaveLength(1);
	expect(result.current.authors.map((row) => row.key)).toEqual([freeKey]);
	act(() =>
		result.current.setFilter({
			keyword: "Ada",
			teamId: "core",
			tagId: "web",
			status: "all",
			view: "discover",
		}),
	);
	expect(result.current.filter.keyword).toBe("Ada");
	writeDirectoryFilters("demo", "members", {
		...DEFAULT_DIRECTORY_FILTER,
		keyword: "Guest",
	});
	act(() => result.current.edit("ada"));
	rerender({ source: "demo", page: "members" });
	expect(result.current.editor).toBeNull();
	expect(result.current.data).toBeNull();
	expect(result.current.filter.keyword).toBe("Guest");
	await waitFor(() => expect(result.current.loading).toBe(false));
	rerender({ source: "cli", page: "members" });
	expect(result.current.filter.keyword).toBe("Ada");
	await waitFor(() => expect(result.current.loading).toBe(false));
	rerender({ source: "cli", page: "teams" });
	expect(result.current.filter).toEqual(DEFAULT_DIRECTORY_FILTER);
	await waitFor(() => expect(result.current.loading).toBe(false));
	act(() => result.current.setFilter({ keyword: "Core" }));
	act(() => result.current.resetFilter());
	expect(result.current.filter).toEqual(DEFAULT_DIRECTORY_FILTER);
});

it("ignores old-source success and errors even after switching back to that source", async () => {
	const first = deferred<DirectoryData>();
	const second = deferred<DirectoryData>();
	vi.mocked(fetchDirectory)
		.mockImplementationOnce(() => first.promise)
		.mockImplementationOnce(() => second.promise);
	const { result, rerender } = renderHook(
		({ source }) => useDirectoryViewModel(source, "members"),
		{ initialProps: { source: "cli" as DataSource } },
	);
	rerender({ source: "demo" });
	rerender({ source: "cli" });
	await waitFor(() => expect(result.current.loading).toBe(false));
	await act(async () => {
		first.resolve({ ...initial, members: [] });
		second.reject(new Error("old sample error"));
	});
	expect(result.current.data?.members).toHaveLength(2);
	expect(result.current.error).toBeNull();
});

it("keeps the newest reload and last good directory after a failed reload", async () => {
	const { result } = await mount();
	const old = deferred<DirectoryData>();
	vi.mocked(fetchDirectory).mockImplementationOnce(() => old.promise);
	let earlier!: Promise<boolean>;
	act(() => {
		earlier = result.current.reload();
	});
	await act(async () => {
		await result.current.reload();
	});
	await act(async () => {
		old.resolve({ ...initial, members: [] });
		await earlier;
	});
	expect(result.current.members).toHaveLength(1);
	vi.mocked(fetchDirectory).mockRejectedValueOnce("failed");
	await act(async () => {
		expect(await result.current.reload()).toBe(false);
	});
	expect(result.current.error).toBe("Could not load directory");
	expect(result.current.members).toHaveLength(1);
	vi.mocked(fetchDirectory).mockRejectedValueOnce(new Error("Offline"));
	await act(async () => {
		await result.current.reload();
	});
	expect(result.current.error).toBe("Offline");
});

it("edits complete member drafts, validates before writing, and clears a closed draft", async () => {
	const { result } = await mount();
	act(() => result.current.updateDraft({ name: "ignored" }));
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	act(() => result.current.edit("missing"));
	expect(result.current.editor).toBeNull();
	act(() => result.current.edit("ada"));
	act(() => result.current.updateDraft({ name: " " }));
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	expect(result.current.formError).toBeTruthy();
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	act(() =>
		result.current.updateDraft({ name: " Ada Updated ", avatarUrl: null }),
	);
	expect(result.current.formError).toBeNull();
	await act(async () => {
		expect(await result.current.save()).toBe(true);
	});
	expect(saveDirectoryEntity).toHaveBeenCalledWith(
		"cli",
		"members",
		"ada",
		{
			name: "Ada Updated",
			avatarUrl: null,
			teamIds: ["core"],
			tagIds: ["web"],
			identityKeys: [linkedKey],
		},
		42,
	);
	expect(result.current.editor).toBeNull();
	act(() => result.current.edit());
	act(() => result.current.closeEditor());
	expect(result.current.editor).toBeNull();
});

it("follows an exact discovered author or links that account to an existing member", async () => {
	const { result } = await mount();
	act(() => result.current.follow("missing"));
	expect(result.current.editor).toBeNull();
	act(() => result.current.follow(linkedKey));
	expect(result.current.editor).toBeNull();
	act(() => result.current.follow(freeKey));
	expect(result.current.editor).toMatchObject({
		kind: "members",
		id: null,
		followKey: freeKey,
		draft: {
			name: "Guest",
			avatarUrl: "https://example.com/g.png",
			identityKeys: [freeKey],
			teamIds: [],
		},
	});
	act(() => result.current.chooseFollowMember("missing"));
	act(() => result.current.chooseFollowMember("archived"));
	expect(result.current.editor?.id).toBeNull();
	act(() => result.current.chooseFollowMember("ada"));
	expect(result.current.editor).toMatchObject({
		id: "ada",
		draft: { identityKeys: [linkedKey, freeKey], teamIds: ["core"] },
	});
	act(() => result.current.chooseFollowMember("ada"));
	if (result.current.editor?.kind === "members")
		expect(result.current.editor.draft.identityKeys).toHaveLength(2);
	act(() => result.current.chooseFollowMember(null));
	expect(result.current.editor).toMatchObject({
		id: null,
		draft: { name: "Guest", identityKeys: [freeKey] },
	});
	await act(async () => {
		expect(await result.current.save()).toBe(true);
	});
	expect(saveDirectoryEntity).toHaveBeenCalledWith(
		"cli",
		"members",
		null,
		{
			name: "Guest",
			avatarUrl: "https://example.com/g.png",
			identityKeys: [freeKey],
			teamIds: [],
			tagIds: [],
		},
		42,
	);
});

it("blocks assigning an account already owned by another member or removed from the directory", async () => {
	const { result } = await mount();
	act(() => result.current.chooseFollowMember("ada"));
	act(() => result.current.edit());
	act(() =>
		result.current.updateDraft({
			name: "Another Ada",
			identityKeys: [linkedKey],
		}),
	);
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	expect(result.current.formError).toContain("already linked");
	act(() =>
		result.current.updateDraft({
			identityKeys: [identityKey("ado", "org", "gone")],
		}),
	);
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	expect(result.current.formError).toContain("no longer available");
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("prevents duplicate saves, changing editors, and closing during an in-flight write", async () => {
	const { result } = await mount();
	const write = deferred<{ id: string }>();
	vi.mocked(saveDirectoryEntity).mockReturnValueOnce(write.promise);
	act(() => result.current.edit("ada"));
	let pending!: Promise<boolean>;
	await act(async () => {
		pending = result.current.save();
		expect(await result.current.save()).toBe(false);
		result.current.closeEditor();
		result.current.edit();
		result.current.follow(freeKey);
		result.current.chooseFollowMember(null);
		result.current.updateDraft({ name: "Changed during save" });
		expect(await result.current.setArchived("ada", true)).toBe(false);
	});
	expect(result.current.busy).toBe(true);
	expect(result.current.editor).toMatchObject({
		id: "ada",
		draft: { name: "Ada Lovelace" },
	});
	expect(saveDirectoryEntity).toHaveBeenCalledTimes(1);
	await act(async () => {
		write.resolve({ id: "ada" });
		await pending;
	});
	expect(result.current.busy).toBe(false);
});

it("keeps drafts on write errors but closes a successful create even when its reload fails", async () => {
	const { result } = await mount();
	act(() => result.current.edit());
	act(() => result.current.updateDraft({ name: "New member" }));
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce(
		new Error("Name is taken"),
	);
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	expect(result.current.formError).toBe("Name is taken");
	expect(result.current.editor?.draft.name).toBe("New member");
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce("failed");
	await act(async () => {
		await result.current.save();
	});
	expect(result.current.formError).toBe("Could not save changes");
	vi.mocked(fetchDirectory).mockRejectedValueOnce(new Error("Read offline"));
	await act(async () => {
		expect(await result.current.save()).toBe(true);
	});
	expect(result.current.editor).toBeNull();
	expect(result.current.error).toBe("Read offline");
	expect(result.current.busy).toBe(false);
});

it("does not let an old mutation update the new source or unlock a new-source save", async () => {
	const { result, rerender } = await mount();
	const old = deferred<{ id: string }>();
	const current = deferred<{ id: string }>();
	vi.mocked(saveDirectoryEntity)
		.mockReturnValueOnce(old.promise)
		.mockReturnValueOnce(current.promise);
	act(() => result.current.edit("ada"));
	let oldSave!: Promise<boolean>;
	act(() => {
		oldSave = result.current.save();
	});
	rerender({ source: "demo", page: "members" });
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.busy).toBe(false);
	act(() => result.current.edit("ada"));
	let currentSave!: Promise<boolean>;
	act(() => {
		currentSave = result.current.save();
	});
	await act(async () => {
		old.reject(new Error("old failure"));
		expect(await oldSave).toBe(false);
	});
	expect(result.current.busy).toBe(true);
	expect(result.current.formError).toBeNull();
	expect(result.current.editor?.id).toBe("ada");
	await act(async () => {
		current.resolve({ id: "ada" });
		await currentSave;
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"demo",
		"members",
		"ada",
		expect.any(Object),
		42,
	);
	expect(result.current.editor).toBeNull();
});

it("archives/restores selected rows, reporting errors and rejecting stale IDs", async () => {
	const { result } = await mount();
	await act(async () => {
		expect(await result.current.setArchived("missing", true)).toBe(false);
	});
	await act(async () => {
		expect(await result.current.setArchived("ada", true)).toBe(true);
	});
	expect(setDirectoryArchived).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"ada",
		true,
		42,
	);
	await act(async () => {
		expect(await result.current.setArchived("archived", false)).toBe(true);
	});
	expect(setDirectoryArchived).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"archived",
		false,
		42,
	);
	vi.mocked(setDirectoryArchived).mockRejectedValueOnce(
		new Error("Cannot archive"),
	);
	await act(async () => {
		expect(await result.current.setArchived("ada", true)).toBe(false);
	});
	expect(result.current.error).toBe("Cannot archive");
	vi.mocked(setDirectoryArchived).mockRejectedValueOnce(null);
	await act(async () => {
		await result.current.setArchived("ada", true);
	});
	expect(result.current.error).toBe("Could not save changes");
});

it("submits team memberships and tag colors through their matching contracts", async () => {
	const { result, rerender } = await mount("teams");
	act(() => result.current.edit("core"));
	act(() => result.current.chooseFollowMember("ada"));
	act(() => result.current.updateDraft({ memberIds: [], name: "Core edited" }));
	await act(async () => {
		await result.current.save();
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"cli",
		"teams",
		"core",
		{
			name: "Core edited",
			avatarUrl: null,
			memberIds: [],
			tagIds: ["web"],
		},
		42,
	);
	rerender({ source: "cli", page: "tags" });
	await waitFor(() => expect(result.current.loading).toBe(false));
	act(() => result.current.edit());
	act(() =>
		result.current.updateDraft({ name: "Front end", color: "#aabbcc" }),
	);
	await act(async () => {
		await result.current.save();
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"cli",
		"tags",
		null,
		{
			name: "Front end",
			color: "#AABBCC",
		},
		42,
	);
});

it("does not publish or reload after unmounting an in-flight save", async () => {
	const { result, unmount } = await mount();
	const write = deferred<{ id: string }>();
	vi.mocked(saveDirectoryEntity).mockReturnValueOnce(write.promise);
	act(() => result.current.edit("ada"));
	let pending!: Promise<boolean>;
	act(() => {
		pending = result.current.save();
	});
	unmount();
	await act(async () => {
		write.resolve({ id: "ada" });
		expect(await pending).toBe(false);
	});
	expect(fetchDirectory).toHaveBeenCalledTimes(1);
});

it("keeps the editor's original revision after reload and preserves its draft on conflict", async () => {
	const { result } = await mount();
	act(() => result.current.edit("ada"));
	act(() => result.current.updateDraft({ name: "My unsaved name" }));
	vi.mocked(fetchDirectory).mockResolvedValueOnce({ ...initial, revision: 43 });
	await act(async () => {
		await result.current.reload();
	});
	expect(result.current.data?.revision).toBe(43);
	expect(result.current.editor?.revision).toBe(42);
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce(
		new ApiError("Directory version conflict", 409),
	);
	await act(async () => {
		expect(await result.current.save()).toBe(false);
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"ada",
		expect.objectContaining({ name: "My unsaved name" }),
		42,
	);
	expect(result.current.editor).toMatchObject({
		revision: 42,
		draft: { name: "My unsaved name" },
	});
	expect(result.current.formError).toContain("Directory version conflict");
	expect(result.current.formError).toMatch(/draft.*kept/i);
	expect(result.current.formError).toMatch(/reload.*reopen/i);
	expect(result.current.busy).toBe(false);
	act(() => result.current.closeEditor());
	act(() => result.current.edit("ada"));
	expect(result.current.editor?.revision).toBe(43);
});

it("keeps the initial follow revision when choosing an existing member or returning to new member", async () => {
	const { result } = await mount();
	act(() => result.current.follow(freeKey));
	expect(result.current.editor?.revision).toBe(42);
	vi.mocked(fetchDirectory).mockResolvedValueOnce({ ...initial, revision: 43 });
	await act(async () => {
		await result.current.reload();
	});
	act(() => result.current.chooseFollowMember("ada"));
	expect(result.current.editor).toMatchObject({ id: "ada", revision: 42 });
	act(() => result.current.chooseFollowMember(null));
	expect(result.current.editor).toMatchObject({ id: null, revision: 42 });
	await act(async () => {
		await result.current.save();
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"cli",
		"members",
		null,
		expect.objectContaining({ identityKeys: [freeKey] }),
		42,
	);
});

it("archives the displayed revision, surfaces a conflict, and uses a newer version only after reload", async () => {
	const { result } = await mount();
	vi.mocked(setDirectoryArchived).mockRejectedValueOnce(
		new ApiError("Directory version conflict", 409),
	);
	await act(async () => {
		expect(await result.current.setArchived("ada", true)).toBe(false);
	});
	expect(setDirectoryArchived).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"ada",
		true,
		42,
	);
	expect(result.current.error).toMatch(/reload/i);
	vi.mocked(fetchDirectory).mockResolvedValueOnce({ ...initial, revision: 43 });
	await act(async () => {
		await result.current.reload();
	});
	await act(async () => {
		await result.current.setArchived("ada", true);
	});
	expect(setDirectoryArchived).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"ada",
		true,
		43,
	);
});

it.each([
	{ operation: "archive", readFirst: false },
	{ operation: "archive", readFirst: true },
	{ operation: "save", readFirst: false },
	{ operation: "save", readFirst: true },
] as const)("releases a superseded reload after a rejected $operation (read first: $readFirst)", async ({
	operation,
	readFirst,
}) => {
	const { result } = await mount();
	if (operation === "save") act(() => result.current.edit("ada"));
	const read = deferred<DirectoryData>();
	const write = deferred<never>();
	vi.mocked(fetchDirectory).mockReturnValueOnce(read.promise);
	const writeApi =
		operation === "save" ? saveDirectoryEntity : setDirectoryArchived;
	vi.mocked(writeApi).mockReturnValueOnce(write.promise);
	let reloading!: Promise<boolean>;
	let mutating!: Promise<boolean>;
	act(() => {
		reloading = result.current.reload();
	});
	expect(result.current.refreshing).toBe(true);
	act(() => {
		mutating =
			operation === "save"
				? result.current.save()
				: result.current.setArchived("ada", true);
	});
	if (readFirst) {
		await act(async () => {
			read.resolve({ ...initial, members: [] });
			expect(await reloading).toBe(false);
		});
	}
	await act(async () => {
		write.reject(new Error("Write rejected"));
		expect(await mutating).toBe(false);
	});
	if (!readFirst) {
		await act(async () => {
			read.resolve({ ...initial, members: [] });
			expect(await reloading).toBe(false);
		});
	}
	expect(result.current.refreshing).toBe(false);
	expect(result.current.busy).toBe(false);
	expect(result.current.members.map((member) => member.id)).toEqual(["ada"]);
	expect(
		operation === "save" ? result.current.formError : result.current.error,
	).toBe("Write rejected");
	if (operation === "save")
		expect(result.current.editor).toMatchObject({ id: "ada", revision: 42 });
	await act(async () => {
		expect(await result.current.reload()).toBe(true);
	});
	expect(result.current.refreshing).toBe(false);
});

it("keeps a newer read refreshing when an earlier archive fails", async () => {
	const { result } = await mount();
	const obsolete = deferred<DirectoryData>();
	const latest = deferred<DirectoryData>();
	const write = deferred<never>();
	vi.mocked(fetchDirectory)
		.mockReturnValueOnce(obsolete.promise)
		.mockReturnValueOnce(latest.promise);
	vi.mocked(setDirectoryArchived).mockReturnValueOnce(write.promise);
	let oldRead!: Promise<boolean>;
	let newRead!: Promise<boolean>;
	let archiving!: Promise<boolean>;
	act(() => {
		oldRead = result.current.reload();
	});
	act(() => {
		archiving = result.current.setArchived("ada", true);
	});
	act(() => {
		newRead = result.current.reload();
	});
	await act(async () => {
		write.reject(new Error("Archive rejected"));
		await archiving;
	});
	await act(async () => {
		obsolete.reject(new Error("Old read rejected"));
		expect(await oldRead).toBe(false);
	});
	expect(result.current.busy).toBe(false);
	expect(result.current.refreshing).toBe(true);
	await act(async () => {
		latest.resolve({ ...initial, revision: 43 });
		expect(await newRead).toBe(true);
	});
	expect(result.current.data?.revision).toBe(43);
	expect(result.current.refreshing).toBe(false);
});

it("waits for a successful save's follow-up read without letting an obsolete read unlock it", async () => {
	const { result } = await mount();
	act(() => result.current.edit("ada"));
	const obsolete = deferred<DirectoryData>();
	const latest = deferred<DirectoryData>();
	const write = deferred<{ id: string }>();
	vi.mocked(fetchDirectory)
		.mockReturnValueOnce(obsolete.promise)
		.mockReturnValueOnce(latest.promise);
	vi.mocked(saveDirectoryEntity).mockReturnValueOnce(write.promise);
	let oldRead!: Promise<boolean>;
	let saving!: Promise<boolean>;
	act(() => {
		oldRead = result.current.reload();
	});
	act(() => {
		saving = result.current.save();
	});
	await act(async () => {
		write.resolve({ id: "ada" });
	});
	expect(result.current.editor).toBeNull();
	expect(result.current.busy).toBe(true);
	expect(result.current.refreshing).toBe(true);
	await act(async () => {
		obsolete.resolve({ ...initial, members: [] });
		expect(await oldRead).toBe(false);
	});
	expect(result.current.refreshing).toBe(true);
	expect(result.current.busy).toBe(true);
	await act(async () => {
		latest.resolve({ ...initial, revision: 43 });
		expect(await saving).toBe(true);
	});
	expect(result.current.busy).toBe(false);
	expect(result.current.refreshing).toBe(false);
	expect(result.current.data?.revision).toBe(43);
});

it("does not clear a new source's loading state when an old read and archive fail", async () => {
	const { result, rerender } = await mount();
	const old = deferred<DirectoryData>();
	const sample = deferred<DirectoryData>();
	const write = deferred<never>();
	vi.mocked(fetchDirectory)
		.mockReturnValueOnce(old.promise)
		.mockReturnValueOnce(sample.promise);
	vi.mocked(setDirectoryArchived).mockReturnValueOnce(write.promise);
	let reloading!: Promise<boolean>;
	let archiving!: Promise<boolean>;
	act(() => {
		reloading = result.current.reload();
	});
	act(() => {
		archiving = result.current.setArchived("ada", true);
	});
	rerender({ source: "demo", page: "members" });
	await act(async () => {
		write.reject(new Error("Old archive rejected"));
		await archiving;
	});
	await act(async () => {
		old.reject(new Error("Old read rejected"));
		await reloading;
	});
	expect(result.current.busy).toBe(false);
	expect(result.current.loading).toBe(true);
	expect(result.current.refreshing).toBe(true);
	expect(result.current.error).toBeNull();
	await act(async () => {
		sample.resolve({ ...initial, source: "demo", revision: 50 });
	});
	expect(result.current.data?.source).toBe("demo");
	expect(result.current.data?.revision).toBe(50);
	expect(result.current.refreshing).toBe(false);
});
