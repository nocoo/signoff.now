import { type DirectoryData, identityKey } from "@signoff/domain/insights";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	fetchDirectory,
	saveDirectoryEntity,
	setDirectoryArchived,
} from "@/models/directoryApi";
import { fixtureProject, fixturePull } from "@/test/monitoring-fixture";
import { useFollowAuthor } from "@/viewmodels/useFollowAuthor";
import { FollowAuthorButton } from "./FollowAuthorButton";

vi.mock("@/models/directoryApi", () => ({
	fetchDirectory: vi.fn(),
	saveDirectoryEntity: vi.fn(),
	setDirectoryArchived: vi.fn(),
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
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function show() {
	return render(
		<FollowAuthorButton project={fixtureProject} author={fixturePull.author} />,
	);
}
async function followButton() {
	return screen.findByRole("button", { name: "Follow author" });
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(fetchDirectory).mockResolvedValue(directory);
	vi.mocked(saveDirectoryEntity).mockResolvedValue({ id: "member-1" });
	vi.mocked(setDirectoryArchived).mockResolvedValue();
});
afterEach(cleanup);

it("follows the exact observed account with the latest directory revision", async () => {
	const write = deferred<{ id: string }>();
	vi.mocked(saveDirectoryEntity).mockReturnValue(write.promise);
	show();
	expect(
		screen.getByRole("button", { name: "Loading author…" }),
	).toHaveProperty("disabled", true);
	const button = await followButton();
	vi.mocked(fetchDirectory).mockResolvedValue({ ...directory, revision: 43 });
	fireEvent.click(button);
	fireEvent.click(button);
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledExactlyOnceWith(
			"cli",
			"members",
			null,
			{
				name: fixturePull.author.name,
				avatarUrl: null,
				identityKeys: [key],
				teamIds: [],
				tagIds: [],
			},
			43,
		),
	);
	expect(screen.getByRole("button", { name: "Following…" })).toHaveProperty(
		"disabled",
		true,
	);
	await act(async () => write.resolve({ id: "member-1" }));
	expect(screen.getByRole("button", { name: "Followed" })).toHaveProperty(
		"disabled",
		true,
	);
});

it("recognizes an already-followed account without creating another member", async () => {
	vi.mocked(fetchDirectory).mockResolvedValue(linked());
	show();
	expect(
		await screen.findByRole("button", { name: "Followed" }),
	).toHaveProperty("disabled", true);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("restores an archived member instead of duplicating its linked account", async () => {
	vi.mocked(fetchDirectory).mockResolvedValue(linked(10));
	show();
	fireEvent.click(
		await screen.findByRole("button", { name: "Restore follow" }),
	);
	await screen.findByRole("button", { name: "Followed" });
	expect(setDirectoryArchived).toHaveBeenCalledExactlyOnceWith(
		"cli",
		"members",
		"member-1",
		false,
		42,
	);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("uses a concurrent follow discovered by the pre-write read", async () => {
	show();
	const button = await followButton();
	vi.mocked(fetchDirectory).mockResolvedValue(linked());
	fireEvent.click(button);
	await screen.findByRole("button", { name: "Followed" });
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	expect(setDirectoryArchived).not.toHaveBeenCalled();
});

it("keeps equal names in other organizations and providers separate", async () => {
	const other = linked();
	other.identities = [
		{
			...other.identities[0],
			key: identityKey("github", "another-org", fixturePull.author.id),
		},
	];
	vi.mocked(fetchDirectory).mockResolvedValue(other);
	show();
	await waitFor(() => expect(screen.queryByText("Loading author…")).toBeNull());
	expect(await followButton()).toHaveProperty("disabled", true);
	expect(screen.queryByRole("button", { name: "Followed" })).toBeNull();
});

it("does not fetch or follow an unknown author", async () => {
	render(
		<FollowAuthorButton
			project={fixtureProject}
			author={{ ...fixturePull.author, id: "unknown" }}
		/>,
	);
	expect(await followButton()).toHaveProperty("disabled", true);
	expect(fetchDirectory).not.toHaveBeenCalled();
});

it.each([
	new Error("Directory unavailable"),
	null,
])("allows retry after a failed directory read (%s)", async (error) => {
	vi.mocked(fetchDirectory).mockRejectedValueOnce(error);
	show();
	fireEvent.click(await screen.findByRole("button", { name: "Retry author" }));
	expect(await followButton()).toHaveProperty("disabled", false);
	expect(screen.queryByRole("alert")).toBeNull();
});

it.each([
	new Error("Directory changed"),
	null,
])("allows retry after a failed follow (%s)", async (error) => {
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce(error);
	show();
	fireEvent.click(await followButton());
	expect((await screen.findByRole("alert")).textContent).toContain(
		error?.message ?? "Could not follow author",
	);
	fireEvent.click(await followButton());
	await screen.findByRole("button", { name: "Followed" });
	expect(saveDirectoryEntity).toHaveBeenCalledTimes(2);
});

it.each([
	"account",
	"member",
])("reports a disappeared %s before creating a duplicate", async (missing) => {
	show();
	const button = await followButton();
	vi.mocked(fetchDirectory).mockResolvedValue(
		missing === "account"
			? { ...directory, identities: [] }
			: { ...linked(), members: [] },
	);
	fireEvent.click(button);
	expect((await screen.findByRole("alert")).textContent).toContain(
		missing === "account"
			? "Author account is unavailable"
			: "Linked member is unavailable",
	);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("never writes a stale author after the data source changes during its pre-write read", async () => {
	const pending = deferred<DirectoryData>();
	const { rerender } = show();
	const button = await followButton();
	vi.mocked(fetchDirectory).mockReturnValueOnce(pending.promise);
	fireEvent.click(button);
	vi.mocked(fetchDirectory).mockResolvedValue({ ...directory, source: "demo" });
	rerender(
		<FollowAuthorButton
			project={{ ...fixtureProject, source: "demo" }}
			author={fixturePull.author}
		/>,
	);
	await followButton();
	await act(async () => pending.resolve(linked()));
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Followed" })).toBeNull();
	fireEvent.click(await followButton());
	await screen.findByRole("button", { name: "Followed" });
	expect(saveDirectoryEntity).toHaveBeenCalledWith(
		"demo",
		"members",
		null,
		expect.anything(),
		42,
	);
});

it.each([
	"resolve",
	"reject",
] as const)("ignores an old directory request that %s after switching away and back", async (outcome) => {
	const pending = deferred<DirectoryData>();
	vi.mocked(fetchDirectory).mockReturnValueOnce(pending.promise);
	const { rerender } = show();
	rerender(
		<FollowAuthorButton
			project={{ ...fixtureProject, source: "demo" }}
			author={fixturePull.author}
		/>,
	);
	rerender(
		<FollowAuthorButton project={fixtureProject} author={fixturePull.author} />,
	);
	await followButton();
	await act(async () =>
		outcome === "resolve"
			? pending.resolve(linked())
			: pending.reject(new Error("Old request")),
	);
	expect(await followButton()).toHaveProperty("disabled", false);
	expect(screen.queryByRole("alert")).toBeNull();
});

it("ignores stale callbacks and serializes follow writes", async () => {
	const pending = deferred<DirectoryData>();
	const { result, rerender, unmount } = renderHook(
		({ account }) => useFollowAuthor("cli", account),
		{ initialProps: { account: key as string | null } },
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	vi.mocked(fetchDirectory).mockReturnValueOnce(pending.promise);
	let follow!: Promise<void>;
	act(() => {
		follow = result.current.follow();
	});
	await act(async () => {
		await result.current.follow();
		await result.current.reload();
	});
	expect(fetchDirectory).toHaveBeenCalledTimes(2);
	await act(async () => {
		pending.resolve(directory);
		await follow;
	});
	await act(async () => result.current.follow());
	expect(saveDirectoryEntity).toHaveBeenCalledTimes(1);
	const old = result.current;
	rerender({ account: null });
	await act(async () => {
		await old.reload();
		await old.follow();
		await result.current.follow();
	});
	unmount();
	await act(async () => {
		await result.current.reload();
		await result.current.follow();
	});
	expect(fetchDirectory).toHaveBeenCalledTimes(2);
});
