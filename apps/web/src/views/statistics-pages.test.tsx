import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHeatmap, fetchTimeline } from "@/models/activityApi";
import {
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { fetchSettings } from "@/models/settingsApi";
import type { StatsSummary } from "@/models/stats";
import { fetchStatsSummary } from "@/models/statsApi";
import { ActivityPage } from "./activity/ActivityPage";
import { DashboardPage } from "./DashboardPage";

vi.mock("@/models/entitiesApi", () => ({
	listDevelopers: vi.fn(),
	listRepos: vi.fn(),
	listTags: vi.fn(),
	listTeams: vi.fn(),
}));
vi.mock("@/models/settingsApi", () => ({ fetchSettings: vi.fn() }));
vi.mock("@/models/statsApi", () => ({ fetchStatsSummary: vi.fn() }));
vi.mock("@/models/activityApi", () => ({
	fetchHeatmap: vi.fn(),
	fetchTimeline: vi.fn(),
}));
// Check the data contract passed to the library; chart layout is checked in Chrome.
vi.mock("@nocoo/basalt/charts/bar", () => ({
	BarChart: ({
		data,
		series,
		ariaLabel,
	}: {
		data: unknown;
		series: unknown;
		ariaLabel: string;
	}) => (
		<output aria-label={ariaLabel}>{JSON.stringify({ data, series })}</output>
	),
}));

const summary: StatsSummary = {
	pipelineConfigVersion: 1,
	scoresStale: false,
	staleReason: null,
	window: { from: "2026-08-21", to: "2026-09-17" },
	totals: { activities: 5, score: 40, activeDevelopers: 1 },
	byType: [
		{ type: "pr.merged", count: 3, score: 30 },
		{ type: "pr.vote", count: 2, score: 10 },
	],
	topDevelopers: [
		{
			developerId: "d1",
			name: "Ada",
			avatarUrl: null,
			score: 40,
			activityCount: 5,
		},
	],
	daily: [{ dayKey: "2026-09-16", score: 40, activityCount: 5 }],
	lastIngestAt: 1,
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(listDevelopers).mockResolvedValue([]);
	vi.mocked(listRepos).mockResolvedValue([]);
	vi.mocked(listTags).mockResolvedValue([]);
	vi.mocked(listTeams).mockResolvedValue([]);
	vi.mocked(fetchSettings).mockResolvedValue({
		timezone: "Asia/Shanghai",
		emailSuffixes: [],
		activityWeights: {},
		pipelineConfigVersion: 1,
		scoresStale: false,
		scoresStaleReason: null,
	});
	vi.mocked(fetchStatsSummary).mockImplementation(async (window) => ({
		...summary,
		window: window ?? summary.window,
	}));
});
afterEach(() => vi.useRealTimers());

describe("Dashboard charts", () => {
	it("keeps zero days, scores, event counts, preset windows and developer links", async () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);
		const chart = await screen.findByLabelText("Daily activity");
		const daily = JSON.parse(chart.textContent ?? "{}");
		expect(daily.data).toHaveLength(28);
		expect(daily.data[0]).toEqual({ x: "2026-08-21", score: 0, events: 0 });
		expect(daily.data[26]).toEqual({ x: "2026-09-16", score: 40, events: 5 });
		const byType = JSON.parse(
			screen.getByLabelText("Activity by type").textContent ?? "{}",
		);
		expect(byType.data).toEqual([
			{ x: "pr.merged", score: 30, events: 3 },
			{ x: "pr.vote", score: 10, events: 2 },
		]);
		expect(screen.getByRole("link", { name: /Ada/ }).getAttribute("href")).toBe(
			"/activity?dev=d1",
		);
		fireEvent.click(screen.getByText("Last 7 days"));
		await waitFor(() =>
			expect(fetchStatsSummary).toHaveBeenLastCalledWith({
				from: "2026-09-11",
				to: "2026-09-17",
			}),
		);
	});

	it("withholds stale numbers and retries after an error", async () => {
		vi.mocked(fetchStatsSummary).mockRejectedValueOnce(
			new Error("Statistics unavailable"),
		);
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);
		await screen.findByText("Statistics unavailable");
		expect(screen.queryByLabelText("Daily activity")).toBeNull();
		vi.mocked(fetchStatsSummary).mockResolvedValueOnce({
			...summary,
			scoresStale: true,
			staleReason: "weights changed",
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("Numbers withheld");
		expect(screen.queryByLabelText("Daily activity")).toBeNull();
		expect(screen.queryByRole("table", { name: "Top developers" })).toBeNull();
	});
});

it("uses calendar dates for heatmaps and preserves multi-day timeline pages", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
	vi.mocked(fetchHeatmap).mockResolvedValue({
		pipelineConfigVersion: 1,
		scoresStale: false,
		staleReason: null,
		rows: [
			{ developerId: "d1", dayKey: "2026-09-16", total: 40, activityCount: 5 },
		],
	});
	const item = {
		id: "a1",
		type: "pr.merged",
		dayKey: "2026-09-17",
		occurredAt: 123,
		org: "contoso",
		project: "Tools",
		repoId: "repo-1",
		meta: {},
	};
	vi.mocked(fetchTimeline)
		.mockResolvedValueOnce({
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			items: [item],
			nextCursor: "page-2",
		})
		.mockResolvedValueOnce({
			pipelineConfigVersion: 1,
			scoresStale: false,
			staleReason: null,
			items: [{ ...item, id: "a2", dayKey: "2026-09-16", repoId: null }],
			nextCursor: null,
		});
	render(<ActivityPage />);
	fireEvent.change(screen.getByLabelText("Developer ids"), {
		target: { value: "d1" },
	});
	fireEvent.click(screen.getByLabelText("From"));
	fireEvent.click(screen.getByRole("button", { name: "2026-09-16" }));
	fireEvent.click(screen.getByLabelText("To"));
	fireEvent.click(screen.getByRole("button", { name: "2026-09-17" }));
	fireEvent.click(screen.getByRole("button", { name: "Load heatmap" }));
	await screen.findByRole("table", { name: "Daily developer scores" });
	expect(fetchHeatmap).toHaveBeenCalledWith({
		devs: ["d1"],
		from: "2026-09-16",
		to: "2026-09-17",
	});
	fireEvent.click(screen.getByRole("button", { name: "Load timeline" }));
	const timeline = await screen.findByRole("list", {
		name: "Developer activity timeline",
	});
	expect(timeline.textContent).toContain("2026-09-17 · 123");
	expect(timeline.textContent).toContain(
		"pr.merged · contoso / Tools · repo-1",
	);
	fireEvent.click(screen.getByRole("button", { name: "Load more" }));
	await waitFor(() =>
		expect(within(timeline).getAllByRole("listitem")).toHaveLength(2),
	);
	expect(timeline.textContent).toContain("2026-09-16 · 123");
	expect(fetchTimeline).toHaveBeenLastCalledWith({
		dev: "d1",
		from: "2026-09-16",
		to: "2026-09-17",
		cursor: "page-2",
	});
	vi.mocked(fetchHeatmap).mockResolvedValueOnce({
		pipelineConfigVersion: 2,
		scoresStale: true,
		staleReason: "rematch",
		rows: [],
	});
	fireEvent.click(screen.getByRole("button", { name: "Load heatmap" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("list", { name: "Developer activity timeline" }),
		).toBeNull(),
	);
});
