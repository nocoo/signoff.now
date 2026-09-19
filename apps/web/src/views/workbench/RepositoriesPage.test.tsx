import type {
	ContributionFilters,
	ContributionSnapshot,
	DirectoryData,
} from "@signoff/domain/insights";
import type { Project } from "@signoff/domain/workbench";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	calculateContribution,
	fetchContribution,
} from "@/models/contributionsApi";
import { fetchDirectory } from "@/models/directoryApi";
import { RepositoriesPage } from "./RepositoriesPage";

vi.mock("@/viewmodels/WorkbenchProvider", () => ({
	useWorkbench: () => ({ filter: { source: "cli" } }),
}));
vi.mock("@/models/contributionsApi", () => ({
	calculateContribution: vi.fn(),
	fetchContribution: vi.fn(),
}));
vi.mock("@/models/directoryApi", () => ({ fetchDirectory: vi.fn() }));
vi.mock("@nocoo/basalt/charts/frame", () => ({
	ChartFrame: ({
		ariaLabel,
		summary,
	}: {
		ariaLabel: string;
		summary: ReactNode;
	}) => <figure aria-label={ariaLabel}>{summary}</figure>,
}));

const NOW = 1_800_000_000;
const project: Project = {
	id: "project-ado",
	provider: "ado",
	organization: "example-org",
	projectKey: "Core Platform",
	name: "Core Platform",
	description: "",
	owner: "Owner",
	enabled: true,
	source: "cli",
	revision: 1,
	createdAt: 1,
	updatedAt: 1,
	lastScannedAt: NOW - 180,
	scanState: "complete",
	scanMessage: null,
};
const repository = {
	key: JSON.stringify([project.id, "repo-guid"]),
	projectId: project.id,
	id: "repo-guid",
	name: "web app",
	total: 2001,
	open: 1990,
	merged: 10,
	closed: 1,
	draft: 0,
	contributors: 4,
	lastCollectedAt: NOW - 180,
};
const directory: DirectoryData = {
	source: "cli",
	revision: 0,
	members: [],
	teams: [],
	tags: [],
	identities: [],
	projects: [
		project,
		{
			...project,
			id: "uncollected",
			projectKey: "Uncollected",
			lastScannedAt: null,
			scanState: "never",
			repositories: ["worker"],
		},
		{ ...project, id: "empty", projectKey: "Empty project" },
	],
	repositories: [repository],
};

function snapshot(filters: ContributionFilters): ContributionSnapshot {
	return {
		module: "repositories",
		filters,
		calculatedAt: NOW,
		coverage: "observed",
		totals: { ...repository, repositories: 1 },
		trend: [],
		members: [],
		repositories: [repository],
	};
}

beforeEach(() => {
	localStorage.clear();
	vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
	vi.mocked(fetchDirectory).mockReset().mockResolvedValue(directory);
	vi.mocked(fetchContribution).mockReset().mockResolvedValue(null);
	vi.mocked(calculateContribution)
		.mockReset()
		.mockImplementation(async (_module, filters) => snapshot(filters));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("calculates only on request, uses uncapped saved totals, and links the repository to its source and PR queue", async () => {
	render(
		<MemoryRouter>
			<RepositoriesPage />
		</MemoryRouter>,
	);
	await screen.findByText("No saved calculation");
	expect(calculateContribution).not.toHaveBeenCalled();
	expect(fetchContribution).toHaveBeenCalledWith(
		"repositories",
		expect.objectContaining({
			source: "cli",
			from: null,
			to: null,
			includeDraft: false,
		}),
	);
	expect(screen.getByText("Uncollected")).toBeTruthy();
	expect(screen.getByText("Not collected yet")).toBeTruthy();
	expect(screen.getByText("No PR records collected")).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Calculate Repository overview" }),
	);
	const table = await screen.findByRole("table", {
		name: "Repository pull request counts",
	});
	expect(within(table).getByText("2,001")).toBeTruthy();
	expect(within(table).getByText("3 min ago")).toBeTruthy();
	const source = within(table).getByRole("link", { name: "web app" });
	expect(source.getAttribute("href")).toBe(
		"https://dev.azure.com/example-org/Core%20Platform/_git/repo-guid",
	);
	expect(source.getAttribute("target")).toBe("_blank");
	expect(source.getAttribute("rel")).toBe("noopener noreferrer");
	expect(
		within(table)
			.getByRole("link", { name: "example-org" })
			.getAttribute("href"),
	).toBe("https://dev.azure.com/example-org");
	expect(
		within(table)
			.getByRole("link", { name: "Core Platform" })
			.getAttribute("href"),
	).toBe("https://dev.azure.com/example-org/Core%20Platform");
	const queue = new URL(
		within(table)
			.getByRole("link", { name: "View PRs in web app" })
			.getAttribute("href") ?? "",
		"https://signoff.test",
	);
	expect(queue.searchParams.get("project")).toBe(project.id);
	expect(queue.searchParams.get("repo")).toBe(repository.id);
	expect(queue.pathname).toBe("/prs");
	expect(queue.searchParams.get("source")).toBe("live");
	expect(calculateContribution).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("switch", { name: "Include drafts" }));
	await waitFor(() =>
		expect(fetchContribution).toHaveBeenLastCalledWith(
			"repositories",
			expect.objectContaining({ includeDraft: true }),
		),
	);
	expect(calculateContribution).toHaveBeenCalledTimes(1);
});

it("paginates the saved repository list locally without calculating again", async () => {
	vi.mocked(fetchContribution).mockImplementation(async (_module, filters) => ({
		...snapshot(filters),
		repositories: Array.from({ length: 21 }, (_, index) => ({
			...repository,
			key: JSON.stringify([project.id, `repo-${index}`]),
			id: `repo-${index}`,
			name: `repository-${index + 1}`,
		})),
	}));
	render(
		<MemoryRouter>
			<RepositoriesPage />
		</MemoryRouter>,
	);
	const table = await screen.findByRole("table", {
		name: "Repository pull request counts",
	});
	expect(within(table).getAllByRole("row")).toHaveLength(21);
	expect(
		screen
			.getByRole("button", { name: "Previous repository page" })
			.hasAttribute("disabled"),
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Next repository page" }));
	expect(within(table).getAllByRole("row")).toHaveLength(2);
	expect(
		within(table).getByRole("link", { name: "repository-21" }),
	).toBeTruthy();
	expect(
		screen
			.getByRole("button", { name: "Next repository page" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(calculateContribution).not.toHaveBeenCalled();
});
