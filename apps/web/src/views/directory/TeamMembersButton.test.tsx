import type { DataSource, DirectoryData } from "@signoff/domain/insights";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { fetchDirectory, saveDirectoryEntity } from "@/models/directoryApi";
import { DirectoryTeamsPage } from "./DirectoryPage";

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

function directory(): DirectoryData {
	return {
		source: "cli",
		revision: 3,
		projects: [],
		repositories: [],
		tags: [],
		blockedContributorKeys: ["member:hidden"],
		members: ["Ada", "Grace", "Alan", "Archived", "Hidden"].map((name) => ({
			id: name.toLowerCase(),
			name,
			avatarUrl: "https://example.com/avatar.png",
			identityKeys: name === "Grace" ? ["grace-key"] : [],
			teamIds: name === "Ada" ? ["core"] : ["other"],
			tagIds: [],
			archivedAt: name === "Archived" ? 1 : null,
		})),
		teams: [
			{
				id: "core",
				name: "Core",
				avatarUrl: null,
				memberIds: ["ada"],
				tagIds: [],
				archivedAt: null,
			},
			{
				id: "old",
				name: "Old",
				avatarUrl: null,
				memberIds: [],
				tagIds: [],
				archivedAt: 1,
			},
		],
		identities: [
			{
				key: "grace-key",
				provider: "ado",
				organization: "org",
				actorId: "grace",
				name: "Grace",
				handle: "grace@example.com",
				avatarUrl: null,
				memberId: "grace",
				lastSeenAt: 1,
			},
		],
	};
}

beforeEach(() => {
	localStorage.clear();
	workbench.filter.source = "cli";
	vi.mocked(fetchDirectory).mockReset().mockResolvedValue(directory());
	vi.mocked(saveDirectoryEntity).mockReset().mockResolvedValue({ id: "core" });
});
afterEach(cleanup);

async function openPicker() {
	render(
		<MemoryRouter>
			<DirectoryTeamsPage />
		</MemoryRouter>,
	);
	const membership = await screen.findByRole("list", { name: "Core members" });
	fireEvent.click(screen.getByRole("button", { name: "Add members to Core" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Members to add" }),
	);
	const listbox = await screen.findByRole("listbox", {
		name: "Members to add",
	});
	return { membership, dialog, listbox };
}

it("bulk-adds searched members from the routed Teams page and keeps existing cards mounted through reload", async () => {
	const { membership, dialog, listbox } = await openPicker();
	expect(
		within(listbox)
			.getByRole("option", { name: /Ada/ })
			.getAttribute("aria-disabled"),
	).toBe("true");
	expect(within(listbox).getByText("Already in team")).toBeTruthy();
	expect(
		within(listbox).queryByRole("option", { name: /Archived|Hidden/ }),
	).toBeNull();
	fireEvent.change(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ target: { value: "grace@example.com" } },
	);
	expect(within(listbox).queryByRole("option", { name: "Alan" })).toBeNull();
	fireEvent.click(within(listbox).getByRole("option", { name: /Grace/ }));
	fireEvent.change(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ target: { value: "" } },
	);
	fireEvent.click(within(listbox).getByRole("option", { name: "Alan" }));
	fireEvent.keyDown(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ key: "Escape" },
	);
	const latest = directory();
	latest.teams[0].memberIds = ["ada", "alan"];
	latest.revision = 4;
	let finishReload!: (data: DirectoryData) => void;
	vi.mocked(fetchDirectory)
		.mockResolvedValueOnce(latest)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishReload = resolve;
				}),
		);
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Add 2 members" }),
	);
	await waitFor(() =>
		expect(saveDirectoryEntity).toHaveBeenCalledExactlyOnceWith(
			"cli",
			"teams",
			"core",
			{
				name: "Core",
				avatarUrl: null,
				memberIds: ["ada", "alan", "grace"],
				tagIds: [],
			},
			4,
		),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByRole("list", { name: "Core members" })).toBe(membership);
	expect(screen.queryByText("Loading directory…")).toBeNull();
	latest.teams[0].memberIds.push("grace");
	finishReload(latest);
	await waitFor(() =>
		expect(within(membership).getByText("Grace")).toBeTruthy(),
	);
	expect(screen.getByRole("list", { name: "Core members" })).toBe(membership);
});

it("keeps the multi-selection and dialog on conflict and allows retry", async () => {
	vi.mocked(saveDirectoryEntity).mockRejectedValueOnce(
		new ApiError("Changed", 409),
	);
	const { dialog, listbox } = await openPicker();
	fireEvent.click(within(listbox).getByRole("option", { name: /Grace/ }));
	fireEvent.keyDown(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ key: "Escape" },
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 member" }));
	expect((await within(dialog).findByRole("alert")).textContent).toContain(
		"Your selection is kept",
	);
	expect(
		within(dialog).getByRole("button", { name: "Remove Grace" }),
	).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 member" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(saveDirectoryEntity).toHaveBeenCalledTimes(2);
});

it("cancels without writes and starts the next picker with an empty selection", async () => {
	const { dialog, listbox } = await openPicker();
	fireEvent.click(within(listbox).getByRole("option", { name: "Alan" }));
	fireEvent.keyDown(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ key: "Escape" },
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(screen.queryByRole("dialog")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Add members to Core" }));
	expect(
		screen
			.getByRole("button", { name: "Add members" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});

it("does not offer bulk membership on archived team cards", async () => {
	const data = directory();
	data.teams[0].archivedAt = 1;
	vi.mocked(fetchDirectory).mockResolvedValue(data);
	localStorage.setItem(
		"signoff-directory-cli-teams",
		JSON.stringify({ status: "all" }),
	);
	render(
		<MemoryRouter>
			<DirectoryTeamsPage />
		</MemoryRouter>,
	);
	await screen.findByText("Core");
	expect(screen.queryByRole("button", { name: /Add members to/ })).toBeNull();
});

it("keeps the dialog open during a pending write and blocks selection changes", async () => {
	let finish!: (value: { id: string }) => void;
	vi.mocked(saveDirectoryEntity).mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const { dialog, listbox } = await openPicker();
	fireEvent.click(within(listbox).getByRole("option", { name: "Alan" }));
	fireEvent.keyDown(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ key: "Escape" },
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 member" }));
	await waitFor(() => expect(saveDirectoryEntity).toHaveBeenCalledTimes(1));
	expect(
		within(dialog)
			.getByRole("button", { name: "Cancel" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		within(dialog)
			.getByRole("button", { name: "Members to add" })
			.hasAttribute("disabled"),
	).toBe(true);
	fireEvent.keyDown(dialog, { key: "Escape" });
	expect(screen.getByRole("dialog")).toBe(dialog);
	await act(async () => {
		finish({ id: "core" });
	});
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes through the dialog dismissal without changing memberships", async () => {
	const { dialog } = await openPicker();
	fireEvent.keyDown(
		screen.getByPlaceholderText("Name, account, or organization…"),
		{ key: "Escape" },
	);
	fireEvent.keyDown(dialog, { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
});
