/**
 * The three reworked pages, actually rendered.
 *
 * Views are outside the coverage gate, so nothing else here mounts one. That
 * is fine for logic — it lives in the ViewModels — but it leaves one class of
 * defect completely unguarded: the page throws on mount, or its Add button
 * opens nothing, and every ViewModel test still passes. wiring is exactly what
 * unit tests cannot see, so it is asserted here end-to-end through the real
 * dialog, against a mocked HTTP client.
 */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRepo,
	createTag,
	createTeam,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { DeveloperDialog } from "@/views/developers/DeveloperDialog";
import { ReposPage } from "@/views/repos/ReposPage";
import { TagsPage } from "@/views/tags/TagsPage";
import { TeamsPage } from "@/views/teams/TeamsPage";

vi.mock("@/models/entitiesApi", () => ({
	listTeams: vi.fn(),
	listTags: vi.fn(),
	listRepos: vi.fn(),
	createTeam: vi.fn(),
	createTag: vi.fn(),
	createRepo: vi.fn(),
	patchTeam: vi.fn(),
	patchTag: vi.fn(),
	patchRepo: vi.fn(),
	archiveTeam: vi.fn(),
	archiveTag: vi.fn(),
	archiveRepo: vi.fn(),
	restoreTeam: vi.fn(),
	restoreTag: vi.fn(),
	restoreRepo: vi.fn(),
}));

const tagRow = {
	id: "g1",
	name: "frontend",
	color: "#00A4EF",
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
};

const teamRow = {
	id: "t1",
	name: "Core Platform",
	avatarUrl: null,
	tagIds: ["g1"],
	createdAt: 1,
	updatedAt: 1,
	archivedAt: null,
};

const repoRow = {
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
};

beforeEach(() => {
	vi.mocked(listTeams).mockReset().mockResolvedValue([teamRow]);
	vi.mocked(listTags).mockReset().mockResolvedValue([tagRow]);
	vi.mocked(listRepos).mockReset().mockResolvedValue([repoRow]);
	vi.mocked(createTeam).mockReset().mockResolvedValue(teamRow);
	vi.mocked(createTag).mockReset().mockResolvedValue(tagRow);
	vi.mocked(createRepo).mockReset().mockResolvedValue(repoRow);
});

/** The row count sits next to the Add button and reflects the filter. */
const counter = () => screen.getByText(/\d+ of \d+/).textContent;

describe("DeveloperDialog", () => {
	it("saves team and tag selections, including inline creation, and locks toggles during save", async () => {
		let finishSave = () => {};
		const onSubmit = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishSave = resolve;
				}),
		);
		const onOpenChange = vi.fn();
		const onCreateTag = vi.fn().mockResolvedValue("g2");
		render(
			<DeveloperDialog
				developer={null}
				teams={[teamRow]}
				tags={[tagRow]}
				open
				onSubmit={onSubmit}
				onOpenChange={onOpenChange}
				onCreateTag={onCreateTag}
			/>,
		);
		const dialog = screen.getByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Ada" },
		});
		fireEvent.change(within(dialog).getByLabelText("Alias"), {
			target: { value: "ada" },
		});
		const team = within(dialog).getByRole("button", { name: /Core Platform/ });
		const tag = within(dialog).getByRole("button", { name: "frontend" });
		fireEvent.click(team);
		fireEvent.click(tag);
		expect(team.getAttribute("aria-pressed")).toBe("true");
		expect(tag.getAttribute("aria-pressed")).toBe("true");

		const newTag = within(dialog).getByLabelText("New tag name");
		fireEvent.change(newTag, { target: { value: "frontend" } });
		fireEvent.keyDown(newTag, { key: "Enter" });
		expect(onCreateTag).not.toHaveBeenCalled();
		expect(tag.getAttribute("aria-pressed")).toBe("true");
		fireEvent.change(newTag, { target: { value: "infra" } });
		fireEvent.keyDown(newTag, { key: "Enter" });
		await waitFor(() => expect((newTag as HTMLInputElement).value).toBe(""));
		expect(onCreateTag).toHaveBeenCalledWith("infra");
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "Ada",
			alias: "ada",
			avatarUrl: "",
			teamIds: ["t1"],
			tagIds: ["g1", "g2"],
		});
		expect((team as HTMLButtonElement).disabled).toBe(true);
		expect((tag as HTMLButtonElement).disabled).toBe(true);
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(onOpenChange).not.toHaveBeenCalled();
		await act(async () => finishSave());
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

