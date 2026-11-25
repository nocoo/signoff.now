// @vitest-environment happy-dom
import { type DirectoryData, identityKey } from "@signoff/domain/insights";
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setContributorFollowed } from "@/models/contributorActions";
import { fetchDirectory } from "@/models/directoryApi";
import { fixtureProject, fixturePull } from "@/test/monitoring-fixture";
import { awaitReactAct } from "@/test/reactAct";
import { useFollowAuthor } from "./useFollowAuthor";

vi.mock("@/models/directoryApi", () => ({
	fetchDirectory: vi.fn(),
}));

vi.mock("@/models/contributorActions", () => ({
	setContributorFollowed: vi.fn(),
}));

const key = identityKey(
	fixtureProject.provider,
	fixtureProject.organization,
	fixturePull.author.id,
);

const directory: DirectoryData = {
	source: "cli",
	blockedContributorKeys: [],
	revision: 42,
	projects: [],
	repositories: [],
	members: [],
	teams: [],
	tags: [],
	identities: [
		{
			key,
			provider: fixtureProject.provider,
			organization: fixtureProject.organization,
			actorId: fixturePull.author.id,
			name: fixturePull.author.name,
			handle: null,
			avatarUrl: null,
			lastSeenAt: 10,
			memberId: null,
		},
	],
};

