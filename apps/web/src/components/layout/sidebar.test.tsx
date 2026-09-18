import { TooltipProvider } from "@nocoo/basalt";
import type { JobQueryItem } from "@signoff/domain/query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PULL_FILTER } from "@/models/workbench";
import { fixtureProject, iso, queryFixture } from "@/test/monitoring-fixture";
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
function job(overrides: Partial<JobQueryItem> = {}): JobQueryItem {
	return {
		id: "job-1",
		source: "live",
		kind: "refresh",
		state: "running",
		projectId: fixtureProject.id,
		projectRevision: 1,
		scope: [],
		reason: null,
		error: null,
		message: "Collecting",
		requestedAt: iso(Date.now() / 1000 - 30),
		startedAt: iso(Date.now() / 1000 - 20),
		updatedAt: iso(Date.now() / 1000),
		completedAt: null,
		notBefore: iso(Date.now() / 1000),
		progress: { completed: 3, total: 8 },
		observation: { id: "watch-1", generation: 1 },
		repositories: [],
		...overrides,
	};
}

it("keeps one connector panel and refresh control above the sidebar user while idle", () => {
	renderSidebar();
	const status = panel();
	expect(status.closest("aside")).not.toBeNull();
	expect(
		status.compareDocumentPosition(screen.getByText("Dev")) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).not.toBe(0);
	expect(within(status).getByText("Online")).toBeTruthy();
	expect(within(status).getByText("Ready to watch")).toBeTruthy();
	expect(within(status).queryByRole("progressbar")).toBeNull();
	fireEvent.click(
		within(status).getByRole("combobox", {
			name: "Watched PR refresh cooldown",
		}),
	);
	fireEvent.click(screen.getByRole("option", { name: "10 min" }));
	expect(vm.setRefreshCooldown).toHaveBeenCalledWith("details", 600);
});
it("keeps connection failures visible without hiding the connector or cached counts", () => {
	vm.collectionError = "Collector unavailable";
	vm.collector!.watching = 6;
	renderSidebar();
	const status = panel();
	expect(status.textContent).toContain("Collector unavailable");
	expect(within(status).getByText("Unavailable")).toBeTruthy();
	expect(
		within(status).getByText("Watching").parentElement?.textContent,
	).toContain("6");
	expect(within(status).queryByRole("progressbar")).toBeNull();
});
it("does not present unrelated watch errors as cooldown save failures", () => {
	vm.feedbackKind = "watch";
	vm.mutationError = "Watch could not be added";
	renderSidebar();
	expect(screen.queryByText(vm.mutationError)).toBeNull();
	expect(within(panel()).getByText("Online")).toBeTruthy();
});
it("keeps a compact status above the avatar when collapsed", () => {
	vm.collectionError = "Collector unavailable";
	const expand = vi.fn();
	renderSidebar(true, expand);
	fireEvent.click(
		screen.getByRole("button", {
			name: /Connector unavailable.*Expand sidebar for details/i,
		}),
	);
	expect(expand).toHaveBeenCalledOnce();
});
it("shows queue totals and real task progress without treating queued work as running", () => {
	vm.collector!.watching = 16;
	vm.collector!.queue = { running: 1, queued: 4, authRequired: 0 };
	vm.collector!.jobs = [job()];
	const view = renderSidebar();
	expect(within(panel()).getByText("Refreshing PR checks")).toBeTruthy();
	expect(
		within(panel()).getByText("Running").parentElement?.textContent,
	).toContain("1");
	expect(
		within(panel()).getByText("Queued").parentElement?.textContent,
	).toContain("4");
	expect(
		within(panel()).getByRole("progressbar").getAttribute("aria-valuenow"),
	).toBe("3");
	expect(
		within(panel()).getByRole("progressbar").getAttribute("aria-valuemax"),
	).toBe("8");
	vm.collector!.queue = { running: 0, queued: 4, authRequired: 0 };
	vm.collector!.jobs = [job({ state: "queued" })];
	view.rerender(
		<MemoryRouter>
			<TooltipProvider>
				<Sidebar collapsed={false} onToggle={vi.fn()} userLabel="Dev" />
			</TooltipProvider>
		</MemoryRouter>,
	);
	expect(within(panel()).getByText("Waiting to start")).toBeTruthy();
	expect(within(panel()).queryByRole("progressbar")).toBeNull();
});
it("shows discovery as indeterminate when the provider has not reported a total", () => {
	vm.collector!.queue.running = 1;
	vm.collector!.jobs = [
		job({ kind: "discover", progress: { completed: 32, total: null } }),
	];
	renderSidebar();
	expect(within(panel()).getByText("Discovering PRs")).toBeTruthy();
	expect(
		within(panel()).getByRole("progressbar").hasAttribute("aria-valuenow"),
	).toBe(false);
	expect(panel().textContent).toContain("32 collected");
});
it.each([
	"offline",
	"auth_required",
	"error",
] as const)("pauses the operation display while the connector is %s", (state) => {
	vm.connection = {
		state,
		lastSeenAt: null,
		message: "Connection needs attention",
	};
	vm.collector!.queue.running = 1;
	vm.collector!.jobs = [job()];
	renderSidebar();
	expect(within(panel()).queryByRole("progressbar")).toBeNull();
	expect(panel().textContent).toContain("Connection needs attention");
});
it("shows running checks alongside a different project's authentication warning", () => {
	vm.connection = {
		state: "auth_required",
		lastSeenAt: iso(Date.now() / 1000),
		message: "Project A needs sign-in",
	};
	vm.collector!.queue = { running: 1, queued: 0, authRequired: 1 };
	vm.collector!.jobs = [
		job({ state: "auth_required", message: "Project A needs sign-in" }),
		job({ id: "job-2", projectId: "another-project" }),
	];
	renderSidebar();
	expect(within(panel()).getByText("Sign-in required")).toBeTruthy();
	expect(within(panel()).getByText("Refreshing PR checks")).toBeTruthy();
	expect(
		within(panel()).getByRole("progressbar").getAttribute("aria-valuenow"),
	).toBe("3");
	expect(panel().textContent).toContain("Project A needs sign-in");
	expect(panel().textContent).not.toContain("Collection paused");
});
it("distinguishes initial status loading and sample data from a connected live collector", () => {
	vm.collector = null;
	vm.filter.source = "demo";
	renderSidebar();
	expect(within(panel()).getByText("Connecting")).toBeTruthy();
	expect(within(panel()).getByText("Sample")).toBeTruthy();
});
it("does not claim a scheduled round when automatic checks are disabled", () => {
	vm.collector!.watching = 2;
	vm.detailCooldownSeconds = 0;
	renderSidebar();
	expect(within(panel()).getByText("Manual checks")).toBeTruthy();
});
it.each([
	[180, "Next check in 3 min", true],
	[30, "Next check in <1 min", true],
	[-10, "Next check due", true],
	[180, "Next check in 3 min", false],
] as const)("uses source-wide watched rounds despite PR filters and legacy enabled flags (%s seconds, %s, enabled %s)", (seconds, label, enabled) => {
	const repo = queryFixture().catalog.data[0]!;
	const repositories = [
		{
			key: repo.key,
			id: repo.repository.id!,
			identityResolved: true,
			name: repo.repository.name,
			project: { ...fixtureProject, enabled: Boolean(enabled) },
			metrics: { ...repo.counts, watching: 2 },
			total: 2,
			url: repo.repository.url,
			coverage: repo.coverage,
			lastDiscoveredAt: repo.lastDiscoveredAt,
		},
	];
	vm.repositories = [];
	vm.projects = [
		{
			project: repositories[0]!.project,
			repositories,
			metrics: { ...repo.counts },
			total: 2,
			job: null,
			scans: [],
		},
	];
	vm.filter.organization = "another-organization";
	vm.collector!.watching = 2;
	vm.collector!.rounds = [
		{
			projectId: "unwatched-project",
			roundId: null,
			lastCompletedAt: null,
			nextDueAt: iso(Date.now() / 1000 - 120),
		},
		{
			projectId: fixtureProject.id,
			roundId: null,
			lastCompletedAt: null,
			nextDueAt: iso(Math.floor(Date.now() / 1000) + Number(seconds)),
		},
	];
	renderSidebar();
	expect(within(panel()).getByText(label)).toBeTruthy();
});
it("retains a recent failed watch when a different watch in the project succeeds", () => {
	vm.collector!.jobs = [
		job({ state: "failed", message: "Build status could not be read" }),
		job({
			id: "job-2",
			state: "succeeded",
			requestedAt: iso(Date.now() / 1000),
			observation: { id: "different-watch", generation: 1 },
		}),
	];
	renderSidebar();
	expect(within(panel()).getByText("Needs attention")).toBeTruthy();
	expect(panel().textContent).toContain("Build status could not be read");
});
