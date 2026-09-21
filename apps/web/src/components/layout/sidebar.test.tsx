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
	loadCollectorGroups,
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
	| "listCooldownSeconds"
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
	listCooldownSeconds: 600,
	setRefreshCooldown: vi.fn(async () => true),
	projects: [],
	repositories: [],
};
vi.mock("@/models/monitoringApi", () => ({
	loadCollectionJob: vi.fn(),
	loadCollectorGroups: vi.fn(),
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
	vi.mocked(loadCollectorGroups).mockResolvedValue({
		data: [],
		nextCursor: null,
		generatedAt: new Date(fixtureNow * 1000).toISOString(),
	});
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

const group = (task = fixtureJob()) => ({
	id: "pr:watch-1",
	kind: "refresh" as const,
	projectId: task.projectId,
	projectName: "Intent",
	target: null,
	active: true,
	cooldownSeconds: 300,
	lastCompletedAt: task.completedAt,
	nextRunAt: task.completedAt
		? new Date(Date.parse(task.completedAt) + 300000).toISOString()
		: null,
	latest: { ...task, projectName: "Intent", target: null },
});
const seedGroup = (task = fixtureJob()) => {
	vi.mocked(loadCollectorGroups).mockResolvedValue({
		data: [group(task)],
		nextCursor: null,
		generatedAt: new Date(fixtureNow * 1000).toISOString(),
	});
	vi.mocked(loadCollectorHistory).mockResolvedValue({
		data: [{ ...task, projectName: "Intent", target: null }],
		nextCursor: null,
	});
	vi.mocked(loadCollectionJob).mockResolvedValue(task);
};
it("keeps the sidebar compact and configures both task cooldowns in the dialog", async () => {
	renderSidebar();
	expect(within(panel()).getByText("Online")).toBeTruthy();
	expect(within(panel()).queryByRole("combobox")).toBeNull();
	expect(loadCollectorGroups).not.toHaveBeenCalled();
	openDetails();
	const dialog = await screen.findByRole("dialog", {
		name: "Collector details",
	});
	await within(dialog).findByText("No projects or watched PRs.");
	fireEvent.click(
		within(dialog).getByRole("combobox", {
			name: "Project discovery cooldown",
		}),
	);
	fireEvent.click(screen.getByRole("option", { name: "2 min" }));
	expect(vm.setRefreshCooldown).toHaveBeenCalledWith("list", 120);
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
it("shows group history and the returned result of the selected attempt", async () => {
	const task = fixtureJob({
		state: "partial",
		message: "Build 123 unavailable",
		error: "unavailable",
		phase: "builds",
		events: [
			{
				id: "event",
				at: fixtureNow,
				phase: "builds",
				state: "running",
				message: "Reading builds and stages",
			},
		],
	});
	vm.collector!.jobs = [task];
	seedGroup(task);
	renderSidebar();
	expect(within(panel()).getByText("Partial data")).toBeTruthy();
	openDetails();
	fireEvent.click(
		await screen.findByRole("button", { name: /Intent Incomplete/ }),
	);
	const history = await screen.findByRole("region", { name: "PR job history" });
	fireEvent.click(
		await within(history).findByRole("button", { expanded: false }),
	);
	await within(history).findByText("Error: unavailable");
	expect(within(history).getByText(/Reading builds and stages/)).toBeTruthy();
	expect(loadCollectorHistory).toHaveBeenCalledWith(
		"cli",
		expect.objectContaining({ group: "pr:watch-1" }),
		expect.any(AbortSignal),
	);
});
it("shows connection errors without dropping cached watch counts", async () => {
	vm.collectionError = "Local Worker unavailable";
	vm.collector!.watching = 16;
	renderSidebar();
	expect(panel().textContent).toContain("16 watching");
	openDetails();
	expect(await screen.findByText("Local Worker unavailable")).toBeTruthy();
});
it("retries group loading independently of connector health", async () => {
	vi.mocked(loadCollectorGroups).mockRejectedValueOnce(
		new Error("History unavailable"),
	);
	renderSidebar();
	openDetails();
	await screen.findByText("History unavailable");
	fireEvent.click(
		screen.getByRole("button", { name: "Reload collection jobs" }),
	);
	await screen.findByText("No projects or watched PRs.");
});
it("keeps the PR group and history expanded when its running job completes", async () => {
	const task = fixtureJob({
		state: "running",
		completedAt: null,
		progress: { completed: 3, total: 8 },
		message: "Reading builds and stages",
	});
	seedGroup(task);
	renderSidebar();
	openDetails();
	const row = await screen.findByRole("button", { name: /Intent Running/ });
	fireEvent.click(row);
	await screen.findByRole("region", { name: "PR job history" });
	seedGroup({
		...task,
		state: "succeeded",
		completedAt: new Date(fixtureNow * 1000).toISOString(),
	});
	fireEvent.click(
		screen.getByRole("button", { name: "Reload collection jobs" }),
	);
	const finished = await screen.findByRole("button", {
		name: /Intent Succeeded/,
	});
	expect(finished).toBe(row);
	expect(finished.getAttribute("aria-expanded")).toBe("true");
	expect(screen.getByRole("region", { name: "PR job history" })).toBeTruthy();
});
