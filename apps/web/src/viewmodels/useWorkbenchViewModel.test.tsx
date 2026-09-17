import { demoWorkspace } from "@signoff/domain/demo";
import type {
	Project,
	ProjectWrite,
	Workbench,
} from "@signoff/domain/workbench";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PULL_FILTER,
	PULL_FILTER_STORAGE_KEY,
} from "@/models/workbench";
import {
	createProject,
	deleteProject,
	loadWorkbench,
	patchProject,
	patchReadiness,
	scanProject,
} from "@/models/workbenchApi";
import { usePageCollection } from "./usePageCollection";
import {
	useProjectFormViewModel,
	useWorkbenchViewModel,
} from "./useWorkbenchViewModel";

vi.mock("@/models/workbenchApi", () => ({
	createProject: vi.fn(),
	deleteProject: vi.fn(),
	loadWorkbench: vi.fn(),
	patchProject: vi.fn(),
	patchReadiness: vi.fn(),
	scanProject: vi.fn(),
}));
const NOW = 1_800_000_000;
const snapshot = (): Workbench => ({
	...demoWorkspace(NOW),
	demoMode: true,
	fetchedAt: NOW,
	truncated: false,
});
const project = snapshot().projects[0];
const draft: ProjectWrite = {
	provider: "ado",
	name: "Core",
	organization: "northstar",
	projectKey: "Platform",
	description: "Services",
	owner: "Maya",
	enabled: true,
	repositories: [],
};

