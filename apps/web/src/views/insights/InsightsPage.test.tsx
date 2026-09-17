import type {
	ContributionFilters,
	ContributionModule,
	ContributionSnapshot,
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
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	calculateContribution,
	fetchContribution,
} from "@/models/contributionsApi";
import { fetchDirectory } from "@/models/directoryApi";
import { InsightsPage } from "./InsightsPage";

let source: DataSource = "cli";
vi.mock("@/viewmodels/WorkbenchProvider", () => ({
	useWorkbench: () => ({ filter: { source } }),
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

const NOW = 1_789_646_400;
function saved(
	module: ContributionModule,
	filters: ContributionFilters,
): ContributionSnapshot {
	return {
		module,
		filters,
		calculatedAt: NOW,
		coverage: "observed",
		totals: {
			total: 5,
			open: 3,
			merged: 1,
			closed: 1,
			draft: 0,
			repositories: 1,
			contributors: 1,
			lastCollectedAt: NOW - 180,
		},
		trend: [
			{ day: "2026-09-17", total: 5, open: 3, merged: 1, closed: 1, draft: 0 },
		],
		members: [
			{
				key: "member:one",
				memberId: "one",
				name: "Casey Morgan",
				avatarUrl: null,
				teamIds: [],
				total: 5,
				open: 3,
				merged: 1,
				closed: 1,
				draft: 0,
				lastCollectedAt: NOW - 180,
			},
		],
		repositories: [],
	};
}
function Location() {
	return <output aria-label="Location">{useLocation().search}</output>;
}
beforeEach(() => {
	source = "cli";
	localStorage.clear();
	vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
	vi.mocked(fetchDirectory)
		.mockReset()
		.mockImplementation(async (value) => ({
			source: value,
			revision: 0,
			members: [],
			teams: [],
			tags: [],
			identities: [],
			projects: [],
			repositories: [],
		}));
	vi.mocked(fetchContribution).mockReset().mockResolvedValue(null);
	vi.mocked(calculateContribution)
		.mockReset()
		.mockImplementation(async (module, filters) => saved(module, filters));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("loads saved modules, calculates each independently, and never recalculates when filters change", async () => {
	render(
		<MemoryRouter>
			<InsightsPage />
		</MemoryRouter>,
	);
	await waitFor(() => expect(fetchContribution).toHaveBeenCalledTimes(4));
	expect(calculateContribution).not.toHaveBeenCalled();
	expect(
		screen.getByRole("heading", { level: 1, name: "Contributions" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Calculate PR overview" }),
	);
	await screen.findByRole("button", { name: "Refresh PR overview" });
	expect(calculateContribution).toHaveBeenCalledTimes(1);
	expect(calculateContribution).toHaveBeenLastCalledWith(
		"overview",
		expect.objectContaining({ includeDraft: false }),
	);
	expect(
		screen.getByRole("button", { name: "Calculate Member contributions" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Calculate Member contributions" }),
	);
	const table = await screen.findByRole("table", {
		name: "Member contribution counts",
	});
	expect(within(table).getByText("Casey Morgan")).toBeTruthy();
	fireEvent.click(screen.getByRole("switch", { name: "Include drafts" }));
	await waitFor(() =>
		expect(fetchContribution).toHaveBeenLastCalledWith(
			"repositories",
			expect.objectContaining({ includeDraft: true }),
		),
	);
	expect(calculateContribution).toHaveBeenCalledTimes(2);
});

it("consumes a directory contribution link once, clearing unrelated scope while retaining dates and source isolation", async () => {
	localStorage.setItem(
		"signoff-insights-filters:cli",
		JSON.stringify({
			from: "2026-09-01",
			to: "2026-09-17",
			projectIds: ["old"],
			repositoryKeys: ["old"],
			teamIds: ["old"],
			tagIds: ["old"],
			contributorKeys: ["old"],
			audience: "followed",
		}),
	);
	const tree = (
		<MemoryRouter
			initialEntries={["/insights?source=cli&contributor=member:one"]}
		>
			<InsightsPage />
			<Location />
		</MemoryRouter>
	);
	const { rerender } = render(tree);
	await waitFor(() =>
		expect(fetchContribution).toHaveBeenCalledWith(
			"overview",
			expect.objectContaining({
				source: "cli",
				from: "2026-09-01",
				to: "2026-09-17",
				contributorKeys: ["member:one"],
				projectIds: [],
				repositoryKeys: [],
				teamIds: [],
				tagIds: [],
				audience: "all",
			}),
		),
	);
	expect(screen.getByLabelText("Location").textContent).toBe("?source=cli");
	source = "demo";
	rerender(
		<MemoryRouter
			initialEntries={["/insights?source=cli&contributor=member:one"]}
		>
			<InsightsPage />
			<Location />
		</MemoryRouter>,
	);
	await waitFor(() =>
		expect(fetchContribution).toHaveBeenLastCalledWith(
			"repositories",
			expect.objectContaining({ source: "demo", contributorKeys: [] }),
		),
	);
	expect(calculateContribution).not.toHaveBeenCalled();
});
