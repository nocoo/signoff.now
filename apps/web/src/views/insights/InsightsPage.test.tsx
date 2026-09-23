import type {
	ContributionFilters,
	ContributionReport,
	ContributorRepositoryContribution,
	DataSource,
} from "@signoff/domain/insights";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchDirectory } from "@/models/directoryApi";
import { useContributionReport } from "@/viewmodels/useContributionReport";
import { InsightsPage } from "./InsightsPage";

let source: DataSource = "cli";
vi.mock("@/viewmodels/WorkbenchProvider", () => ({
	useWorkbench: () => ({ filter: { source } }),
}));
vi.mock("@/models/directoryApi", () => ({ fetchDirectory: vi.fn() }));
vi.mock("@/viewmodels/useContributionReport", () => ({
	useContributionReport: vi.fn(),
}));
const calculate = vi.fn();
const reload = vi.fn();
const hook = vi.mocked(useContributionReport);
let mode: "data" | "loading" | "empty" | "error" | "progress" = "data";
let extraAuthors = 0;
const NOW = 1_789_646_400;
const counts = (total: number) => ({
	total,
	open: total,
	merged: 0,
	closed: 0,
	draft: 0,
});
function contribution(
	key: string,
	name: string,
	repositoryKey: string,
	total: number,
	selected: boolean,
): ContributorRepositoryContribution {
	return {
		key,
		name,
		repositoryKey,
		selected,
		memberId: selected ? key : null,
		avatarUrl: null,
		teamIds: [],
		lastCollectedAt: NOW,
		...counts(total),
	};
}
function report(filters: ContributionFilters): ContributionReport {
	const contributions = [
		contribution("alice", "Alice", "repo-one", 2, true),
		contribution("alice", "Alice", "repo-two", 3, true),
		contribution("bob", "Bob", "repo-one", 6, false),
		contribution("carol", "Carol", "repo-two", 1, false),
		...Array.from({ length: extraAuthors }, (_, i) =>
			contribution(`other-${i}`, `Other ${i}`, "repo-one", 1, false),
		),
	];
	return {
		filters,
		calculatedAt: NOW,
		coverage: "observed",
		totals: {
			...counts(5),
			contributors: 1,
			repositories: 2,
			lastCollectedAt: NOW,
		},
		members: [{ ...contributions[0]!, ...counts(5) }],
		repositories: [
			{
				key: "repo-one",
				id: "one",
				projectId: "project",
				name: "Frontend",
				...counts(8 + extraAuthors),
				contributors: 2 + extraAuthors,
				lastCollectedAt: NOW,
			},
			{
				key: "repo-two",
				id: "two",
				projectId: "project",
				name: "Service",
				...counts(4),
				contributors: 2,
				lastCollectedAt: NOW,
			},
		],
		contributions,
	};
}
function Location() {
	return <output aria-label="Location">{useLocation().search}</output>;
}
function page(path = "/insights") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<InsightsPage />
			<Location />
		</MemoryRouter>,
	);
}
beforeEach(() => {
	source = "cli";
	mode = "data";
	extraAuthors = 0;
	localStorage.clear();
	vi.clearAllMocks();
	vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
	vi.mocked(fetchDirectory).mockImplementation(async (requestedSource) => ({
		source: requestedSource,
		blockedContributorKeys: [],
		revision: 0,
		members: [],
		identities: [],
		teams: [],
		tags: [],
		projects: [],
		repositories: [],
	}));
	hook.mockImplementation((_source, filters) => ({
		report:
			filters && mode !== "loading"
				? mode === "empty"
					? {
							...report(filters),
							members: [],
							repositories: [],
							contributions: [],
						}
					: report(filters)
				: null,
		loading: mode === "loading",
		error: mode === "error" ? "Service unavailable" : null,
		calculating: mode === "progress",
		progress:
			mode === "progress"
				? "Discovering repositories: 1 / 2 tasks finished."
				: null,
		calculate,
		reload,
	}));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("shows cached cross-repository and all-author comparisons with one global Calculate", async () => {
	page();
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Calculate" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	expect(screen.getAllByRole("button", { name: "Calculate" })).toHaveLength(1);
	expect(calculate).not.toHaveBeenCalled();
	const contributor = screen.getByRole("table", {
		name: "Contributor repository counts",
	});
	expect(within(contributor).getByText("Frontend")).toBeTruthy();
	expect(within(contributor).getByText("Service")).toBeTruthy();
	expect(within(contributor).getByText("25.0%")).toBeTruthy();
	expect(within(contributor).getByText("75.0%")).toBeTruthy();
	expect(within(contributor).getByText("2 / 2")).toBeTruthy();
	const repository = screen.getByRole("table", {
		name: "Repository contributor counts",
	});
	expect(within(repository).getByText("Bob")).toBeTruthy();
	expect(within(repository).getByText("Alice")).toBeTruthy();
	expect(within(repository).getByText("75.0%")).toBeTruthy();
	expect(within(repository).getByText("25.0%")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
	expect(calculate).toHaveBeenCalledTimes(1);
});

it("uses the rolling 90-day range even when saved filters contain old dates", async () => {
	localStorage.setItem(
		"signoff-insights-filters:cli",
		JSON.stringify({
			from: "2020-01-01",
			to: "2020-01-30",
			audience: "followed",
		}),
	);
	page();
	await waitFor(() => expect(hook).toHaveBeenCalled());
	const filters = hook.mock.calls[hook.mock.calls.length - 1]?.[1];
	expect(filters?.audience).toBe("followed");
	expect(Date.parse(filters!.to!) - Date.parse(filters!.from!)).toBe(
		89 * 86400000,
	);
	expect(screen.queryByLabelText("Created from (UTC)")).toBeNull();
});

it("paginates every repository contributor without dropping unselected authors", async () => {
	extraAuthors = 24;
	page();
	const table = screen.getByRole("table", {
		name: "Repository contributor counts",
	});
	expect(within(table).getAllByRole("row")).toHaveLength(21);
	fireEvent.click(
		screen.getByRole("button", { name: "Next contributor page" }),
	);
	expect(within(table).getAllByRole("row")).toHaveLength(7);
	fireEvent.click(
		screen.getByRole("button", { name: "Previous contributor page" }),
	);
	expect(within(table).getByText("Bob")).toBeTruthy();
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Calculate" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
});

it("shows loading, meaningful empty results, retained data with errors, and global progress", async () => {
	mode = "loading";
	const view = page();
	expect(
		screen.getByRole("status", { name: "Loading contribution reports" }),
	).toBeTruthy();
	mode = "empty";
	view.rerender(
		<MemoryRouter>
			<InsightsPage />
		</MemoryRouter>,
	);
	expect(screen.getByText("No matching contributors")).toBeTruthy();
	expect(screen.getByText("No discovered repository PRs")).toBeTruthy();
	mode = "error";
	view.rerender(
		<MemoryRouter>
			<InsightsPage />
		</MemoryRouter>,
	);
	expect(screen.getByRole("alert").textContent).toContain(
		"Service unavailable",
	);
	expect(
		screen.getByRole("table", { name: "Contributor repository counts" }),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Reload cached report" }));
	expect(reload).toHaveBeenCalledOnce();
	mode = "progress";
	view.rerender(
		<MemoryRouter>
			<InsightsPage />
		</MemoryRouter>,
	);
	expect(screen.getByRole("status").textContent).toContain("1 / 2");
	expect(
		screen
			.getByRole("button", { name: "Calculating…" })
			.hasAttribute("disabled"),
	).toBe(true);
	await waitFor(() => expect(fetchDirectory).toHaveBeenCalled());
});

it("applies contributor links once and keeps the source boundary", async () => {
	const view = page(
		"/insights?source=cli&contributor=member%3Aalice&team=team-a&tag=tag-a&keep=1",
	);
	await waitFor(() =>
		expect(hook.mock.calls[hook.mock.calls.length - 1]?.[1]).toMatchObject({
			source: "cli",
			contributorKeys: ["member:alice"],
			teamIds: ["team-a"],
			tagIds: ["tag-a"],
		}),
	);
	expect(screen.getByLabelText("Location").textContent).toBe(
		"?source=cli&keep=1",
	);
	source = "demo";
	view.rerender(
		<MemoryRouter>
			<InsightsPage />
			<Location />
		</MemoryRouter>,
	);
	await waitFor(() =>
		expect(hook.mock.calls[hook.mock.calls.length - 1]?.[1]).toMatchObject({
			source: "demo",
			contributorKeys: [],
		}),
	);
	expect(calculate).not.toHaveBeenCalled();
});
