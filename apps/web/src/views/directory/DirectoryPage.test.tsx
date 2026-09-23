import {
	type DataSource,
	type DirectoryData,
	identityKey,
} from "@signoff/domain/insights";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	fetchDirectory,
	saveDirectoryEntity,
	setDirectoryArchived,
} from "@/models/directoryApi";
import {
	DirectoryTagsPage,
	DirectoryTeamsPage,
	MembersPage,
} from "./DirectoryPage";

const workbench = vi.hoisted(() => ({
	filter: { source: "cli" as DataSource },
}));
vi.mock("@/viewmodels/WorkbenchProvider", () => ({
	useWorkbench: () => workbench,
}));
vi.mock("@/models/directoryApi", () => ({
	fetchDirectory: vi.fn(),
	saveDirectoryEntity: vi.fn(),
	setDirectoryArchived: vi.fn(),
}));

const adaKey = identityKey("ado", "org", "ada");
const guestKey = identityKey("ado", "org", "guest");
const data: DirectoryData = {
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
			identityKeys: [adaKey],
			archivedAt: null,
		},
	],
	teams: [
		{
			id: "core",
			name: "Core Team",
			avatarUrl: null,
			memberIds: ["ada"],
			tagIds: ["web"],
			archivedAt: null,
		},
	],
	tags: [{ id: "web", name: "Web", color: "#5588CC", archivedAt: null }],
	identities: [
		{
			key: adaKey,
			actorId: "ada",
			provider: "ado",
			organization: "org",
			name: "Ada Lovelace",
			handle: "ada@example.com",
			avatarUrl: null,
			memberId: "ada",
			lastSeenAt: 5,
		},
		{
			key: guestKey,
			actorId: "guest",
			provider: "ado",
			organization: "org",
			name: "Guest Author",
			handle: "guest@example.com",
			avatarUrl: null,
			memberId: null,
			lastSeenAt: 5,
		},
	],
};

beforeEach(() => {
	localStorage.clear();
	workbench.filter.source = "cli";
	vi.mocked(fetchDirectory)
		.mockReset()
		.mockImplementation(async (source) => ({
			...structuredClone(data),
			source,
		}));
	vi.mocked(saveDirectoryEntity).mockReset().mockResolvedValue({ id: "saved" });
	vi.mocked(setDirectoryArchived).mockReset().mockResolvedValue();
});
afterEach(cleanup);

