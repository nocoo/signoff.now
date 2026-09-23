import type { DataSource, DirectoryData } from "@signoff/domain/insights";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { fetchDirectory, saveDirectoryEntity } from "@/models/directoryApi";
import { useTeamMembers } from "./useTeamMembers";

vi.mock("@/models/directoryApi", () => ({
	fetchDirectory: vi.fn(),
	saveDirectoryEntity: vi.fn(),
}));
function directory(): DirectoryData {
	return {
		source: "cli",
		revision: 8,
		projects: [],
		repositories: [],
		identities: [],
		tags: [],
		blockedContributorKeys: [],
		members: ["ada", "grace", "alan"].map((id) => ({
			id,
			name: id,
			avatarUrl: null,
			teamIds: ["other"],
			tagIds: [],
			identityKeys: [],
			archivedAt: null,
		})),
		teams: [
			{
				id: "core",
				name: "Latest team name",
				avatarUrl: "https://example.com/team.png",
				memberIds: ["ada"],
				tagIds: ["tag"],
				archivedAt: null,
			},
		],
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.mocked(fetchDirectory).mockReset().mockResolvedValue(directory());
	vi.mocked(saveDirectoryEntity).mockReset().mockResolvedValue({ id: "core" });
});
afterEach(cleanup);

it("adds several members using the latest team and revision without duplicating members or editing other teams", async () => {
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace", "ada", "grace", "alan"]));
	expect(result.current.selected).toEqual(["grace", "ada", "alan"]);
	await act(async () => {
		expect(await result.current.add()).toBe(true);
	});
	expect(fetchDirectory).toHaveBeenCalledWith("cli");
	expect(saveDirectoryEntity).toHaveBeenCalledExactlyOnceWith(
		"cli",
		"teams",
		"core",
		{
			name: "Latest team name",
			avatarUrl: "https://example.com/team.png",
			memberIds: ["ada", "alan", "grace"],
			tagIds: ["tag"],
		},
		8,
	);
});

it("avoids empty submissions and a write when all selected members were already added", async () => {
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(fetchDirectory).not.toHaveBeenCalled();
	act(() => result.current.select(["ada"]));
	await act(async () => {
		expect(await result.current.add()).toBe(true);
	});
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	expect(result.current.busy).toBe(false);
});

it("serializes double submissions and keeps selection locked during a write", async () => {
	const read = deferred<DirectoryData>();
	vi.mocked(fetchDirectory).mockReturnValue(read.promise);
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace"]));
	let pending!: Promise<boolean>;
	act(() => {
		pending = result.current.add();
	});
	expect(result.current.busy).toBe(true);
	act(() => result.current.select(["alan"]));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(result.current.selected).toEqual(["grace"]);
	await act(async () => {
		read.resolve(directory());
		await pending;
	});
	expect(saveDirectoryEntity).toHaveBeenCalledTimes(1);
});

it.each([
	"missing team",
	"archived team",
	"missing member",
	"archived member",
	"hidden member",
])("rejects %s from the fresh directory and preserves selection", async (kind) => {
	const data = directory();
	if (kind === "missing team") data.teams = [];
	if (kind === "archived team") data.teams[0].archivedAt = 1;
	if (kind === "missing member") data.members = [];
	if (kind === "archived member") data.members[1].archivedAt = 1;
	if (kind === "hidden member") data.blockedContributorKeys = ["member:grace"];
	vi.mocked(fetchDirectory).mockResolvedValue(data);
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace"]));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(result.current.error).toContain("no longer available");
	expect(result.current.selected).toEqual(["grace"]);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it.each([
	new Error("Offline"),
	new ApiError("Forbidden", 403),
	"failure",
])("retains selection after read errors", async (error) => {
	vi.mocked(fetchDirectory).mockRejectedValue(error);
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace"]));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(result.current.error).toBe(
		error instanceof Error ? error.message : "Could not add team members.",
	);
	expect(result.current.selected).toEqual(["grace"]);
	expect(result.current.busy).toBe(false);
	act(() => result.current.select(["alan"]));
	expect(result.current.error).toBeNull();
});

it("retains selection after a conflict and rebases the next attempt on fresh membership", async () => {
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce(
		new ApiError("Changed", 409),
	);
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace"]));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(result.current.error).toContain("Your selection is kept");
	const latest = directory();
	latest.revision = 9;
	latest.teams[0].memberIds.push("alan");
	vi.mocked(fetchDirectory).mockResolvedValue(latest);
	await act(async () => {
		expect(await result.current.add()).toBe(true);
	});
	expect(saveDirectoryEntity).toHaveBeenLastCalledWith(
		"cli",
		"teams",
		"core",
		expect.objectContaining({ memberIds: ["ada", "alan", "grace"] }),
		9,
	);
	expect(result.current.error).toBeNull();
});

it("validates the maximum team size before writing", async () => {
	const data = directory();
	data.teams[0].memberIds = Array.from({ length: 64 }, (_, i) => `member-${i}`);
	vi.mocked(fetchDirectory).mockResolvedValue(data);
	const { result } = renderHook(() => useTeamMembers("cli", "core"));
	act(() => result.current.select(["grace"]));
	await act(async () => {
		expect(await result.current.add()).toBe(false);
	});
	expect(result.current.error).toContain("64");
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("ignores old callbacks and late directory reads after changing source or team", async () => {
	const read = deferred<DirectoryData>();
	vi.mocked(fetchDirectory).mockReturnValue(read.promise);
	const { result, rerender } = renderHook(
		({ source, id }) => useTeamMembers(source, id),
		{ initialProps: { source: "cli" as DataSource, id: "core" } },
	);
	act(() => result.current.select(["grace"]));
	const stale = result.current;
	let pending!: Promise<boolean>;
	act(() => {
		pending = stale.add();
	});
	rerender({ source: "demo", id: "core" });
	rerender({ source: "cli", id: "other" });
	expect(result.current.selected).toEqual([]);
	act(() => stale.select(["alan"]));
	await act(async () => {
		expect(await stale.add()).toBe(false);
		read.resolve(directory());
		expect(await pending).toBe(false);
	});
	expect(result.current.selected).toEqual([]);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("does not write after unmount, or report success for a write that finishes after unmount", async () => {
	const read = deferred<DirectoryData>();
	vi.mocked(fetchDirectory).mockReturnValueOnce(read.promise);
	const first = renderHook(() => useTeamMembers("cli", "core"));
	act(() => first.result.current.select(["grace"]));
	let pending!: Promise<boolean>;
	act(() => {
		pending = first.result.current.add();
	});
	first.unmount();
	await act(async () => {
		read.resolve(directory());
		expect(await pending).toBe(false);
	});
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	const write = deferred<{ id: string }>();
	vi.mocked(saveDirectoryEntity).mockReturnValue(write.promise);
	const second = renderHook(() => useTeamMembers("cli", "core"));
	act(() => second.result.current.select(["grace"]));
	await act(async () => {
		pending = second.result.current.add();
	});
	second.unmount();
	await act(async () => {
		write.resolve({ id: "core" });
		expect(await pending).toBe(false);
	});
});