function pending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((fulfill, fail) => {
		resolve = fulfill;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function mount(entry = "/") {
	return renderHook(
		() => ({
			...useWorkbenchViewModel(),
			location: useLocation(),
			navigate: useNavigate(),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
			),
		},
	);
}
async function loaded(entry = "/") {
	const hook = mount(entry);
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
}
beforeEach(() => {
	localStorage.clear();
	vi.mocked(loadWorkbench).mockReset().mockResolvedValue(snapshot());
	vi.mocked(createProject).mockReset().mockResolvedValue(project);
	vi.mocked(patchProject).mockReset().mockResolvedValue(project);
	vi.mocked(patchReadiness).mockReset().mockResolvedValue(project);
	vi.mocked(deleteProject).mockReset().mockResolvedValue(undefined);
	vi.mocked(scanProject)
		.mockReset()
		.mockResolvedValue({ ...snapshot().scans[0], advancedStages: 2 });
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("workbench loading and URL state", () => {
	it.each([
		"leave page",
		"hide tab",
		"turn Off",
		"change interval",
		"change filters",
		"next page",
	])("cancels the remaining automatic requests after %s while a POST is pending", async (trigger) => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW * 1000);
		const data = snapshot();
		data.projects = data.projects
			.filter((p) => p.provider === "ado")
			.map((p) => ({ ...p, source: "cli", lastScannedAt: NOW }));
		data.pullRequests = data.pullRequests.map((pull) => ({
			...pull,
			checksObservedAt: NOW - 180,
		}));
		data.collector = { lastSeenAt: NOW, state: "ready", message: "Connected" };
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const first = pending<Awaited<ReturnType<typeof scanProject>>>();
		vi.mocked(scanProject).mockReturnValueOnce(first.promise);
		const hook = renderHook(
			() => {
				const vm = useWorkbenchViewModel();
				const location = useLocation();
				const navigate = useNavigate();
				usePageCollection(
					vm.collectPage,
					location.pathname === "/" && vm.autoRefresh && !vm.loading,
					JSON.stringify([location.search, vm.refreshInterval]),
				);
				return { vm, navigate };
			},
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<MemoryRouter>{children}</MemoryRouter>
				),
			},
		);
		await act(async () => {});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(600);
		});
		expect(scanProject).toHaveBeenCalledTimes(1);
		act(() => {
			if (trigger === "leave page") hook.result.current.navigate("/projects");
			if (trigger === "hide tab")
				vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
			if (trigger === "turn Off") hook.result.current.vm.setRefreshInterval(0);
			if (trigger === "change interval")
				hook.result.current.vm.setRefreshInterval(600);
			if (trigger === "change filters")
				hook.result.current.vm.setFilter({ projectId: data.projects[0]!.id });
			if (trigger === "next page") hook.result.current.vm.setPage(2);
		});
		await act(async () => {
			first.resolve(data.scans[0]!);
			await first.promise;
		});
		expect(scanProject).toHaveBeenCalledTimes(1);
	});
	it("defaults refresh to two minutes and persists the configured interval including Off", async () => {
		const first = await loaded();
		expect(first.result.current.refreshInterval).toBe(120);
		act(() => first.result.current.setRefreshInterval(300));
		first.unmount();
		const second = await loaded();
		expect(second.result.current.refreshInterval).toBe(300);
		act(() => second.result.current.setRefreshInterval(0));
		second.unmount();
		const third = await loaded();
		expect(third.result.current.refreshInterval).toBe(0);
		expect(third.result.current.autoRefresh).toBe(false);
	});
	it.each([
		"",
		"invalid",
		"-1",
		"Infinity",
		"30",
	])("restores the two-minute default for invalid saved interval %s", async (value) => {
		localStorage.setItem("signoff-auto-refresh-seconds", value);
		const { result } = await loaded();
		expect(result.current.refreshInterval).toBe(120);
	});
	it("uses the selected interval for both lists and checks while loading missing checks immediately", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		const data = snapshot();
		data.projects = [
			{ ...data.projects[0]!, source: "cli", lastScannedAt: NOW - 180 },
		];
		data.collector = { lastSeenAt: NOW, state: "ready", message: "Connected" };
		data.pullRequests = data.pullRequests.map((pull) => ({
			...pull,
			checksObservedAt: NOW - 180,
		}));
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const { result } = await loaded();
		act(() => result.current.setRefreshInterval(600));
		await act(() => result.current.collectPage());
		expect(scanProject).not.toHaveBeenCalled();
		const target = result.current.pageRows[0]!.pull.id;
		vi.mocked(loadWorkbench).mockResolvedValue({
			...data,
			pullRequests: data.pullRequests.map((pull) =>
				pull.id === target ? { ...pull, checksObservedAt: null } : pull,
			),
		});
		await act(() => result.current.reload());
		await act(() => result.current.collectPage());
		expect(scanProject).toHaveBeenCalledWith(
			data.projects[0]!.id,
			data.projects[0]!.revision,
			[target],
		);
		vi.mocked(scanProject).mockClear();
		vi.spyOn(Date, "now").mockReturnValue((NOW + 20) * 1000);
		act(() => result.current.setRefreshInterval(120));
		await act(() => result.current.collectPage());
		expect(scanProject).toHaveBeenCalledWith(
			data.projects[0]!.id,
			data.projects[0]!.revision,
			[],
		);
	});
	it("prioritizes an open detail's checks even when its project is outside the table filters", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		const data = snapshot();
		data.projects = data.projects
			.filter((p) => p.provider === "ado")
			.map((p) => ({ ...p, source: "cli", lastScannedAt: NOW - 300 }));
		data.pullRequests = data.pullRequests.map((p) => ({
			...p,
			checksObservedAt: null,
		}));
		data.collector = { lastSeenAt: NOW, state: "ready", message: "Connected" };
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const target = data.pullRequests.find(
			(p) => p.projectId === data.projects[1]!.id,
		)!;
		const { result } = await loaded(
			`/?source=cli&project=${data.projects[0]!.id}&pr=${target.id}`,
		);
		expect(result.current.selected?.pull.id).toBe(target.id);
		await act(() => result.current.collectPage());
		expect(scanProject).toHaveBeenCalledTimes(1);
		expect(scanProject).toHaveBeenCalledWith(
			data.projects[1]!.id,
			data.projects[1]!.revision,
			[target.id],
		);
	});
	it("collects all 20 PRs on the current page and switches scope after pagination", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		const data = snapshot();
		data.projects = data.projects
			.filter((p) => p.provider === "ado")
			.map((p) => ({ ...p, source: "cli", lastScannedAt: NOW - 10 }));
		data.collector = { lastSeenAt: NOW, state: "ready", message: "Connected" };
		data.pullRequests = data.pullRequests.map((p) => ({
			...p,
			checksObservedAt: NOW - 180,
		}));
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const { result } = await loaded();
		const firstPage = result.current.pageRows.map((row) => row.pull.id);
		expect(firstPage).toHaveLength(20);
		await act(() => result.current.collectPage());
		expect(
			vi
				.mocked(scanProject)
				.mock.calls.flatMap((call) => call[2] ?? [])
				.sort(),
		).toEqual([...firstPage].sort());
		vi.mocked(scanProject).mockClear();
		await act(() => result.current.collectPage());
		expect(scanProject).not.toHaveBeenCalled();
		vi.spyOn(Date, "now").mockReturnValue((NOW + 15) * 1000);
		act(() => result.current.setPage(2));
		await act(() => result.current.collectPage());
		const nextPage = result.current.pageRows.map((row) => row.pull.id);
		expect(
			vi
				.mocked(scanProject)
				.mock.calls.flatMap((call) => call[2] ?? [])
				.sort(),
		).toEqual([...nextPage].sort());
		expect(nextPage.every((id) => !firstPage.includes(id))).toBe(true);
		vi.mocked(scanProject).mockClear();
		act(() => result.current.setRefreshInterval(0));
		await act(() => result.current.collectPage());
		expect(scanProject).not.toHaveBeenCalled();
	});
	it("refreshes a stale repository list without prefetching its PR details", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		const data = snapshot();
		data.projects = [
			{ ...data.projects[0]!, source: "cli", lastScannedAt: null },
		];
		data.collector = { lastSeenAt: NOW, state: "ready", message: "Connected" };
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const { result } = await loaded();
		await act(() => result.current.collectPage());
		expect(scanProject).toHaveBeenCalledWith(
			data.projects[0]!.id,
			data.projects[0]!.revision,
			[],
		);
	});
	it("remembers every filter across navigation and reloads, with explicit shared URLs taking precedence", async () => {
		const first = await loaded();
		act(() =>
			first.result.current.setFilter({
				source: "demo",
				organization: "github.com",
				projectId: "demo-github-nocoo",
				repository: "signoff.now",
				draft: "include",
				authors: ["github:maya", "github:alex"],
				query: "review",
				state: "all",
				status: "attention",
				sort: "oldest",
			}),
		);
		const selected = first.result.current.filter;
		act(() => first.result.current.navigate("/projects"));
		expect(first.result.current.filter).toEqual(selected);
		act(() => first.result.current.navigate("/"));
		expect(first.result.current.filter).toEqual(selected);
		expect(localStorage.getItem(PULL_FILTER_STORAGE_KEY)).toContain(
			"author=github%3Amaya",
		);
		first.unmount();
		const second = await loaded();
		expect(second.result.current.filter).toEqual(selected);
		act(() => second.result.current.navigate("/?source=cli&org=msdata"));
		expect(second.result.current.filter).toMatchObject({
			source: "cli",
			organization: "msdata",
			projectId: "",
			repository: "",
			authors: [],
			draft: "exclude",
			query: "",
		});
	});
	it("keeps author choices and matching repository statistics usable after selecting multiple authors", async () => {
		const { result } = await loaded("/?source=demo&org=github.com&page=2");
		const authors = result.current.authors;
		act(() =>
			result.current.setFilter({ authors: ["github:maya", "github:alex"] }),
		);
		expect(result.current.authors).toEqual(authors);
		expect(result.current.visible).toHaveLength(2);
		expect(result.current.metrics.open).toBe(2);
		expect(result.current.repositories[0]?.metrics.open).toBe(2);
		expect(result.current.page).toBe(1);
		expect(
			new URLSearchParams(result.current.location.search).getAll("author"),
		).toEqual(["github:maya", "github:alex"]);
		act(() => result.current.setFilter({ draft: "only", authors: [] }));
		expect(result.current.visible).toHaveLength(1);
		expect(result.current.visible[0]?.pull.draft).toBe(true);
		act(() => result.current.selectPull(result.current.visible[0]!.pull.id));
		act(() => result.current.setFilter({ source: "cli" }));
		expect(result.current.filter.authors).toEqual([]);
		expect(result.current.selected).toBeNull();
		expect(result.current.missingSelection).toBe(false);
	});
	it("uses 20 PRs per page and restores safe defaults when storage is unavailable", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Storage disabled");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Quota exceeded");
		});
		const { result } = await loaded();
		expect(result.current.pageSize).toBe(20);
		expect(result.current.pageRows).toHaveLength(20);
		expect(result.current.filter.draft).toBe("exclude");
		expect(result.current.refreshInterval).toBe(120);
		act(() => result.current.setRefreshInterval(600));
		expect(result.current.refreshInterval).toBe(600);
		act(() => result.current.setFilter({ draft: "include" }));
		expect(result.current.visible).toHaveLength(36);
	});
	it("defaults mixed workspaces to live projects and remembers an explicit source selection", async () => {
		const data = snapshot();
		data.projects[0] = { ...data.projects[0], source: "cli" };
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		const { result } = await loaded();
		expect(result.current.filter.source).toBe("cli");
		expect(result.current.projects).toHaveLength(1);
		expect(result.current.visible).toHaveLength(10);
		act(() => result.current.setFilter({ source: "demo" }));
		expect(result.current.visible).toHaveLength(21);
		expect(
			new URLSearchParams(result.current.location.search).get("source"),
		).toBe("demo");
	});
	it("cascades organization, ADO project, and repository selections while preserving repository statistics", async () => {
		const { result } = await loaded("/?keep=1");
		expect(result.current.organizations).toEqual([
			"fabrikam-demo",
			"github.com",
			"northstar-demo",
		]);
		act(() => result.current.setFilter({ organization: "northstar-demo" }));
		expect(
			result.current.projectOptions.map(
				(summary) => summary.project.projectKey,
			),
		).toEqual(["Commerce", "Mobile", "Platform"]);
		expect(result.current.repositories).toHaveLength(9);
		expect(
			result.current.visible.every(
				(row) => row.project.organization === "northstar-demo",
			),
		).toBe(true);
		const repository = result.current.repositories.find(
			(repo) => repo.name === "api-gateway",
		);
		if (!repository) throw new Error("Expected the API gateway repository");
		act(() => result.current.selectRepository(repository.key));
		expect(result.current.filter).toMatchObject({
			organization: "northstar-demo",
			projectId: "demo-platform",
			repository: "demo-platform-api-gateway",
		});
		expect(result.current.metrics).toEqual(repository.metrics);
		expect(result.current.selectedRepository?.key).toBe(repository.key);
		expect(result.current.repositories).toHaveLength(3);
		act(() => result.current.setFilter({ query: "no matching PR" }));
		expect(result.current.visible).toHaveLength(0);
		expect(result.current.selectedRepository?.metrics.open).toBe(0);
		act(() => result.current.setPage(2));
		act(() => result.current.setFilter({ organization: "fabrikam-demo" }));
		expect(result.current.filter).toMatchObject({
			organization: "fabrikam-demo",
			projectId: "",
			repository: "",
			query: "no matching PR",
		});
		expect(result.current.projectOptions).toHaveLength(1);
		expect(result.current.repositories).toHaveLength(3);
		expect(result.current.page).toBe(1);
		expect(
			new URLSearchParams(result.current.location.search).get("keep"),
		).toBe("1");
		act(() => result.current.setFilter({ source: "cli" }));
		expect(result.current.filter).toMatchObject({
			organization: "",
			projectId: "",
			repository: "",
		});
		expect(result.current.repositories).toEqual([]);
	});
	it("opens a shared repository scope with its actual ADO parent and retains filters after clearing the repository", async () => {
		const { result } = await loaded(
			"/?project=demo-platform&repo=api-gateway&state=all",
		);
		expect(result.current.filter.organization).toBe("northstar-demo");
		expect(result.current.selectedRepository?.name).toBe("api-gateway");
		expect(result.current.visible).toHaveLength(4);
		act(() => result.current.selectRepository(""));
		expect(result.current.filter.repository).toBe("");
		expect(result.current.filter.projectId).toBe("demo-platform");
		expect(result.current.visible).toHaveLength(11);
		act(() => result.current.setFilter({ projectId: "demo-commerce" }));
		expect(result.current.filter.organization).toBe("northstar-demo");
		expect(result.current.repositories.map((repo) => repo.name)).toEqual([
			"billing-api",
			"checkout",
			"orders",
		]);
	});
	it("queues a real scan and reports pending work instead of pretending it completed", async () => {
		const data = snapshot();
		data.demoMode = false;
		data.projects[0] = { ...data.projects[0], source: "cli" };
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		vi.mocked(scanProject).mockResolvedValue({
			id: "job",
			projectId: project.id,
			revision: project.revision,
			state: "queued",
			requestedAt: NOW,
			startedAt: null,
			updatedAt: NOW,
			completedAt: null,
			completedPulls: 0,
			totalPulls: null,
			message: "Waiting for collector",
		});
		const { result } = await loaded();
		await act(() => result.current.scan(project.id));
		expect(scanProject).toHaveBeenCalledWith(project.id, project.revision);
		expect(result.current.notice).toContain("Queued 1 project");
		expect(result.current.notice).not.toContain("Scanned");
	});
	it("loads project summaries, repositories, metrics, and a bounded first page", async () => {
		const { result } = await loaded();
		expect(result.current.rows).toHaveLength(46);
		expect(result.current.visible).toHaveLength(31);
		expect(result.current.projects).toHaveLength(5);
		expect(result.current.repositories).toHaveLength(13);
		expect(result.current.metrics).toMatchObject({
			open: 31,
			attention: 18,
			ready: 7,
		});
		expect(result.current.pageRows).toHaveLength(20);
		expect(result.current.pageCount).toBe(2);
		expect(result.current.refreshing).toBe(false);
		expect(result.current.error).toBeNull();
	});
	it("drives filters, pages, and details from shareable URLs without discarding unrelated state", async () => {
		const { result } = await loaded("/?page=2&pr=demo-platform-pr-4821&keep=1");
		expect(result.current.page).toBe(2);
		expect(result.current.selected?.pull.number).toBe(4821);
		act(() =>
			result.current.setFilter({
				projectId: "demo-platform",
				state: "all",
				sort: "oldest",
			}),
		);
		expect(result.current.page).toBe(1);
		expect(result.current.visible).toHaveLength(11);
		expect(result.current.repositories).toHaveLength(3);
		expect(result.current.selected?.pull.number).toBe(4821);
		expect(
			new URLSearchParams(result.current.location.search).get("keep"),
		).toBe("1");
		act(() =>
			result.current.setFilter({
				repository: "demo-platform-api-gateway",
				query: "token",
				status: "blocked",
			}),
		);
		expect(result.current.visible.map((row) => row.pull.number)).toEqual([
			4821,
		]);
		act(() => result.current.setFilter({ projectId: "demo-commerce" }));
		expect(result.current.filter.repository).toBe("");
		act(() => result.current.setFilter(DEFAULT_PULL_FILTER));
		expect(result.current.filter).toEqual(DEFAULT_PULL_FILTER);
		act(() => result.current.setPage(3));
		expect(result.current.pageRows).toHaveLength(11);
		act(() => result.current.selectPull(null));
		expect(result.current.selected).toBeNull();
		expect(
			new URLSearchParams(result.current.location.search).get("pr"),
		).toBeNull();
		act(() => result.current.selectPull("demo-mobile-pr-1535"));
		expect(result.current.selected?.pull.state).toBe("merged");
	});
	it.each([
		["-20", 1],
		["nope", 1],
		["Infinity", 1],
		["2.9", 2],
		["999", 2],
	])("clamps page %s to %s", async (input, expected) => {
		const { result } = await loaded(`/?page=${input}`);
		expect(result.current.page).toBe(expected);
	});
	it("distinguishes a missing PR from a snapshot that could not be loaded", async () => {
		const first = pending<Workbench>();
		vi.mocked(loadWorkbench).mockReturnValueOnce(first.promise);
		const { result } = mount("/?pr=missing");
		expect(result.current.missingSelection).toBe(false);
		expect(result.current.projects).toEqual([]);
		await act(async () => first.reject(new Error("Offline")));
		expect(result.current.error).toBe("Offline");
		expect(result.current.missingSelection).toBe(false);
		await act(async () => result.current.reload());
		expect(result.current.error).toBeNull();
		expect(result.current.missingSelection).toBe(true);
	});
	it("retains the previous snapshot on a failed refresh", async () => {
		const { result } = await loaded();
		vi.mocked(loadWorkbench).mockRejectedValueOnce("network unavailable");
		await act(async () => result.current.reload());
		expect(result.current.error).toBe("Request failed");
		expect(result.current.rows).toHaveLength(46);
		expect(result.current.refreshing).toBe(false);
	});
	it("ignores slow snapshots and errors superseded by a newer refresh", async () => {
		const slow = pending<Workbench>();
		vi.mocked(loadWorkbench).mockReturnValueOnce(slow.promise);
		const { result } = mount();
		const fresh = { ...snapshot(), fetchedAt: NOW + 90 };
		vi.mocked(loadWorkbench).mockResolvedValueOnce(fresh);
		await act(async () => result.current.reload());
		await act(async () => slow.resolve(snapshot()));
		expect(result.current.data?.fetchedAt).toBe(NOW + 90);
		const lateError = pending<Workbench>();
		vi.mocked(loadWorkbench).mockReturnValueOnce(lateError.promise);
		let obsolete = Promise.resolve();
		act(() => {
			obsolete = result.current.reload();
		});
		await act(async () => result.current.reload());
		await act(async () => {
			lateError.reject(new Error("Old failure"));
			await obsolete;
		});
		expect(result.current.error).toBeNull();
	});
	it("stops loading after unmount and ignores pending completions", async () => {
		const slow = pending<Workbench>();
		vi.mocked(loadWorkbench).mockReturnValueOnce(slow.promise);
		const { result, unmount } = mount();
		const reload = result.current.reload;
		unmount();
		await act(async () => slow.resolve(snapshot()));
		await reload();
		expect(loadWorkbench).toHaveBeenCalledTimes(1);
	});
	it("polls only while visible, enabled, and free of mutations", async () => {
		const { result } = await loaded();
		act(() => result.current.setRefreshInterval(0));
		vi.useFakeTimers();
		act(() => result.current.setRefreshInterval(120));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(119_999);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const saving = pending<Project>();
		vi.mocked(createProject).mockReturnValueOnce(saving.promise);
		let mutation = Promise.resolve(false);
		act(() => {
			mutation = result.current.save(draft, null);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		await act(async () => {
			saving.resolve(project);
			await mutation;
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(3);
		act(() => result.current.setRefreshInterval(0));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(3);
	});
	it("reschedules polling after an interval change without keeping the old timer", async () => {
		const { result } = await loaded();
		act(() => result.current.setRefreshInterval(0));
		vi.useFakeTimers();
		act(() => result.current.setRefreshInterval(120));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		act(() => result.current.setRefreshInterval(300));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(299_999);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
	});
	it.each([
		"queued",
		"running",
		"auth_required",
	] as const)("updates %s collection progress every three seconds even with automatic refresh off", async (state) => {
		const data: Workbench = {
			...snapshot(),
			collectionJobs: [
				{
					id: "job",
					projectId: project.id,
					revision: project.revision,
					state,
					requestedAt: NOW,
					startedAt: NOW,
					updatedAt: NOW,
					completedAt: null,
					completedPulls: 2,
					totalPulls: 20,
					message: "Collecting",
				},
			],
		};
		vi.mocked(loadWorkbench).mockResolvedValueOnce(data);
		const { result } = await loaded();
		vi.useFakeTimers();
		act(() => result.current.setRefreshInterval(0));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2999);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
	});
});

describe("project mutations", () => {
	it("saves readiness with the settings revision, reloads rows, and retains errors on conflict", async () => {
		const { result } = await loaded();
		await act(async () => {
			expect(await result.current.saveReadiness(project, [])).toBe(true);
		});
		expect(patchReadiness).toHaveBeenLastCalledWith(project.id, 1, []);
		expect(result.current.notice).toContain("Readiness");
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		vi.mocked(patchReadiness).mockRejectedValueOnce(
			new Error("Readiness settings changed"),
		);
		await act(async () => {
			expect(
				await result.current.saveReadiness(
					{ ...project, readinessRevision: 4 },
					[],
				),
			).toBe(false);
		});
		expect(patchReadiness).toHaveBeenLastCalledWith(project.id, 4, []);
		expect(result.current.mutationError).toBe("Readiness settings changed");
	});
	it("creates and edits projects with explicit revisions, then refreshes the saved data", async () => {
		const { result } = await loaded();
		await act(async () =>
			expect(await result.current.save(draft, null)).toBe(true),
		);
		expect(createProject).toHaveBeenCalledWith(draft);
		expect(result.current.notice).toMatch(/Scan it to load sample/);
		await act(async () =>
			expect(await result.current.save(draft, project)).toBe(true),
		);
		expect(patchProject).toHaveBeenCalledWith(project.id, {
			...draft,
			revision: 1,
		});
		expect(result.current.notice).toBe("Project updated.");
		expect(loadWorkbench).toHaveBeenCalledTimes(3);
		expect(result.current.busy).toBeNull();
	});
	it("does not advertise mock collection for live-source projects", async () => {
		vi.mocked(createProject).mockResolvedValue({ ...project, source: "cli" });
		vi.mocked(loadWorkbench).mockResolvedValue({
			...snapshot(),
			demoMode: false,
		});
		const { result } = await loaded();
		await act(async () => result.current.save(draft, null));
		expect(result.current.notice).toBe(
			"Project added. Scan it to collect live Azure DevOps pull requests.",
		);
	});
	it("pauses, resumes, and removes precisely the project version the user saw", async () => {
		const { result } = await loaded();
		await act(async () => result.current.toggleMonitoring(project));
		expect(patchProject).toHaveBeenLastCalledWith(project.id, {
			revision: 1,
			enabled: false,
		});
		expect(result.current.notice).toMatch(/paused/);
		await act(async () =>
			result.current.toggleMonitoring({
				...project,
				revision: 2,
				enabled: false,
			}),
		);
		expect(patchProject).toHaveBeenLastCalledWith(project.id, {
			revision: 2,
			enabled: true,
		});
		expect(result.current.notice).toMatch(/resumed/);
		await act(async () => result.current.remove({ ...project, revision: 3 }));
		expect(deleteProject).toHaveBeenCalledWith(project.id, 3);
		expect(result.current.notice).toBe("Core Platform removed.");
	});
	it("retains the form on failure and reloads revisions before the next operation", async () => {
		const { result } = await loaded();
		vi.mocked(patchProject).mockRejectedValueOnce(new Error("Project changed"));
		await act(async () =>
			expect(await result.current.save(draft, project)).toBe(false),
		);
		expect(result.current.mutationError).toBe("Project changed");
		expect(result.current.notice).toBeNull();
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
		act(() => result.current.clearMutationError());
		expect(result.current.mutationError).toBeNull();
		vi.mocked(deleteProject).mockRejectedValueOnce("offline");
		await act(async () => result.current.remove(project));
		expect(result.current.mutationError).toBe("Request failed");
	});
	it("holds the mutation lock until the post-save snapshot arrives", async () => {
		const { result } = await loaded();
		const refresh = pending<Workbench>();
		vi.mocked(loadWorkbench).mockReturnValueOnce(refresh.promise);
		let first = Promise.resolve(false);
		await act(async () => {
			first = result.current.save(draft, null);
			await Promise.resolve();
		});
		expect(result.current.busy).toBe("save");
		await act(async () =>
			expect(await result.current.remove(project)).toBe(false),
		);
		expect(deleteProject).not.toHaveBeenCalled();
		await act(async () => {
			refresh.resolve(snapshot());
			await first;
		});
		expect(result.current.busy).toBeNull();
	});
	it.each([
		"resolve",
		"reject",
	] as const)("settles an in-flight mutation after unmount: %s", async (outcome) => {
		const { result, unmount } = await loaded();
		const saving = pending<Project>();
		vi.mocked(createProject).mockReturnValueOnce(saving.promise);
		let first = Promise.resolve(false);
		act(() => {
			first = result.current.save(draft, null);
		});
		unmount();
		if (outcome === "resolve") saving.resolve(project);
		else saving.reject(new Error("Conflict"));
		expect(await first).toBe(outcome === "resolve");
		expect(loadWorkbench).toHaveBeenCalledTimes(1);
	});
});

describe("demo scanning", () => {
	it("scans a selected project or all eligible projects and reports stage progress", async () => {
		const { result } = await loaded();
		await act(async () =>
			expect(await result.current.scan(project.id)).toBe(true),
		);
		expect(scanProject).toHaveBeenCalledTimes(1);
		expect(scanProject).toHaveBeenCalledWith(project.id, 1);
		expect(result.current.notice).toBe(
			"Scanned 1 project · 2 build stages updated.",
		);
		vi.mocked(scanProject).mockClear();
		await act(async () => result.current.scan());
		expect(scanProject).toHaveBeenCalledTimes(5);
		expect(result.current.notice).toBe(
			"Scanned 5 projects · 10 build stages updated.",
		);
	});
	it("scans only the chosen source, skips paused projects and continues after a failure", async () => {
		const data = snapshot();
		data.projects[1].enabled = false;
		data.projects[2].source = "cli";
		vi.mocked(loadWorkbench).mockResolvedValue(data);
		vi.mocked(scanProject).mockRejectedValueOnce(
			new Error("Changed during scan"),
		);
		const { result } = await loaded("/?source=demo");
		await act(async () => expect(await result.current.scan()).toBe(false));
		expect(vi.mocked(scanProject).mock.calls.map((call) => call[0])).toEqual([
			"demo-platform",
			"demo-mobile",
			"demo-github-nocoo",
		]);
		expect(result.current.mutationError).toBe(
			"2 project(s) scanned. 0 queued. Core Platform: Changed during scan",
		);
		expect(result.current.notice).toBeNull();
		expect(loadWorkbench).toHaveBeenCalledTimes(2);
	});
	it("refuses demo writes without local demo mode or an eligible project", async () => {
		vi.mocked(loadWorkbench).mockResolvedValue({
			...snapshot(),
			demoMode: false,
		});
		const { result } = await loaded();
		await act(async () => expect(await result.current.scan()).toBe(false));
		expect(scanProject).not.toHaveBeenCalled();
		vi.mocked(loadWorkbench).mockResolvedValue(snapshot());
		await act(async () => result.current.reload());
		await act(async () =>
			expect(await result.current.scan("missing")).toBe(false),
		);
		expect(scanProject).not.toHaveBeenCalled();
	});
	it("cannot scan before a usable snapshot has loaded", async () => {
		vi.mocked(loadWorkbench).mockRejectedValue(new Error("Offline"));
		const { result } = await loaded();
		await act(async () => expect(await result.current.scan()).toBe(false));
		expect(result.current.mutationError).toBe(
			"No eligible projects to scan. Check monitoring and active scans.",
		);
		expect(scanProject).not.toHaveBeenCalled();
	});
});

describe("project form", () => {
	it("retains separators while typing repository scope and validates duplicates on submit", async () => {
		const onSave = vi.fn().mockResolvedValue(true);
		const { result } = renderHook(() =>
			useProjectFormViewModel(project, onSave),
		);
		act(() => result.current.setRepositoryText("api, "));
		expect(result.current.repositoryText).toBe("api, ");
		act(() => result.current.setRepositoryText("api, API"));
		await act(async () => expect(await result.current.submit()).toBe(false));
		expect(result.current.errors.repositories).toBeDefined();
		expect(onSave).not.toHaveBeenCalled();
		act(() => result.current.setRepositoryText("api, web"));
		expect(result.current.errors.repositories).toBeUndefined();
		await act(async () => expect(await result.current.submit()).toBe(true));
		expect(onSave).toHaveBeenLastCalledWith(
			expect.objectContaining({ repositories: ["api", "web"] }),
		);
		act(() => result.current.setRepositoryText(""));
		await act(() => result.current.submit());
		expect(onSave).toHaveBeenLastCalledWith(
			expect.objectContaining({ repositories: [] }),
		);
	});
	it("validates fields before saving and preserves the draft after a failed save", async () => {
		const onSave = vi.fn().mockResolvedValue(false);
		const { result } = renderHook(() => useProjectFormViewModel(null, onSave));
		expect(result.current.draft).toMatchObject({
			provider: "ado",
			name: "",
			enabled: true,
		});
		await act(async () => expect(await result.current.submit()).toBe(false));
		expect(onSave).not.toHaveBeenCalled();
		expect(result.current.errors).toMatchObject({
			name: "Enter a project name",
			owner: "Enter a project owner",
		});
		act(() => {
			for (const key of Object.keys(draft) as (keyof ProjectWrite)[])
				result.current.setField(key, draft[key]);
			result.current.setField("name", "  Core  ");
		});
		expect(result.current.errors.name).toBeUndefined();
		await act(async () => expect(await result.current.submit()).toBe(false));
		expect(onSave).toHaveBeenCalledWith(draft);
		expect(result.current.draft.name).toBe("  Core  ");
		expect(result.current.errors).toEqual({});
	});
	it("loads editable fields only and retains the typed draft when a parent refreshes", async () => {
		const onSave = vi.fn().mockResolvedValue(true);
		const { result, rerender } = renderHook(
			({ item }) => useProjectFormViewModel(item, onSave),
			{ initialProps: { item: { ...project, enabled: false } } },
		);
		expect(result.current.draft).toMatchObject({
			name: project.name,
			organization: project.organization,
			enabled: false,
		});
		expect(result.current.draft).not.toHaveProperty("revision");
		act(() => result.current.setField("description", "Draft description"));
		rerender({ item: { ...project, enabled: false } });
		expect(result.current.draft.description).toBe("Draft description");
		await act(async () => expect(await result.current.submit()).toBe(true));
	});
});