it("renders followed members, exact linked accounts, affiliations and contribution links", async () => {
	render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	const table = await screen.findByRole("table", { name: "Followed members" });
	expect(
		screen
			.getAllByRole("heading", { level: 1 })
			.map((heading) => heading.textContent),
	).toEqual(["Members"]);
	expect(within(table).getByText("ada@example.com")).toBeTruthy();
	expect(within(table).getByText("Core Team")).toBeTruthy();
	expect(within(table).getByText("Web")).toBeTruthy();
	expect(
		within(table)
			.getByRole("link", { name: "Contributions" })
			.getAttribute("href"),
	).toBe("/insights?source=cli&contributor=member%3Aada");
	expect(
		within(table).getByRole("link", { name: "Core Team" }).getAttribute("href"),
	).toBe("/insights?source=cli&team=core");
	fireEvent.change(screen.getByLabelText("Search"), {
		target: { value: "nobody" },
	});
	expect(screen.getByText("No members found")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
	expect(screen.getByRole("table", { name: "Followed members" })).toBeTruthy();
});

it("follows a discovered account through the real dialog without guessing its team", async () => {
	render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	await screen.findByRole("table", { name: "Followed members" });
	fireEvent.click(screen.getByRole("radio", { name: "Discover authors" }));
	fireEvent.click(screen.getByRole("button", { name: "Follow Guest Author" }));
	const dialog = await screen.findByRole("dialog");
	expect(
		(within(dialog).getByLabelText("Name") as HTMLInputElement).value,
	).toBe("Guest Author");
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Follow author" }),
	);
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledWith(
			"cli",
			"members",
			null,
			{
				name: "Guest Author",
				avatarUrl: null,
				identityKeys: [guestKey],
				teamIds: [],
				tagIds: [],
			},
			42,
		),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("can link a discovered author to an existing member, preserving current memberships", async () => {
	render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	await screen.findByRole("table", { name: "Followed members" });
	fireEvent.click(screen.getByRole("radio", { name: "Discover authors" }));
	fireEvent.click(screen.getByRole("button", { name: "Follow Guest Author" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.click(within(dialog).getByLabelText("Follow as"));
	fireEvent.click(await screen.findByRole("option", { name: "Ada Lovelace" }));
	fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledWith(
			"cli",
			"members",
			"ada",
			{
				name: "Ada Lovelace",
				avatarUrl: null,
				identityKeys: [adaKey, guestKey],
				teamIds: ["core"],
				tagIds: ["web"],
			},
			42,
		),
	);
});

it("disables account identities assigned to another member in the searchable account picker", async () => {
	render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	await screen.findByRole("table", { name: "Followed members" });
	fireEvent.click(screen.getByRole("button", { name: "Add member" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Linked accounts" }),
	);
	const options = await screen.findByRole("listbox", {
		name: "Linked accounts",
	});
	expect(
		within(options)
			.getByRole("option", { name: /Ada Lovelace/ })
			.getAttribute("aria-disabled"),
	).toBe("true");
	expect(
		within(options)
			.getByRole("option", { name: /Guest Author/ })
			.getAttribute("aria-disabled"),
	).toBeNull();
});

it("shows team membership and saves the real member multi-select", async () => {
	render(
		<MemoryRouter>
			<DirectoryTeamsPage />
		</MemoryRouter>,
	);
	const membership = await screen.findByRole("list", {
		name: "Core Team members",
	});
	expect(within(membership).getByText("Ada Lovelace")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Edit Core Team" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Remove Ada Lovelace" }),
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledWith(
			"cli",
			"teams",
			"core",
			{
				name: "Core Team",
				avatarUrl: null,
				memberIds: [],
				tagIds: ["web"],
			},
			42,
		),
	);
});

it("creates tags with their color and source and archives them explicitly", async () => {
	workbench.filter.source = "demo";
	render(
		<MemoryRouter>
			<DirectoryTagsPage />
		</MemoryRouter>,
	);
	await screen.findByRole("table", { name: "Directory tags" });
	fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.change(within(dialog).getByLabelText("Name"), {
		target: { value: "Platform" },
	});
	fireEvent.change(within(dialog).getByLabelText("Color"), {
		target: { value: "#12ab34" },
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledWith(
			"demo",
			"tags",
			null,
			{
				name: "Platform",
				color: "#12AB34",
			},
			42,
		),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(screen.getByRole("button", { name: "Archive Web" }));
	await waitFor(() =>
		expect(setDirectoryArchived).toHaveBeenCalledWith(
			"demo",
			"tags",
			"web",
			true,
			42,
		),
	);
});

it.each([
	{
		kind: "members" as const,
		Page: MembersPage,
		id: "ada",
		name: "Ada Lovelace",
		href: "/insights?source=cli&contributor=member%3Aada",
		relatedName: "Core Team",
		relatedHref: "/insights?source=cli&team=core",
	},
	{
		kind: "teams" as const,
		Page: DirectoryTeamsPage,
		id: "core",
		name: "Core Team",
		href: "/insights?source=cli&team=core",
		relatedName: "Ada Lovelace",
		relatedHref: "/insights?source=cli&contributor=member%3Aada",
	},
	{
		kind: "tags" as const,
		Page: DirectoryTagsPage,
		id: "web",
		name: "Web",
		href: "/insights?source=cli&tag=web",
		relatedName: null,
		relatedHref: null,
	},
])("hides archived $kind contribution links and restores them with the entry", async ({
	kind,
	Page,
	id,
	name,
	href,
	relatedName,
	relatedHref,
}) => {
	const current = structuredClone(data);
	vi.mocked(fetchDirectory).mockImplementation(async () =>
		structuredClone(current),
	);
	vi.mocked(setDirectoryArchived).mockImplementation(
		async (_source, entityKind, entityId, archived) => {
			const entry = current[entityKind].find((row) => row.id === entityId);
			if (!entry) throw new Error("Missing test directory entry");
			entry.archivedAt = archived ? 100 : null;
			current.revision += 1;
		},
	);
	render(
		<MemoryRouter>
			<Page />
		</MemoryRouter>,
	);
	expect(
		(await screen.findByRole("link", { name: "Contributions" })).getAttribute(
			"href",
		),
	).toBe(href);
	fireEvent.click(screen.getByLabelText("Status"));
	fireEvent.click(await screen.findByRole("option", { name: "All" }));
	fireEvent.click(screen.getByRole("button", { name: `Archive ${name}` }));
	await screen.findByRole("button", { name: `Restore ${name}` });
	expect(setDirectoryArchived).toHaveBeenCalledWith("cli", kind, id, true, 42);
	expect(screen.queryByRole("link", { name: "Contributions" })).toBeNull();
	expect(screen.getByText(name).closest("a")).toBeNull();
	if (kind === "members") expect(screen.getByText("AL")).toBeTruthy();
	if (relatedName === "Ada Lovelace") {
		expect(
			screen.getByRole("button", { name: `View ${relatedName}'s profile` }),
		).toBeTruthy();
	} else if (relatedName) {
		expect(
			screen.getByRole("link", { name: relatedName }).getAttribute("href"),
		).toBe(relatedHref);
	}
	fireEvent.click(screen.getByRole("button", { name: `Restore ${name}` }));
	expect(
		(await screen.findByRole("link", { name: "Contributions" })).getAttribute(
			"href",
		),
	).toBe(href);
	expect(setDirectoryArchived).toHaveBeenCalledWith("cli", kind, id, false, 43);
	if (kind === "members") {
		expect(
			screen.getByRole("button", { name: `View ${name}'s profile` }),
		).toBeTruthy();
	}
});

it("keeps archived team affiliations visible without linking to excluded contributions", async () => {
	const current = structuredClone(data);
	current.teams.push({
		id: "legacy",
		name: "Legacy Team",
		avatarUrl: null,
		memberIds: ["ada"],
		tagIds: [],
		archivedAt: 100,
	});
	current.members[0].teamIds.push("legacy");
	vi.mocked(fetchDirectory).mockResolvedValue(current);
	const { container } = render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	const table = await screen.findByRole("table", { name: "Followed members" });
	expect(
		within(table).getByText("Legacy Team (archived)").closest("a"),
	).toBeNull();
	expect(
		container.querySelector('a[href="/insights?source=cli&team=legacy"]'),
	).toBeNull();
	expect(
		within(table).getByRole("link", { name: "Core Team" }).getAttribute("href"),
	).toBe("/insights?source=cli&team=core");
	expect(
		within(table).getByRole("link", { name: "Contributions" }),
	).toBeTruthy();
});

it("keeps archived team members visible without linking to excluded contributions", async () => {
	const current = structuredClone(data);
	current.members.push({
		id: "grace",
		name: "Grace Hopper",
		avatarUrl: null,
		teamIds: ["core"],
		tagIds: [],
		identityKeys: [],
		archivedAt: 100,
	});
	current.teams[0].memberIds.push("grace");
	vi.mocked(fetchDirectory).mockResolvedValue(current);
	render(
		<MemoryRouter>
			<DirectoryTeamsPage />
		</MemoryRouter>,
	);
	const membership = await screen.findByRole("list", {
		name: "Core Team members",
	});
	expect(within(membership).getByText("Grace Hopper").closest("a")).toBeNull();
	expect(within(membership).getByText("GH")).toBeTruthy();
	expect(within(membership).getByText("Archived")).toBeTruthy();
	expect(
		within(membership).getByRole("button", {
			name: "View Ada Lovelace's profile",
		}),
	).toBeTruthy();
	expect(screen.getByRole("link", { name: "Contributions" })).toBeTruthy();
});

it("hides blocked members and authors and offers a recovery tab including members without accounts", async () => {
	const current = structuredClone(data);
	current.blockedContributorKeys = [
		"member:ada",
		`identity:${adaKey}`,
		`identity:${guestKey}`,
		"member:no-account",
	];
	current.members.push({
		id: "no-account",
		name: "Build Bot",
		avatarUrl: null,
		identityKeys: [],
		teamIds: [],
		tagIds: [],
		archivedAt: null,
	});
	vi.mocked(fetchDirectory).mockResolvedValue(current);
	render(
		<MemoryRouter>
			<MembersPage />
		</MemoryRouter>,
	);
	await screen.findByText("No members found");
	fireEvent.click(screen.getByRole("radio", { name: "Discover authors" }));
	expect(screen.getByText("No unfollowed authors found")).toBeTruthy();
	fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
	const blocked = screen.getByRole("list", { name: "Hidden contributors" });
	expect(within(blocked).getAllByRole("button")).toHaveLength(3);
	expect(
		within(blocked).getByRole("button", { name: "View Build Bot's profile" }),
	).toBeTruthy();
});