describe("TeamsPage", () => {
	it("renders the roster behind a filter bar", async () => {
		render(<TeamsPage />);
		expect(await screen.findByText("Core Platform")).toBeTruthy();
		expect(screen.getByLabelText("Search")).toBeTruthy();
		expect(screen.getByLabelText("Status")).toBeTruthy();
		expect(screen.getByLabelText("Tag")).toBeTruthy();
		expect(counter()).toBe("1 of 1");
	});

	it("narrows the list as the filter changes", async () => {
		render(<TeamsPage />);
		await screen.findByText("Core Platform");

		fireEvent.change(screen.getByLabelText("Search"), {
			target: { value: "infra" },
		});
		await waitFor(() => expect(counter()).toBe("0 of 1"));
		expect(screen.queryByText("Core Platform")).toBeNull();
		// An empty result must say so rather than look like a failed load.
		expect(screen.getByText("No matches")).toBeTruthy();
	});

	it("creates a team through the dialog", async () => {
		render(<TeamsPage />);
		await screen.findByText("Core Platform");

		fireEvent.click(screen.getByRole("button", { name: "Add team" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Infra" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(createTeam).toHaveBeenCalledWith("Infra", {
				avatarUrl: null,
				tagIds: [],
			}),
		);
	});
});

describe("TagsPage", () => {
	it("renders the list behind a filter bar", async () => {
		render(<TagsPage />);
		expect(await screen.findByText("frontend")).toBeTruthy();
		expect(screen.getByLabelText("Search")).toBeTruthy();
		expect(screen.getByLabelText("Status")).toBeTruthy();
		expect(counter()).toBe("1 of 1");
	});

	it("narrows the list as the filter changes", async () => {
		render(<TagsPage />);
		await screen.findByText("frontend");

		fireEvent.change(screen.getByLabelText("Search"), {
			target: { value: "backend" },
		});
		await waitFor(() => expect(counter()).toBe("0 of 1"));
		expect(screen.getByText("No matches")).toBeTruthy();
	});

	it("creates a tag through the dialog", async () => {
		render(<TagsPage />);
		await screen.findByText("frontend");

		fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "infra" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

		// The default colour must reach the server as #RRGGBB — normalizeColor
		// rejects anything else, and the old page could send a CSS colour.
		await waitFor(() => expect(createTag).toHaveBeenCalled());
		const [, color] = vi.mocked(createTag).mock.calls[0] as [string, string];
		expect(color).toMatch(/^#[0-9A-F]{6}$/);
	});

	it("keeps arbitrary hex colors outside the named palette", async () => {
		render(<TagsPage />);
		await screen.findByText("frontend");
		fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "infra" },
		});
		fireEvent.change(within(dialog).getByLabelText("Colour"), {
			target: { value: "#123abc" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
		await waitFor(() =>
			expect(createTag).toHaveBeenCalledWith("infra", "#123ABC"),
		);
	});
});

describe("ReposPage", () => {
	it("renders the table behind a filter bar", async () => {
		render(<ReposPage />);
		expect(await screen.findByText("api")).toBeTruthy();
		expect(screen.getByLabelText("Search")).toBeTruthy();
		expect(screen.getByLabelText("Status")).toBeTruthy();
		expect(screen.getByLabelText("Provider")).toBeTruthy();
		expect(screen.getByLabelText("Collection")).toBeTruthy();
		expect(counter()).toBe("1 of 1");
	});

	it("offers only the providers actually bound", async () => {
		render(<ReposPage />);
		await screen.findByText("api");
		fireEvent.click(screen.getByLabelText("Provider"));
		const options = await screen.findAllByRole("option");
		expect(options.map((o) => o.textContent)).toEqual([
			"All providers",
			"Azure DevOps",
		]);
	});

	it("narrows the list by the enabled flag", async () => {
		render(<ReposPage />);
		await screen.findByText("api");

		fireEvent.click(screen.getByLabelText("Collection"));
		fireEvent.click(await screen.findByRole("option", { name: "Disabled" }));
		await waitFor(() => expect(counter()).toBe("0 of 1"));
		expect(screen.getByText("No matches")).toBeTruthy();
	});

	it("binds a repo through the dialog", async () => {
		render(<ReposPage />);
		await screen.findByText("api");

		fireEvent.click(screen.getByRole("button", { name: "Bind repo" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Org"), {
			target: { value: "fabrikam" },
		});
		fireEvent.change(within(dialog).getByLabelText("Project"), {
			target: { value: "Tools" },
		});
		fireEvent.change(within(dialog).getByLabelText("Repo name"), {
			target: { value: "web" },
		});
		fireEvent.change(within(dialog).getByLabelText("ADO repository GUID"), {
			target: { value: "new-guid" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Bind" }));

		await waitFor(() =>
			expect(createRepo).toHaveBeenCalledWith({
				provider: "ado",
				org: "fabrikam",
				project: "Tools",
				name: "web",
				externalId: "new-guid",
				// A blank optional GUID is null, not "" — the server rejects "".
				projectExternalId: null,
				enabled: true,
			}),
		);
	});

	it("refuses an enabled ADO binding with no GUID, without calling the API", async () => {
		render(<ReposPage />);
		await screen.findByText("api");

		fireEvent.click(screen.getByRole("button", { name: "Bind repo" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Org"), {
			target: { value: "fabrikam" },
		});
		fireEvent.change(within(dialog).getByLabelText("Project"), {
			target: { value: "Tools" },
		});
		fireEvent.change(within(dialog).getByLabelText("Repo name"), {
			target: { value: "web" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Bind" }));

		expect(await within(dialog).findByRole("alert")).toBeTruthy();
		expect(createRepo).not.toHaveBeenCalled();
	});
});