function linked(archivedAt: number | null = null): DirectoryData {
	return {
		...directory,
		identities: [{ ...directory.identities[0], memberId: "member-1" }],
		members: [
			{
				id: "member-1",
				name: "Existing member",
				avatarUrl: null,
				identityKeys: [key],
				teamIds: ["team-1"],
				tagIds: ["tag-1"],
				archivedAt,
			},
		],
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

it("stays idle and ignores reload/follow when identityKey is null", async () => {
	const { result } = renderHook(() => useFollowAuthor("cli", null));

	expect(result.current.loading).toBe(false);
	expect(result.current.available).toBe(false);
	expect(result.current.followed).toBe(false);
	expect(result.current.archived).toBe(false);

	await awaitReactAct(async () => {
		await result.current.reload();
		await result.current.follow();
	});

	expect(fetchDirectory).not.toHaveBeenCalled();
	expect(setContributorFollowed).not.toHaveBeenCalled();
});

it("loads directory, resets session on identityKey change, and reflects active vs archived members", async () => {
	vi.mocked(fetchDirectory)
		.mockResolvedValueOnce(directory)
		.mockResolvedValueOnce(linked(null))
		.mockResolvedValueOnce(linked(100));

	const { result, rerender } = renderHook(
		({ id }) => useFollowAuthor("cli", id),
		{ initialProps: { id: key as string } },
	);

	await awaitReactAct(async () => {});
	expect(result.current.loading).toBe(false);
	expect(result.current.available).toBe(true);
	expect(result.current.followed).toBe(false);
	expect(result.current.archived).toBe(false);

	rerender({ id: key });
	await awaitReactAct(async () => {
		await result.current.reload();
	});
	expect(result.current.followed).toBe(true);
	expect(result.current.archived).toBe(false);

	await awaitReactAct(async () => {
		await result.current.follow();
	});
	expect(setContributorFollowed).not.toHaveBeenCalled();

	rerender({ id: "github:org:other" });
	expect(result.current.loading).toBe(true);
	await awaitReactAct(async () => {});
	expect(result.current.available).toBe(false);

	cleanup();
	vi.mocked(fetchDirectory).mockResolvedValueOnce(linked(100));
	const archivedHook = renderHook(() => useFollowAuthor("cli", key));
	await awaitReactAct(async () => {});
	expect(archivedHook.result.current.followed).toBe(false);
	expect(archivedHook.result.current.archived).toBe(true);
});

it("surfaces Error and fallback reload errors and ignores superseded tickets", async () => {
	const d1 = deferred<DirectoryData>();
	const d2 = deferred<DirectoryData>();
	const d3 = deferred<DirectoryData>();
	vi.mocked(fetchDirectory)
		.mockReturnValueOnce(d1.promise)
		.mockReturnValueOnce(d2.promise)
		.mockReturnValueOnce(d3.promise)
		.mockRejectedValueOnce(new Error("Directory offline"))
		.mockRejectedValueOnce("non-error-load");

	const { result } = renderHook(() => useFollowAuthor("cli", key));

	let p2!: Promise<void>;
	let p3!: Promise<void>;
	act(() => {
		p2 = result.current.reload();
		p3 = result.current.reload();
	});

	await awaitReactAct(async () => {
		d3.resolve(directory);
		await p3;
		d1.resolve(linked(null));
		d2.reject(new Error("stale rejection"));
		await p2;
	});

	expect(result.current.followed).toBe(false);
	expect(result.current.error).toBeNull();

	await awaitReactAct(async () => {
		await result.current.reload();
	});
	expect(result.current.error).toBe("Directory offline");

	await awaitReactAct(async () => {
		await result.current.reload();
	});
	expect(result.current.error).toBe("Could not load author");
});

it("guards concurrent follow/reload calls, persists follow, handles errors, and aborts after unmount", async () => {
	const followFetch = deferred<DirectoryData>();
	const persist = deferred<void>();
	vi.mocked(fetchDirectory)
		.mockResolvedValueOnce(directory)
		.mockReturnValueOnce(followFetch.promise);
	vi.mocked(setContributorFollowed).mockReturnValueOnce(persist.promise);

	const { result } = renderHook(() => useFollowAuthor("cli", key));
	await awaitReactAct(async () => {});

	let followPromise!: Promise<void>;
	act(() => {
		followPromise = result.current.follow();
	});
	expect(result.current.busy).toBe(true);

	await awaitReactAct(async () => {
		await result.current.follow();
		await result.current.reload();
	});
	expect(fetchDirectory).toHaveBeenCalledTimes(2);

	await awaitReactAct(async () => {
		followFetch.resolve(directory);
		await Promise.resolve();
	});
	expect(setContributorFollowed).toHaveBeenCalledWith(
		"cli",
		`identity:${key}`,
		directory,
		true,
	);

	await awaitReactAct(async () => {
		persist.resolve();
		await followPromise;
	});
	expect(result.current.followed).toBe(true);
	expect(result.current.busy).toBe(false);

	cleanup();
	vi.mocked(fetchDirectory)
		.mockResolvedValueOnce(directory)
		.mockRejectedValueOnce(new Error("Follow failed"))
		.mockRejectedValueOnce("string-follow-err");
	const errHook = renderHook(() => useFollowAuthor("cli", key));
	await awaitReactAct(async () => {});

	await awaitReactAct(async () => {
		await errHook.result.current.follow();
	});
	expect(errHook.result.current.error).toBe("Follow failed");
	expect(errHook.result.current.busy).toBe(false);

	await awaitReactAct(async () => {
		await errHook.result.current.follow();
	});
	expect(errHook.result.current.error).toBe("Could not follow author");
	expect(errHook.result.current.busy).toBe(false);

	cleanup();
	const unmountFetch = deferred<DirectoryData>();
	vi.mocked(fetchDirectory)
		.mockResolvedValueOnce(directory)
		.mockReturnValueOnce(unmountFetch.promise);
	vi.mocked(setContributorFollowed).mockClear();

	const unmountHook = renderHook(() => useFollowAuthor("cli", key));
	await awaitReactAct(async () => {});

	let abortedFollow!: Promise<void>;
	act(() => {
		abortedFollow = unmountHook.result.current.follow();
	});
	unmountHook.unmount();
	await awaitReactAct(async () => {
		unmountFetch.resolve(directory);
		await abortedFollow;
	});
	expect(setContributorFollowed).not.toHaveBeenCalled();
});
