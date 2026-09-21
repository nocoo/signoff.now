import { TooltipProvider } from "@nocoo/basalt";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	loadCollectionJob,
	loadCollectorHistory,
} from "@/models/monitoringApi";
import { DEFAULT_PULL_FILTER } from "@/models/workbench";
import {
	fixtureJob,
	fixtureNow,
	queryFixture,
} from "@/test/monitoring-fixture";
import type { WorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";
import { Sidebar } from "./sidebar";

const vm: Pick<
	WorkbenchViewModel,
	| "filter"
	| "collector"
	| "connection"
	| "collectionError"
	| "feedbackKind"
	| "mutationError"
	| "notice"
	| "busy"
	| "detailCooldownSeconds"
	| "setRefreshCooldown"
	| "projects"
	| "repositories"
> = {
	filter: { ...DEFAULT_PULL_FILTER, source: "cli" },
	collector: queryFixture().collector,
	connection: queryFixture().collector.connection,
	collectionError: null,
	feedbackKind: "other",
	mutationError: null,
	notice: null,
	busy: null,
	detailCooldownSeconds: 300,
	setRefreshCooldown: vi.fn(async () => true),
	projects: [],
	repositories: [],
};
vi.mock("@/models/monitoringApi", () => ({
	loadCollectionJob: vi.fn(),
	loadCollectorHistory: vi.fn(),
}));
vi.mock("@/viewmodels/WorkbenchProvider", () => ({ useWorkbench: () => vm }));
beforeEach(() => {
	vm.collector = queryFixture().collector;
	vm.connection = vm.collector.connection;
	vm.collectionError = null;
	vm.feedbackKind = "other";
	vm.mutationError = null;
	vm.notice = null;
	vm.busy = null;
	vm.detailCooldownSeconds = 300;
	vm.filter = { ...DEFAULT_PULL_FILTER, source: "cli" };
	vm.projects = [];
	vm.repositories = [];
	vi.clearAllMocks();
	vi.mocked(loadCollectorHistory).mockResolvedValue({
		data: [],
		nextCursor: null,
	});
	vi.mocked(loadCollectionJob).mockResolvedValue(fixtureJob());
});
afterEach(cleanup);
const renderSidebar = (collapsed = false, onToggle = vi.fn()) =>
	render(
		<MemoryRouter>
			<TooltipProvider>
				<Sidebar collapsed={collapsed} onToggle={onToggle} userLabel="Dev" />
			</TooltipProvider>
		</MemoryRouter>,
	);

const panel = () => screen.getByRole("region", { name: "Connector status" });
const openDetails = () =>
	fireEvent.click(
		within(panel()).getByRole("button", { name: /Open details and history/ }),
	);

it("keeps the sidebar compact and moves settings and history into the dialog", async () => {
	renderSidebar();
	expect(within(panel()).getByText("Online")).toBeTruthy();
	expect(within(panel()).queryByRole("combobox")).toBeNull();
	expect(loadCollectorHistory).not.toHaveBeenCalled();
	openDetails();
	const dialog = await screen.findByRole("dialog", {
		name: "Collector details",
	});
	expect(within(dialog).getByText("Current work")).toBeTruthy();
	await within(dialog).findByText("No completed tasks match these filters.");
	fireEvent.click(
		within(dialog).getByRole("combobox", {
			name: "Watched PR refresh cooldown",
		}),
	);
	fireEvent.click(screen.getByRole("option", { name: "10 min" }));
	expect(vm.setRefreshCooldown).toHaveBeenCalledWith("details", 600);
	fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
	expect(screen.queryByRole("dialog")).toBeNull();
});
it("opens details directly from a collapsed sidebar", async () => {
	const expand = vi.fn();
	renderSidebar(true, expand);
	openDetails();
	expect(await screen.findByRole("dialog")).toBeTruthy();
	expect(expand).not.toHaveBeenCalled();
});
it("distinguishes partial collection from connectivity failure and exposes complete task evidence", async () => {
	const task = fixtureJob({
		state: "partial",
		message: "Build 123 is unavailable",
		error: "unavailable",
	});
	vm.collector!.jobs = [task];
	vi.mocked(loadCollectorHistory).mockResolvedValue({
		data: [{ ...task, projectName: "Intent", target: null }],
		nextCursor: "older",
	});
	vi.mocked(loadCollectionJob).mockResolvedValue({
		...task,
		repositories: [
			{
				repository: { id: "repo", name: "whiteboard-app" },
				state: "failed",
				pullCount: null,
				error: "Build expired",
			},
		],
	});
	renderSidebar();
	expect(within(panel()).getByText("Partial data")).toBeTruthy();
	expect(panel().textContent).not.toContain("Build 123 is unavailable");
	openDetails();
	const history = await screen.findByRole("region", {
		name: "Collection history",
	});
	fireEvent.click(
		await within(history).findByRole("button", { name: /Intent/ }),
	);
	await within(history).findByText(/Build expired/);
	expect(within(history).getByText("Build 123 is unavailable")).toBeTruthy();
	expect(within(history).getByText("Error: unavailable")).toBeTruthy();
	fireEvent.click(within(history).getByRole("button", { name: "Older" }));
	await within(history).findByText(/Page 2/);
	fireEvent.click(
		within(history).getByRole("combobox", { name: "History result" }),
	);
	fireEvent.click(screen.getByRole("option", { name: "Issues only" }));
	await within(history).findByText(/Page 1/);
});
it("shows connection errors clearly and retains the cached watch count", async () => {
	vm.collectionError = "Local Worker unavailable";
	vm.collector!.watching = 16;
	renderSidebar();
	expect(panel().textContent).toContain("Unavailable");
	expect(panel().textContent).toContain("16 watching");
	openDetails();
	expect(await screen.findByText("Local Worker unavailable")).toBeTruthy();
});
it("reports history errors with a retry control without hiding current health", async () => {
	vi.mocked(loadCollectorHistory).mockRejectedValueOnce(
		new Error("History unavailable"),
	);
	renderSidebar();
	openDetails();
	await screen.findByText("History unavailable");
	fireEvent.click(
		screen.getByRole("button", { name: "Reload collection history" }),
	);
	await screen.findByText("No completed tasks match these filters.");
});
it("shows current progress and freshness in the dialog", async () => {
	vm.collector!.queue.running = 1;
	vm.collector!.jobs = [
		fixtureJob({
			state: "running",
			completedAt: null,
			progress: { completed: 3, total: 8 },
			lane: "status",
		}),
	];
	vm.collector!.scheduling = {
		strategy: "per_pr",
		checksConcurrency: 2,
		statusConcurrency: 2,
		nextCheckDueAt: null,
		oldestChecksAgeSeconds: 420,
		oldestSummaryAgeSeconds: 20,
		overdueChecks: 2,
		missingChecks: 1,
	};
	vm.collector!.generatedAt = new Date(fixtureNow * 1000).toISOString();
	renderSidebar();
	expect(within(panel()).getByText("Checking PR state")).toBeTruthy();
	openDetails();
	const work = await screen.findByRole("region", {
		name: "Current collection work",
	});
	expect(work.textContent).toContain("3 / 8");
	expect(screen.getByText("Oldest checks")).toBeTruthy();
});
