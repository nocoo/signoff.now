import { makeWatchRef } from "@signoff/domain/monitoring";
import type { ProjectWrite } from "@signoff/domain/workbench";
import {
	act,
	cleanup,
	fireEvent,
	renderHook,
	render as renderView,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/models/monitoringApi";
import { PULL_FILTER_STORAGE_KEY } from "@/models/workbench";
import {
	createProject,
	deleteProject,
	patchProject,
	patchReadiness,
	patchRefreshSettings,
} from "@/models/workbenchApi";
import {
	fixtureObservation,
	fixtureProject as project,
	publicProject,
	publicPull,
	fixturePull as pull,
	queryFixture,
} from "@/test/monitoring-fixture";
import { CollectionStatus } from "@/views/workbench/CollectionStatus";
import { PullsPage } from "@/views/workbench/PullsPage";
import {
	useProjectFormViewModel,
	useWorkbenchViewModel,
} from "./useWorkbenchViewModel";
import { WorkbenchProvider } from "./WorkbenchProvider";

vi.mock("@/models/workbenchApi", () => ({
	createProject: vi.fn(),
	deleteProject: vi.fn(),
	patchProject: vi.fn(),
	patchReadiness: vi.fn(),
	patchRefreshSettings: vi.fn(),
}));
vi.mock("@/models/monitoringApi", async (original) => ({
	...(await original<typeof import("@/models/monitoringApi")>()),
	loadCatalog: vi.fn(),
	loadPulls: vi.fn(),
	loadCollector: vi.fn(),
	loadPull: vi.fn(),
	loadPending: vi.fn(),
	addWatches: vi.fn(),
	removeWatches: vi.fn(),
	discover: vi.fn(),
	refreshWatches: vi.fn(),
}));
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
const fixture = queryFixture();
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((r, fail) => {
		resolve = r;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function render(path = "/") {
	return renderHook(
		() => ({
			vm: useWorkbenchViewModel(),
			location: useLocation(),
			navigate: useNavigate(),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
			),
		},
	);
}
const loaded = async (result: ReturnType<typeof render>["result"]) =>
	waitFor(() => {
		expect(result.current.vm.loading).toBe(false);
		expect(result.current.vm.collector).not.toBeNull();
	});
it("keeps PR columns mounted during loading and links the target branch after the snapshot arrives", async () => {
	const pending = deferred<typeof fixture.pulls>();
	vi.mocked(api.loadPulls).mockReturnValue(pending.promise);
	renderView(
		<MemoryRouter>
			<WorkbenchProvider>
				<PullsPage />
			</WorkbenchProvider>
		</MemoryRouter>,
	);
	const table = screen.getByRole("table", { name: "Pull requests" });
	expect(table.getAttribute("aria-busy")).toBe("true");
	expect(
		within(table).getByRole("columnheader", { name: "Target branch" }),
	).toBeTruthy();
	expect(within(table).getByRole("checkbox")).toHaveProperty("disabled", true);
	expect(screen.queryByText("No matching pull requests")).toBeNull();
	await act(async () => pending.resolve(fixture.pulls));
	await waitFor(() => expect(table.getAttribute("aria-busy")).toBe("false"));
	expect(screen.getByRole("table", { name: "Pull requests" })).toBe(table);
	const link = within(table).getByRole("link", {
		name: `Open target branch ${pull.targetBranch} in ${project.projectKey}/${pull.repository.name} (new tab)`,
	});
	expect(link.getAttribute("href")).toBe(
		`https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.id}?version=GB${encodeURIComponent(pull.targetBranch)}`,
	);
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

it("a failed second pending page keeps Previous available and returns to the working first page", async () => {
	const items = Array.from({ length: 21 }, (_, i) => ({
		...publicPull(pull, project, fixtureObservation()).observation!,
		id: `pending-${i}`,
		pull: null,
		pullId: null,
	}));
	vi.mocked(api.loadPending).mockImplementation(
		async (_source, _signal, _scope, page = 1) => {
			if (page === 2) throw new Error("Pending page 2 failed");
			return {
				...fixture.envelope,
				data: items.slice(0, 20),
				page: { ...fixture.page, total: 21 },
			};
		},
	);
	renderView(
		<MemoryRouter initialEntries={["/?watching=watching"]}>
			<WorkbenchProvider>
				<PullsPage />
			</WorkbenchProvider>
		</MemoryRouter>,
	);
	const pending = within(
		await screen.findByRole("region", { name: "Pending watches" }),
	);
	fireEvent.click(
		await pending.findByRole("button", { name: "Next pending page" }),
	);
	await pending.findByText("Pending page 2 failed");
	const previous = pending.getByRole("button", {
		name: "Previous pending page",
	});
	expect((previous as HTMLButtonElement).disabled).toBe(false);
	expect(pending.queryByText("0 pending watches")).toBeNull();
	expect(pending.queryByText("2 / 1")).toBeNull();
	fireEvent.click(previous);
	await waitFor(() => expect(pending.getAllByRole("link")).toHaveLength(20));
	expect(pending.queryByText("Pending page 2 failed")).toBeNull();
});
it("a failed second PR page keeps Previous available and returns to the working first page", async () => {
	vi.mocked(api.loadPulls).mockImplementation(async (query) => {
		if (new URLSearchParams(query).get("page") === "2")
			throw new Error("PR page 2 failed");
		return { ...fixture.pulls, page: { ...fixture.page, total: 21 } };
	});
	renderView(
		<MemoryRouter>
			<WorkbenchProvider>
				<PullsPage />
			</WorkbenchProvider>
		</MemoryRouter>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
	await screen.findByText("Unable to load pull requests");
	const previous = screen.getByRole("button", { name: "Previous page" });
	expect((previous as HTMLButtonElement).disabled).toBe(false);
	expect(screen.queryByText("2 / 1")).toBeNull();
	fireEvent.click(previous);
	await screen.findByRole("table", { name: "Pull requests" });
	expect(screen.queryByText("Unable to load pull requests")).toBeNull();
});
beforeEach(() => {
	vi.resetAllMocks();
	localStorage.clear();
	vi.mocked(api.loadCatalog).mockImplementation(
		async (source) => queryFixture(source).catalog,
	);
	vi.mocked(api.loadPulls).mockImplementation(
		async (query) =>
			queryFixture(
				new URLSearchParams(query).get("source") === "sample" ? "demo" : "cli",
			).pulls,
	);
	vi.mocked(api.loadCollector).mockImplementation(
		async (source) => queryFixture(source).collector,
	);
	vi.mocked(api.loadPull).mockImplementation(async (source, id) => ({
		...queryFixture(source).envelope,
		data: {
			...queryFixture(source).pulls.data[0]!,
			id,
			description: "Full detail",
		},
	}));
	vi.mocked(api.loadPending).mockResolvedValue({
		...fixture.envelope,
		data: [],
		page: { ...fixture.page, total: 0 },
	});
	vi.mocked(api.addWatches).mockResolvedValue({
		results: [{ status: "added" }],
	});
	vi.mocked(api.removeWatches).mockResolvedValue({
		results: [{ status: "removed" }],
	});
	vi.mocked(api.discover).mockResolvedValue({ jobs: [] });
	vi.mocked(api.refreshWatches).mockResolvedValue({ jobs: [] });
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("independent cached blocks", () => {
	it("continuous publications never starve a slower initial PR query", async () => {
		vi.useFakeTimers();
		let revision = 0;
		vi.mocked(api.loadCollector).mockImplementation(async () => ({
			...fixture.collector,
			dataRevision: String(++revision),
		}));
		vi.mocked(api.loadPulls).mockImplementation(async () => {
			const snapshot = revision;
			await new Promise((resolve) => setTimeout(resolve, 4000));
			return {
				...fixture.pulls,
				dataRevision: String(snapshot),
				data: [{ ...fixture.pulls.data[0]!, title: `Publication ${snapshot}` }],
			};
		});
		const { result } = render("/");
		for (let round = 0; round < 10; round++)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3000);
			});
		expect(result.current.vm.loading).toBe(false);
		expect(result.current.vm.rows[0]?.pull.title).toMatch(/^Publication [5-9]/);
		expect(vi.mocked(api.loadPulls).mock.calls.length).toBeLessThanOrEqual(9);
	});
	it("collector publications promptly reconcile mounted cache blocks without provider commands or heartbeat reloads", async () => {
		vi.useFakeTimers();
		let revision = "1";
		vi.mocked(api.loadCollector).mockImplementation(async () => ({
			...fixture.collector,
			dataRevision: revision,
		}));
		const { result } = render(`/?watching=watching&pr=${pull.id}`);
		await act(async () => {});
		const reads = [
			api.loadPulls,
			api.loadPull,
			api.loadCatalog,
			api.loadPending,
		];
		for (const read of reads) vi.mocked(read).mockClear();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		for (const read of reads) expect(read).not.toHaveBeenCalled();
		const final = publicPull(
			{ ...pull, state: "merged" },
			project,
			fixtureObservation({ active: false, stopReason: "completed" }),
		);
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			dataRevision: "2",
			data: [],
			page: { ...fixture.page, total: 0 },
		});
		vi.mocked(api.loadPull).mockResolvedValue({
			...fixture.envelope,
			dataRevision: "2",
			data: final,
		});
		revision = "2";
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
		expect(result.current.vm.rows).toEqual([]);
		expect(result.current.vm.selected?.pull.state).toBe("merged");
		expect(result.current.vm.selected?.observation?.active).toBe(false);
		expect(result.current.vm.loading).toBe(false);
		for (const command of [
			api.discover,
			api.refreshWatches,
			api.addWatches,
			api.removeWatches,
		])
			expect(command).not.toHaveBeenCalled();
	});
	it("publication signals coalesce behind a slow cache read and independently recover a failed detail", async () => {
		vi.useFakeTimers();
		let revision = "1";
		vi.mocked(api.loadCollector).mockImplementation(async () => ({
			...fixture.collector,
			dataRevision: revision,
		}));
		const { result } = render(`/?pr=${pull.id}`);
		await act(async () => {});
		vi.mocked(api.loadPulls).mockClear();
		const slow = deferred<typeof fixture.pulls>();
		vi.mocked(api.loadPulls).mockImplementationOnce(() => slow.promise);
		vi.mocked(api.loadPull).mockRejectedValueOnce(
			new Error("Detail unavailable"),
		);
		revision = "2";
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(result.current.vm.detailError).toBe("Detail unavailable");
		expect(result.current.vm.rows).toHaveLength(1);
		expect(result.current.vm.loading).toBe(false);
		for (revision of ["3", "4"])
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3000);
			});
		expect(api.loadPulls).toHaveBeenCalledTimes(1);
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			dataRevision: "4",
			data: [{ ...fixture.pulls.data[0]!, title: "Newest publication" }],
		});
		await act(async () => {
			slow.resolve({ ...fixture.pulls, dataRevision: "2" });
		});
		expect(api.loadPulls).toHaveBeenCalledTimes(2);
		expect(result.current.vm.rows[0]?.pull.title).toBe("Newest publication");
		expect(result.current.vm.detailError).toBeNull();
	});
	it("foreground return catches publications without reading hidden pages or inactive PR blocks", async () => {
		vi.useFakeTimers();
		const visibility = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("visible");
		let revision = "1";
		vi.mocked(api.loadCollector).mockImplementation(async () => ({
			...fixture.collector,
			dataRevision: revision,
		}));
		const { result } = render("/projects");
		await act(async () => {});
		vi.mocked(api.loadCatalog).mockClear();
		visibility.mockReturnValue("hidden");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		revision = "2";
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60000);
		});
		expect(api.loadCatalog).not.toHaveBeenCalled();
		visibility.mockReturnValue("visible");
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(api.loadCatalog).toHaveBeenCalled();
		expect(result.current.vm.projects).toHaveLength(1);
		for (const read of [api.loadPulls, api.loadPull, api.loadPending])
			expect(read).not.toHaveBeenCalled();
	});
	it("loads live cache only and never creates provider work when a page opens", async () => {
		const { result } = render();
		await loaded(result);
		expect(result.current.vm.filter).toMatchObject({
			source: "cli",
			draft: "exclude",
			watching: "all",
		});
		expect(result.current.vm.pageSize).toBe(20);
		expect(result.current.vm.total).toBe(1);
		expect(result.current.vm.projects[0]?.repositories[0]?.metrics.open).toBe(
			1,
		);
		expect(result.current.vm.connection.state).toBe("ready");
		for (const command of [
			api.addWatches,
			api.removeWatches,
			api.discover,
			api.refreshWatches,
		])
			expect(command).not.toHaveBeenCalled();
	});
	it("keeps successful PR data when repository and collector blocks fail", async () => {
		vi.mocked(api.loadCatalog).mockRejectedValue(
			new Error("Repos unavailable"),
		);
		vi.mocked(api.loadCollector).mockRejectedValue(
			new Error("Collector unavailable"),
		);
		const { result } = render();
		await waitFor(() =>
			expect(result.current.vm.collectionError).toBe("Collector unavailable"),
		);
		expect(result.current.vm.pageRows).toHaveLength(1);
		expect(result.current.vm.catalogError).toBe("Repos unavailable");
		expect(result.current.vm.data?.projects).toHaveLength(1);
		expect(result.current.vm.connection.state).toBe("offline");
	});
	it("retains the last successful block after a refresh failure and recovers on retry", async () => {
		const { result } = render();
		await loaded(result);
		vi.mocked(api.loadPulls).mockRejectedValueOnce(new Error("Read failed"));
		await act(() => result.current.vm.reload());
		expect(result.current.vm.error).toBe("Read failed");
		expect(result.current.vm.rows).toHaveLength(1);
		await act(() => result.current.vm.reload());
		expect(result.current.vm.error).toBeNull();
	});
	it("never displays a late Live result in Sample", async () => {
		const old = deferred<typeof fixture.pulls>();
		vi.mocked(api.loadPulls).mockReturnValueOnce(old.promise);
		const { result } = render();
		await act(async () => {});
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await loaded(result);
		await act(async () => old.resolve(fixture.pulls));
		expect(result.current.vm.pageRows[0]?.project.source).toBe("demo");
	});
	it("loads full detail independently from the visible list and reports cache misses", async () => {
		const { result } = render("/?pr=off-page");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.detailLoading).toBe(false));
		expect(result.current.vm.selected?.pull).toMatchObject({
			id: "off-page",
			description: "Full detail",
		});
		act(() => result.current.vm.selectPull(null));
		expect(result.current.vm.selected).toBeNull();
		vi.mocked(api.loadPull).mockRejectedValue(
			new ApiError("PR is not cached", 404, { error: { code: "CACHE_MISS" } }),
		);
		act(() => result.current.vm.selectPull("missing"));
		await waitFor(() => expect(result.current.vm.missingSelection).toBe(true));
		expect(result.current.vm.detailError).toBe("PR is not cached");
	});
	it("a first detail request failure remains a retryable error, independent of the list", async () => {
		vi.mocked(api.loadPull).mockRejectedValueOnce(
			new ApiError("Detail unavailable", 503),
		);
		const { result } = render("/?pr=off-page");
		await loaded(result);
		await waitFor(() =>
			expect(result.current.vm.detailError).toBe("Detail unavailable"),
		);
		expect(result.current.vm.missingSelection).toBe(false);
		expect(result.current.vm.selected).toBeNull();
		const listReads = vi.mocked(api.loadPulls).mock.calls.length;
		await act(() => result.current.vm.reloadDetail());
		expect(result.current.vm.selected?.pull.id).toBe("off-page");
		expect(result.current.vm.detailError).toBeNull();
		expect(api.loadPulls).toHaveBeenCalledTimes(listReads);
		vi.mocked(api.loadPull).mockRejectedValueOnce(new Error("Connection lost"));
		await act(() => result.current.vm.reloadDetail());
		expect(result.current.vm.selected?.pull.description).toBe("Full detail");
		expect(result.current.vm.detailError).toBe("Connection lost");
	});
	it("changing routes stops the PR page query while preserving global source and catalog", async () => {
		const { result } = render("/projects");
		await loaded(result);
		expect(api.loadPulls).not.toHaveBeenCalled();
		act(() => result.current.vm.setFilter({ source: "demo" }));
		act(() => result.current.navigate("/"));
		await loaded(result);
		expect(result.current.vm.filter.source).toBe("demo");
		expect(result.current.vm.pageRows[0]?.project.source).toBe("demo");
	});
});

describe("filters, server pages and temporary selection", () => {
	it("restores saved filters and gives explicit URL filters priority", async () => {
		localStorage.setItem(
			PULL_FILTER_STORAGE_KEY,
			"source=demo&draft=include&watching=watching",
		);
		const first = render();
		await loaded(first.result);
		expect(first.result.current.vm.filter).toMatchObject({
			source: "demo",
			draft: "include",
			watching: "watching",
		});
		first.unmount();
		const second = render("/?source=cli");
		await loaded(second.result);
		expect(second.result.current.vm.filter.source).toBe("cli");
	});
	it("works even when browser storage is unavailable", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Blocked");
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.setFilter({ query: "find me" }));
		expect(result.current.vm.filter.query).toBe("find me");
	});
	it("keeps hierarchy consistent and caches watch, author and draft filters", async () => {
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectRepository("repo-key"));
		expect(result.current.vm.filter).toMatchObject({
			organization: project.organization.toLowerCase(),
			projectId: project.id,
			repository: pull.repository.id,
		});
		await act(async () => {});
		expect(result.current.vm.selectedRepository?.name).toBe(
			pull.repository.name,
		);
		act(() =>
			result.current.vm.setFilter({
				draft: "include",
				authors: ["one", "two"],
				watching: "watching",
			}),
		);
		expect(localStorage.getItem(PULL_FILTER_STORAGE_KEY)).toContain(
			"watching=watching",
		);
		act(() => result.current.vm.setFilter({ organization: "elsewhere" }));
		expect(result.current.vm.filter.projectId).toBe("");
		expect(result.current.vm.filter.repository).toBe("");
		act(() => result.current.vm.setFilter({ projectId: "unknown" }));
		expect(result.current.vm.filter.repository).toBe("");
		act(() => result.current.vm.selectRepository("missing"));
		expect(result.current.vm.filter.repository).toBe("");
		act(() => result.current.vm.setFilter({ source: "demo" }));
		expect(result.current.vm.filter.authors).toEqual([]);
	});
	it("selects an unresolved repository by URL and preserves its scope after discovery", async () => {
		const repo = fixture.catalog.data[0]!;
		let discovered = false;
		vi.mocked(api.loadCatalog).mockImplementation(async () =>
			discovered
				? fixture.catalog
				: {
						...fixture.catalog,
						data: [
							{
								...repo,
								key: "unresolved",
								repository: { ...repo.repository, id: null },
								identityResolved: false,
							},
						],
					},
		);
		vi.mocked(api.loadPulls).mockImplementation(async (query) => {
			const scope = new URLSearchParams(query);
			return discovered &&
				(scope.get("repositoryId") === repo.repository.id ||
					scope.get("repo") === repo.repository.url)
				? fixture.pulls
				: { ...fixture.pulls, data: [], page: { ...fixture.page, total: 0 } };
		});
		vi.mocked(api.discover).mockImplementation(async () => {
			discovered = true;
			return { jobs: [] };
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectRepository("unresolved"));
		await waitFor(() =>
			expect(result.current.vm.selectedRepository?.name).toBe(
				repo.repository.name,
			),
		);
		expect(result.current.vm.filter.repository).toBe(repo.repository.url);
		await act(() => result.current.vm.discoverRepo());
		await waitFor(() => expect(result.current.vm.total).toBe(1));
		expect(result.current.vm.selectedRepository?.id).toBe(repo.repository.id);
		expect(result.current.vm.filter.repository).toBe(repo.repository.id);
		expect(
			new URLSearchParams(localStorage.getItem(PULL_FILTER_STORAGE_KEY)!).get(
				"repo",
			),
		).toBe(repo.repository.id);
	});
	it("keeps an ambiguous repository URL even when only its reused current name remains in the catalog", async () => {
		const repo = fixture.catalog.data[0]!;
		const url = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/shared`;
		const ambiguity = new ApiError(
			"Repository alias matches multiple identities",
			409,
			{ error: { code: "REFERENCE_AMBIGUOUS" } },
		);
		vi.mocked(api.loadCatalog).mockImplementation(
			async (_source, _signal, scope) => {
				if (scope?.repository) throw ambiguity;
				return {
					...fixture.catalog,
					data: [
						{
							...repo,
							repository: { ...repo.repository, name: "shared", url },
						},
					],
				};
			},
		);
		vi.mocked(api.loadPulls).mockImplementation(async (query) => {
			if (new URLSearchParams(query).get("repo")) throw ambiguity;
			return fixture.pulls;
		});
		const { result } = render(`/?repo=${encodeURIComponent(url)}`);
		await loaded(result);
		expect(result.current.vm.filter.repository).toBe(url);
		expect(result.current.vm.selectedRepository).toBeNull();
		expect(result.current.vm.error).toContain("multiple identities");
		expect(
			new URLSearchParams(localStorage.getItem(PULL_FILTER_STORAGE_KEY)!).get(
				"repo",
			),
		).toBe(url);
		await act(async () =>
			expect(await result.current.vm.discoverRepo()).toBe(false),
		);
		expect(api.discover).not.toHaveBeenCalled();
	});
	it("reconciles a unique retained name using the server result and preserves its project scope", async () => {
		const repo = fixture.catalog.data[0]!;
		const url = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/retired-name`;
		const catalog = {
			...fixture.catalog,
			data: [{ ...repo, repository: { ...repo.repository, name: "renamed" } }],
		};
		vi.mocked(api.loadCatalog).mockResolvedValue(catalog);
		const { result } = render(`/?repo=${encodeURIComponent(url)}`);
		await loaded(result);
		await waitFor(() =>
			expect(result.current.vm.filter.repository).toBe(repo.repository.id),
		);
		expect(api.loadCatalog).toHaveBeenCalledWith(
			"cli",
			expect.any(AbortSignal),
			{ repository: url, projectId: "" },
		);
		expect(result.current.vm.filter).toMatchObject({
			organization: project.organization.toLowerCase(),
			projectId: project.id,
		});
		expect(result.current.vm.selectedRepository?.id).toBe(repo.repository.id);
	});
	it.each([
		{ projectKey: "ReplacementProject" },
		{ organization: "replacement-org" },
		{ provider: "github" as const },
		{ source: "demo" as const },
		{ id: "replacement-registration" },
	])("does not retarget a delayed repository resolution after its project identity changes (%j)", async (changed) => {
		const repo = fixture.catalog.data[0]!;
		const response = deferred<typeof fixture.catalog>();
		const replacement = publicProject({ ...project, ...changed });
		vi.mocked(api.loadCatalog).mockImplementation(
			async (_source, _signal, scope) =>
				scope?.repository
					? response.promise
					: {
							...fixture.catalog,
							projects: [replacement],
							data: [{ ...repo, project: replacement }],
						},
		);
		const url = repo.repository.url;
		const { result } = render(`/?repo=${encodeURIComponent(url)}`);
		await loaded(result);
		expect(result.current.vm.repositories[0]?.project).toMatchObject(changed);
		await act(() => response.resolve(fixture.catalog));
		expect(result.current.vm.selectedRepository).toBeNull();
		expect(result.current.vm.filter.repository).toBe(url);
		expect(
			new URLSearchParams(localStorage.getItem(PULL_FILTER_STORAGE_KEY)!).get(
				"repo",
			),
		).toBe(url);
		await act(async () =>
			expect(await result.current.vm.discoverRepo()).toBe(false),
		);
		expect(api.discover).not.toHaveBeenCalled();
	});
	it("reconciles equivalent identities across independent revisions and metadata renames", async () => {
		const repo = fixture.catalog.data[0]!;
		const updatedProject = publicProject({
			...project,
			organization: project.organization.toUpperCase(),
			projectKey: project.projectKey.toUpperCase(),
			name: "Renamed display label",
			revision: project.revision + 1,
		});
		const updatedRepository = {
			...repo,
			project: updatedProject,
			repository: {
				...repo.repository,
				id: repo.repository.id!.toUpperCase(),
				name: "renamed",
			},
		};
		vi.mocked(api.loadCatalog).mockImplementation(
			async (_source, _signal, scope) =>
				scope?.repository
					? fixture.catalog
					: {
							...fixture.catalog,
							dataRevision: "2",
							projects: [updatedProject],
							data: [updatedRepository],
						},
		);
		const { result } = render(
			`/?repo=${encodeURIComponent(repo.repository.url)}`,
		);
		await loaded(result);
		await waitFor(() =>
			expect(result.current.vm.filter.repository).toBe(
				updatedRepository.repository.id,
			),
		);
		expect(result.current.vm.selectedRepository?.name).toBe("renamed");
	});
	it("shows an unavailable selected repository without implying an unfiltered table", async () => {
		vi.mocked(api.loadCatalog).mockImplementation(
			async (_source, _signal, scope) =>
				scope?.repository
					? {
							...fixture.catalog,
							data: [],
							page: { ...fixture.page, total: 0 },
						}
					: fixture.catalog,
		);
		renderView(
			<MemoryRouter
				initialEntries={[
					`/?repo=${encodeURIComponent(fixture.catalog.data[0]!.repository.url)}`,
				]}
			>
				<WorkbenchProvider>
					<PullsPage />
				</WorkbenchProvider>
			</MemoryRouter>,
		);
		const unavailable = await screen.findByRole("combobox", {
			name: /Repository/,
		});
		expect(unavailable.textContent).toBe("Selected repository unavailable");
		fireEvent.click(unavailable);
		fireEvent.click(screen.getByRole("option", { name: "All repositories" }));
		await waitFor(() =>
			expect(unavailable.textContent).toBe("All repositories"),
		);
	});
	it("does not rewrite a repository URL shared by duplicate project registrations", async () => {
		const repo = fixture.catalog.data[0]!;
		const otherProject = { ...project, id: "another-registration" };
		vi.mocked(api.loadCatalog).mockResolvedValue({
			...fixture.catalog,
			projects: [...fixture.catalog.projects, publicProject(otherProject)],
			data: [
				repo,
				{ ...repo, key: "duplicate", project: publicProject(otherProject) },
			],
			page: { ...fixture.page, total: 2 },
		});
		const { result } = render(
			`/?repo=${encodeURIComponent(repo.repository.url)}`,
		);
		await loaded(result);
		expect(result.current.vm.filter.repository).toBe(repo.repository.url);
		expect(result.current.vm.selectedRepository).toBeNull();
	});
	it("uses server totals, clamps removed pages and validates malformed page numbers", async () => {
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			page: { ...fixture.page, total: 45 },
		});
		const first = render("/?page=2");
		await loaded(first.result);
		expect(first.result.current.vm.pageCount).toBe(3);
		expect(first.result.current.vm.pageRows).toHaveLength(1);
		act(() => first.result.current.vm.setPage(3));
		await act(async () => {});
		expect(first.result.current.vm.page).toBe(3);
		vi.mocked(api.loadPulls).mockResolvedValue(fixture.pulls);
		await act(() => first.result.current.vm.reload());
		await waitFor(() => expect(first.result.current.vm.page).toBe(1));
		first.unmount();
		const second = render("/?page=NaN");
		await loaded(second.result);
		expect(second.result.current.vm.page).toBe(1);
	});
	it("selects eligible rows only and clears temporary selection on filter changes", async () => {
		const watchedTerminal = publicPull(
			{ ...pull, id: "terminal-watched", state: "merged" },
			project,
			fixtureObservation({ pullId: "terminal-watched" }),
		);
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [
				publicPull(),
				publicPull({ ...pull, id: "draft", draft: true }),
				publicPull({ ...pull, id: "done", state: "merged" }),
				watchedTerminal,
			],
		});
		const { result } = render();
		await loaded(result);
		expect(result.current.vm.selectableCount).toBe(3);
		act(() => result.current.vm.selectPage(true));
		expect(result.current.vm.selectedCount).toBe(3);
		expect(api.addWatches).not.toHaveBeenCalled();
		act(() => result.current.vm.toggleSelection("done", true));
		expect(result.current.vm.selectedCount).toBe(3);
		act(() => result.current.vm.toggleSelection(pull.id, false));
		expect(result.current.vm.selectedIds.has(pull.id)).toBe(false);
		act(() => result.current.vm.selectPage(false));
		expect(result.current.vm.selectedCount).toBe(0);
		act(() => result.current.vm.toggleSelection(pull.id, true));
		act(() => result.current.vm.setFilter({ query: "different" }));
		await loaded(result);
		expect(result.current.vm.selectedCount).toBe(0);
		act(() => result.current.vm.setFilter({ query: "" }));
		await loaded(result);
		expect(result.current.vm.selectedCount).toBe(0);
	});
});

describe("shared watch mutations", () => {
	it("optimistically toggles independent rows and rolls back only a failed command without replacing the table", async () => {
		const other = { ...pull, id: "second", number: pull.number + 1 };
		const observation = fixtureObservation({ generation: 4 });
		let watching = false;
		vi.mocked(api.loadPulls).mockImplementation(async () => ({
			...fixture.pulls,
			data: [
				publicPull(pull, project, watching ? observation : null),
				publicPull(other),
			],
		}));
		const first = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
		const second = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
		vi.mocked(api.addWatches)
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		renderView(
			<MemoryRouter>
				<WorkbenchProvider>
					<PullsPage />
				</WorkbenchProvider>
			</MemoryRouter>,
		);
		const table = await screen.findByRole("table", { name: "Pull requests" });
		const button = (number: number) =>
			screen.getByRole("button", {
				name: `Watch PR #${number} in ${project.projectKey}/${pull.repository.name}`,
			}) as HTMLButtonElement;
		const firstButton = button(pull.number);
		const secondButton = button(other.number);
		fireEvent.click(firstButton);
		expect(firstButton.getAttribute("aria-pressed")).toBe("true");
		expect(firstButton.getAttribute("aria-busy")).toBe("true");
		expect(secondButton.disabled).toBe(false);
		fireEvent.click(secondButton);
		expect(secondButton.getAttribute("aria-pressed")).toBe("true");
		expect(api.addWatches).toHaveBeenCalledTimes(2);
		await act(async () => {
			second.resolve({
				results: [
					{
						status: "rejected",
						error: {
							code: "PR_TERMINAL",
							message: "Already merged",
							retryable: false,
						},
					},
				],
			});
		});
		expect(secondButton.getAttribute("aria-pressed")).toBe("false");
		expect(firstButton.getAttribute("aria-pressed")).toBe("true");
		await act(async () => {
			watching = true;
			first.resolve({
				results: [
					{
						status: "added",
						observation: publicPull(pull, project, observation).observation,
					},
				],
			});
		});
		expect(button(pull.number)).toBe(firstButton);
		expect(screen.getByRole("table", { name: "Pull requests" })).toBe(table);
		expect(firstButton.getAttribute("aria-pressed")).toBe("true");
		expect(firstButton.disabled).toBe(false);
		expect(api.loadCatalog).toHaveBeenCalledOnce();
		const feedback = screen.getByRole("status", { name: "Watch list updates" });
		expect(feedback.textContent).toContain("Already merged");
		expect(feedback.textContent).toContain("1 PR added");
	});
	it("accepted watch changes remain usable while cache revalidation is slow", async () => {
		const observation = fixtureObservation({ generation: 4 });
		const cacheRead = deferred<Awaited<ReturnType<typeof api.loadPulls>>>();
		vi.mocked(api.loadPulls)
			.mockResolvedValueOnce(fixture.pulls)
			.mockReturnValue(cacheRead.promise);
		vi.mocked(api.addWatches).mockResolvedValue({
			results: [
				{
					status: "added",
					observation: publicPull(pull, project, observation).observation,
				},
			],
		});
		const { result } = render();
		await loaded(result);
		await act(() => result.current.vm.toggleWatch(pull.id));
		expect(result.current.vm.pageRows[0]?.observation?.generation).toBe(4);
		expect(result.current.vm.pageRows[0]?.watching).toBe(true);
		expect(result.current.vm.busy).toBeNull();
		expect(result.current.vm.loading).toBe(false);
		expect(result.current.vm.pageRows[0]?.watchPending).toBe(false);
	});
	it("a network failure restores the local watch state and does not lock other actions", async () => {
		vi.mocked(api.addWatches).mockRejectedValue(
			new Error("Network unavailable"),
		);
		const { result } = render();
		await loaded(result);
		await act(async () => {
			expect(await result.current.vm.toggleWatch(pull.id)).toBe(false);
		});
		expect(result.current.vm.pageRows[0]?.watching).toBe(false);
		expect(result.current.vm.pageRows[0]?.watchPending).toBe(false);
		expect(result.current.vm.busy).toBeNull();
		expect(result.current.vm.mutationError).toContain("Network unavailable");
	});
	it("optimistically removes a watch, preserves its generation and restores it on a transport failure", async () => {
		const observation = fixtureObservation({ generation: 4 });
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [publicPull(pull, project, observation)],
		});
		let reject!: (error: Error) => void;
		vi.mocked(api.removeWatches).mockReturnValue(
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
		);
		const { result } = render();
		await loaded(result);
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.toggleWatch(pull.id);
		});
		expect(result.current.vm.pageRows[0]?.watching).toBe(false);
		expect(result.current.vm.pageRows[0]?.watchPending).toBe(true);
		expect(api.removeWatches).toHaveBeenCalledWith("cli", [observation]);
		await act(async () => {
			expect(await result.current.vm.toggleWatch(pull.id)).toBe(false);
			reject(new Error("Connection interrupted"));
			await write;
		});
		expect(api.removeWatches).toHaveBeenCalledOnce();
		expect(result.current.vm.pageRows[0]?.watching).toBe(true);
		expect(result.current.vm.pageRows[0]?.observation?.generation).toBe(4);
		expect(result.current.vm.busy).toBeNull();
	});
	it("ignores watch errors after unmount or changing source", async () => {
		for (const transition of ["unmount", "sample"] as const) {
			let reject!: (error: Error) => void;
			vi.mocked(api.addWatches).mockReturnValue(
				new Promise((_resolve, fail) => {
					reject = fail;
				}),
			);
			const { result, unmount } = render("/?source=cli");
			await loaded(result);
			let write!: Promise<boolean>;
			act(() => {
				write = result.current.vm.toggleWatch(pull.id);
			});
			if (transition === "unmount") unmount();
			else act(() => result.current.vm.setFilter({ source: "demo" }));
			await act(async () => {
				reject(new Error("Old Live command failed"));
				expect(await write).toBe(false);
			});
			if (transition === "sample") {
				expect(result.current.vm.mutationError).toBeNull();
				expect(result.current.vm.pageRows[0]?.watching).toBe(false);
				unmount();
			}
		}
	});
	it("does not start a watch against a project configuration being changed", async () => {
		const saved = deferred<Awaited<ReturnType<typeof patchProject>>>();
		vi.mocked(patchProject).mockReturnValue(saved.promise);
		const { result } = render();
		await loaded(result);
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.save(draft, project);
		});
		await act(async () => {
			expect(await result.current.vm.toggleWatch(pull.id)).toBe(false);
			saved.resolve(project);
			await write;
		});
		expect(api.addWatches).not.toHaveBeenCalled();
	});
	it.each([
		{ generation: 4, active: false },
		{ generation: 5, active: true },
	])("a late add receipt cannot overwrite a newer CLI watch state: %j", async (latest) => {
		const response = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
		const nextRead = deferred<Awaited<ReturnType<typeof api.loadPulls>>>();
		vi.mocked(api.addWatches).mockReturnValue(response.promise);
		const { result } = render();
		await loaded(result);
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.toggleWatch(pull.id);
		});
		const newer = publicPull(pull, project, fixtureObservation(latest));
		vi.mocked(api.loadPulls).mockResolvedValueOnce({
			...fixture.pulls,
			data: [newer],
		});
		await act(() => result.current.vm.reload());
		vi.mocked(api.loadPulls).mockReturnValue(nextRead.promise);
		await act(async () => {
			response.resolve({
				results: [
					{
						status: "added",
						observation: publicPull(
							pull,
							project,
							fixtureObservation({ generation: 4 }),
						).observation,
					},
				],
			});
			await write;
		});
		expect(result.current.vm.pageRows[0]?.observation).toMatchObject(latest);
		expect(result.current.vm.pageRows[0]?.watching).toBe(latest.active);
	});
	it.each(
		[
			{ projectKey: "ReplacementProject" },
			{ organization: "replacement-org" },
			{ id: "new-registration" },
		].flatMap((identity) =>
			[false, true].map((watched) => ({ identity, watched })),
		),
	)("fences optimistic state, selection and delayed receipts across project identity changes: %j", async ({
		identity,
		watched,
	}) => {
		const response = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
		vi.mocked(api.addWatches).mockReturnValue(response.promise);
		let current = publicPull();
		vi.mocked(api.loadPulls).mockImplementation(async () => ({
			...fixture.pulls,
			data: [current],
		}));
		vi.mocked(api.loadPull).mockImplementation(async () => ({
			...fixture.envelope,
			data: current,
		}));
		const { result } = render(`/?pr=${encodeURIComponent(pull.id)}`);
		await loaded(result);
		await waitFor(() => expect(result.current.vm.detailLoading).toBe(false));
		act(() => result.current.vm.selectPage(true));
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.toggleWatch(pull.id);
		});
		expect(result.current.vm.pageRows[0]?.watchPending).toBe(true);
		const nextProject = { ...project, ...identity };
		const nextObservation = watched
			? fixtureObservation({
					id: "new-watch",
					ref: makeWatchRef(nextProject, pull.repository, pull.number),
				})
			: null;
		current = publicPull(pull, nextProject, nextObservation);
		await act(() => result.current.vm.reload());
		for (const row of [
			result.current.vm.pageRows[0],
			result.current.vm.selected,
		]) {
			expect(row?.watching).toBe(watched);
			expect(row?.watchPending).toBe(false);
		}
		expect(result.current.vm.watchPending(pull.id)).toBe(false);
		expect(result.current.vm.selectedCount).toBe(0);
		act(() => result.current.vm.selectPage(true));
		vi.mocked(api.loadPulls).mockReturnValue(new Promise(() => {}));
		vi.mocked(api.loadPull).mockReturnValue(new Promise(() => {}));
		await act(async () => {
			response.resolve({
				results: [
					{
						status: "added",
						observation: publicPull(pull, project, fixtureObservation())
							.observation,
					},
				],
			});
			await write;
		});
		for (const row of [
			result.current.vm.pageRows[0],
			result.current.vm.selected,
		]) {
			expect(row?.observation?.id ?? null).toBe(nextObservation?.id ?? null);
			expect(row?.watching).toBe(watched);
		}
		expect(result.current.vm.selectedCount).toBe(1);
	});
	it("toggles a row's watch without opening details and preserves unrelated batch selections", async () => {
		let watching = false;
		const observation = fixtureObservation({ generation: 4 });
		vi.mocked(api.loadPulls).mockImplementation(async () => ({
			...fixture.pulls,
			data: [
				publicPull(pull, project, watching ? observation : null),
				publicPull({ ...pull, id: "second" }),
			],
		}));
		vi.mocked(api.addWatches).mockImplementation(async () => {
			watching = true;
			return { results: [{ status: "added" }] };
		});
		vi.mocked(api.removeWatches).mockImplementation(async () => {
			watching = false;
			return { results: [{ status: "removed" }] };
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.toggleSelection("second", true));
		await act(() => result.current.vm.toggleWatch(pull.id));
		expect(result.current.vm.selected).toBeNull();
		expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id]);
		expect(result.current.vm.pageRows[0]?.observation?.active).toBe(true);
		await act(() => result.current.vm.toggleWatch(pull.id));
		expect(api.removeWatches).toHaveBeenCalledWith("cli", [observation]);
		expect(result.current.vm.pageRows[0]?.observation).toBeNull();
		expect(result.current.vm.selectedIds).toEqual(new Set(["second"]));
		await act(async () =>
			expect(await result.current.vm.toggleWatch("missing")).toBe(false),
		);
	});
	it("renders a watch toggle in its own column before the PR title", async () => {
		renderView(
			<MemoryRouter>
				<WorkbenchProvider>
					<PullsPage />
				</WorkbenchProvider>
			</MemoryRouter>,
		);
		const toggle = await screen.findByRole("button", {
			name: `Watch PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`,
		});
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		const row = toggle.closest("tr")!;
		expect(within(row).getAllByRole("cell")[1]).toBe(toggle.closest("td"));
		expect(
			within(row)
				.getAllByRole("cell")[2]
				?.contains(
					within(row).getByRole("button", {
						name: `Open PR #${pull.number}: ${pull.title}`,
					}),
				),
		).toBe(true);
		fireEvent.click(toggle);
		await waitFor(() =>
			expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id]),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	it("keeps unconfirmed batch items selected when the server omits a result", async () => {
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [publicPull(), publicPull({ ...pull, id: "second" })],
		});
		vi.mocked(api.addWatches).mockResolvedValue({
			results: [{ status: "added" }],
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectPage(true));
		await act(() => result.current.vm.watchSelected(true));
		expect(result.current.vm.selectedIds).toEqual(new Set(["second"]));
		expect(result.current.vm.mutationError).toContain(
			"second: Missing command result",
		);
		expect(result.current.vm.notice).toContain("1 PR added");
	});
	it("batch add removes only successful selections and keeps per-item errors visible", async () => {
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [publicPull(), publicPull({ ...pull, id: "second" })],
		});
		vi.mocked(api.addWatches).mockResolvedValue({
			results: [
				{ status: "added" },
				{
					status: "rejected",
					error: {
						code: "PR_TERMINAL",
						message: "Already merged",
						retryable: false,
					},
				},
			],
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectPage(true));
		await act(() => result.current.vm.watchSelected(true));
		expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id, "second"]);
		expect(result.current.vm.selectedIds).toEqual(new Set(["second"]));
		expect(result.current.vm.mutationError).toContain("Already merged");
		expect(result.current.vm.notice).toContain("1 PR added");
	});
	it("captures the selected generation instead of deleting a newer CLI watch", async () => {
		const first = publicPull(pull, project, fixtureObservation());
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [first],
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectPage(true));
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			data: [publicPull(pull, project, fixtureObservation({ generation: 2 }))],
		});
		await act(() => result.current.vm.reload());
		vi.mocked(api.removeWatches).mockResolvedValue({
			results: [{ status: "conflict" }],
		});
		await act(() => result.current.vm.watchSelected(false));
		expect(api.removeWatches).toHaveBeenCalledWith("cli", [
			expect.objectContaining({ generation: 1 }),
		]);
		expect(result.current.vm.selectedCount).toBe(1);
		expect(result.current.vm.mutationError).toContain("generation changed");
	});
	it("detail watch controls use the same API and explicit refresh only targets saved watches", async () => {
		const { result } = render(`/?pr=${encodeURIComponent(pull.id)}`);
		await loaded(result);
		await waitFor(() => expect(result.current.vm.detailLoading).toBe(false));
		await act(() => result.current.vm.toggleWatch());
		expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id]);
		await act(() => result.current.vm.refreshPull());
		expect(api.refreshWatches).toHaveBeenCalledWith("cli", undefined);
		expect(result.current.vm.notice).toBe("The watch list is empty.");
		await act(() => result.current.vm.refreshPull(pull.id));
		expect(api.refreshWatches).toHaveBeenLastCalledWith("cli", pull.id);
		act(() => result.current.vm.selectPull(null));
		await act(async () =>
			expect(await result.current.vm.toggleWatch()).toBe(false),
		);
	});
	it("empty selections are no-ops and concurrent clicks do not duplicate writes", async () => {
		const { result } = render();
		await loaded(result);
		await act(() => result.current.vm.watchSelected(true));
		expect(api.addWatches).not.toHaveBeenCalled();
		act(() => result.current.vm.selectPage(true));
		const pending = deferred<{ results: { status: "added" }[] }>();
		vi.mocked(api.addWatches).mockReturnValue(pending.promise);
		let running!: Promise<boolean>;
		act(() => {
			running = result.current.vm.watchSelected(true);
		});
		await act(async () =>
			expect(await result.current.vm.watchSelected(true)).toBe(false),
		);
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await act(async () => {
			pending.resolve({ results: [{ status: "added" }] });
			await running;
		});
		expect(result.current.vm.notice).toBeNull();
		expect(api.addWatches).toHaveBeenCalledOnce();
	});
	it("pending refs stay visible and removals surface conflicts and rejections", async () => {
		const watch = fixtureObservation();
		const item = {
			...publicPull(pull, project, watch).observation!,
			pull: null,
			pullId: null,
		};
		vi.mocked(api.loadPending).mockResolvedValue({
			...fixture.envelope,
			data: [item],
			page: { ...fixture.page, total: 1 },
		});
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.pendingTotal).toBe(1));
		await act(() => result.current.vm.removePending(watch));
		expect(result.current.vm.notice).toContain("removed");
		for (const status of ["conflict", "rejected"] as const) {
			vi.mocked(api.removeWatches).mockResolvedValue({ results: [{ status }] });
			await act(() => result.current.vm.removePending(watch));
			expect(result.current.vm.mutationError).not.toBeNull();
		}
	});
	it("pending-reference removal is optimistic and rolls back a rejected generation without locking the page", async () => {
		const watch = fixtureObservation();
		vi.mocked(api.loadPending).mockResolvedValue({
			...fixture.envelope,
			data: [
				{
					...publicPull(pull, project, watch).observation!,
					pull: null,
					pullId: null,
				},
			],
			page: { ...fixture.page, total: 1 },
		});
		const response = deferred<Awaited<ReturnType<typeof api.removeWatches>>>();
		vi.mocked(api.removeWatches).mockReturnValue(response.promise);
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.pendingTotal).toBe(1));
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.removePending(watch);
		});
		expect(result.current.vm.pendingObservations).toEqual([]);
		expect(result.current.vm.pendingTotal).toBe(0);
		expect(result.current.vm.busy).toBeNull();
		await act(async () => {
			response.resolve({ results: [{ status: "conflict" }] });
			await write;
		});
		expect(result.current.vm.pendingTotal).toBe(1);
		expect(result.current.vm.pendingObservations[0]?.id).toBe(watch.id);
		expect(result.current.vm.mutationError).toContain("generation changed");
	});
	it("pending errors are visible and retried independently while retaining the last good page", async () => {
		const response = {
			...fixture.envelope,
			data: [
				{
					...publicPull(pull, project, fixtureObservation()).observation!,
					pull: null,
					pullId: null,
				},
			],
			page: { ...fixture.page, total: 1 },
		};
		vi.mocked(api.loadPending)
			.mockRejectedValueOnce(new ApiError("Pending unavailable", 503))
			.mockResolvedValue(response);
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() =>
			expect(result.current.vm.pendingError).toBe("Pending unavailable"),
		);
		expect(result.current.vm.pendingLoading).toBe(false);
		expect(result.current.vm.pendingObservations).toEqual([]);
		const listReads = vi.mocked(api.loadPulls).mock.calls.length;
		await act(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingTotal).toBe(1);
		expect(result.current.vm.pendingError).toBeNull();
		expect(api.loadPulls).toHaveBeenCalledTimes(listReads);
		vi.mocked(api.loadPending).mockRejectedValueOnce(new Error("Network lost"));
		await act(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingError).toBe("Network lost");
		expect(result.current.vm.pendingObservations).toEqual(response.data);
	});
	it("a delayed pending removal never hides a newly re-added generation", async () => {
		const watch = fixtureObservation();
		const item = {
			...publicPull(pull, project, watch).observation!,
			pull: null,
			pullId: null,
		};
		vi.mocked(api.loadPending).mockResolvedValue({
			...fixture.envelope,
			data: [item],
			page: { ...fixture.page, total: 1 },
		});
		const response = deferred<Awaited<ReturnType<typeof api.removeWatches>>>();
		const nextRead = deferred<Awaited<ReturnType<typeof api.loadPending>>>();
		vi.mocked(api.removeWatches).mockReturnValue(response.promise);
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.pendingTotal).toBe(1));
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.removePending(watch);
		});
		vi.mocked(api.loadPending).mockResolvedValueOnce({
			...fixture.envelope,
			data: [{ ...item, generation: 2 }],
			page: { ...fixture.page, total: 1 },
		});
		await act(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingTotal).toBe(1);
		vi.mocked(api.loadPending).mockReturnValue(nextRead.promise);
		await act(async () => {
			response.resolve({
				results: [
					{ status: "removed", observation: { ...item, active: false } },
				],
			});
			await write;
		});
		expect(result.current.vm.pendingObservations[0]?.generation).toBe(2);
		expect(result.current.vm.pendingTotal).toBe(1);
	});
	it("all 21 pending watches are reachable, and removing the last page or changing scope resets its page", async () => {
		let items = Array.from({ length: 21 }, (_, i) => ({
			...publicPull(pull, project, fixtureObservation()).observation!,
			id: `pending-${i}`,
			pull: null,
			pullId: null,
		}));
		vi.mocked(api.loadPending).mockImplementation(
			async (_source, _signal, _scope, page = 1) => ({
				...fixture.envelope,
				data: items.slice((page - 1) * 20, page * 20),
				page: { ...fixture.page, total: items.length },
			}),
		);
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.pendingTotal).toBe(21));
		expect(result.current.vm.pendingObservations).toHaveLength(20);
		act(() => result.current.vm.setPendingPage(2));
		await waitFor(() =>
			expect(result.current.vm.pendingObservations[0]?.id).toBe("pending-20"),
		);
		vi.mocked(api.removeWatches).mockImplementation(async (_source, refs) => {
			items = items.filter((item) => item.id !== refs[0]?.id);
			return { results: [{ status: "removed" }] };
		});
		await act(() =>
			result.current.vm.removePending(
				result.current.vm.pendingObservations[0]!,
			),
		);
		await waitFor(() => expect(result.current.vm.pendingPage).toBe(1));
		await waitFor(() =>
			expect(result.current.vm.pendingObservations).toHaveLength(20),
		);
		act(() => result.current.vm.setPendingPage(2));
		act(() => result.current.vm.setFilter({ repository: "another" }));
		await loaded(result);
		expect(result.current.vm.pendingPage).toBe(1);
		act(() => result.current.vm.setFilter({ repository: "" }));
		await loaded(result);
		expect(result.current.vm.pendingPage).toBe(1);
	});
	it("retains failed selections and clears errors explicitly", async () => {
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectPage(true));
		vi.mocked(api.addWatches).mockRejectedValue("offline");
		await act(() => result.current.vm.watchSelected(true));
		expect(result.current.vm.mutationError).toBe("Request failed");
		expect(result.current.vm.selectedCount).toBe(1);
		act(() => result.current.vm.clearMutationError());
		expect(result.current.vm.mutationError).toBeNull();
	});
});

describe("project settings and explicit discovery", () => {
	it("Sample discovery uses server capability in built assets and denies writes when the server disables it", async () => {
		vi.stubEnv("DEV", false);
		try {
			vi.mocked(api.loadCollector).mockResolvedValue({
				...queryFixture("demo").collector,
				sampleCommandsEnabled: true,
			});
			const { result } = render("/?source=demo");
			await loaded(result);
			const sample = { ...project, source: "demo" as const };
			expect(result.current.vm.canScan(sample)).toBe(true);
			expect(result.current.vm.data?.demoMode).toBe(true);
			vi.mocked(api.loadCollector).mockResolvedValue({
				...queryFixture("demo").collector,
				sampleCommandsEnabled: false,
			});
			await act(() => result.current.vm.reload());
			expect(result.current.vm.canScan(sample)).toBe(false);
			expect(result.current.vm.data?.demoMode).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("saves project CRUD and readiness without collecting, using captured revisions", async () => {
		const { result } = render();
		await loaded(result);
		await act(() => result.current.vm.save(draft, null));
		expect(createProject).toHaveBeenCalledWith(draft);
		await act(() => result.current.vm.save(draft, project));
		expect(patchProject).toHaveBeenCalledWith(project.id, {
			...draft,
			revision: project.revision,
		});
		await act(() => result.current.vm.saveReadiness(project, []));
		expect(patchReadiness).toHaveBeenCalledWith(
			project.id,
			project.readinessRevision ?? 1,
			[],
		);
		await act(() => result.current.vm.remove(project));
		expect(deleteProject).toHaveBeenCalledWith(project.id, project.revision);
		expect(api.discover).not.toHaveBeenCalled();
	});
	it("accepts only valid detail cooldowns and never re-enables automatic discovery", async () => {
		const { result } = render();
		await loaded(result);
		expect(result.current.vm.detailCooldownSeconds).toBe(300);
		await act(async () =>
			expect(await result.current.vm.setRefreshCooldown("list", 120)).toBe(
				false,
			),
		);
		await act(async () =>
			expect(await result.current.vm.setRefreshCooldown("details", 1)).toBe(
				false,
			),
		);
		await act(() => result.current.vm.setRefreshCooldown("details", 600));
		expect(patchRefreshSettings).toHaveBeenCalledWith({
			detailCooldownSeconds: 600,
		});
	});
	it("shows cooldown save progress and failures on Directory and allows reselection", async () => {
		const save = deferred<Awaited<ReturnType<typeof patchRefreshSettings>>>();
		vi.mocked(patchRefreshSettings).mockReturnValueOnce(save.promise);
		renderView(
			<MemoryRouter initialEntries={["/developers"]}>
				<WorkbenchProvider>
					<CollectionStatus />
				</WorkbenchProvider>
			</MemoryRouter>,
		);
		const interval = await screen.findByRole("combobox", {
			name: "Watched PR refresh cooldown",
		});
		await waitFor(() =>
			expect((interval as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(interval);
		fireEvent.click(screen.getByRole("option", { name: "Manual" }));
		await screen.findByText("Saving cooldown…");
		expect((interval as HTMLButtonElement).disabled).toBe(true);
		await act(() => save.reject(new Error("Cannot save refresh cooldown")));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Cannot save refresh cooldown",
		);
		expect(interval.textContent).toBe("5 min");
		expect((interval as HTMLButtonElement).disabled).toBe(false);
		vi.mocked(patchRefreshSettings).mockResolvedValueOnce([]);
		vi.mocked(api.loadCollector).mockResolvedValue({
			...fixture.collector,
			detailCooldownSeconds: 0,
		});
		fireEvent.click(interval);
		fireEvent.click(screen.getByRole("option", { name: "Manual" }));
		await screen.findByText("Watch refresh cooldown saved.");
		expect(screen.queryByRole("alert")).toBeNull();
		await waitFor(() => expect(interval.textContent).toBe("Manual"));
	});
	it.each([
		"success",
		"failure",
	] as const)("retains global cooldown save feedback across a source switch (%s)", async (outcome) => {
		const save = deferred<Awaited<ReturnType<typeof patchRefreshSettings>>>();
		vi.mocked(patchRefreshSettings).mockReturnValueOnce(save.promise);
		const { result } = render();
		await loaded(result);
		let write!: Promise<boolean>;
		act(() => {
			write = result.current.vm.setRefreshCooldown("details", 600);
		});
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await loaded(result);
		await act(async () => {
			if (outcome === "success") save.resolve([]);
			else save.reject(new Error("Cannot save refresh cooldown"));
			expect(await write).toBe(outcome === "success");
		});
		expect(result.current.vm.feedbackKind).toBe("refresh-settings");
		expect(result.current.vm.busy).toBeNull();
		if (outcome === "success")
			expect(result.current.vm.notice).toBe("Watch refresh cooldown saved.");
		else
			expect(result.current.vm.mutationError).toBe(
				"Cannot save refresh cooldown",
			);
	});
	it.each([
		"receipt",
		"transport",
	] as const)("an earlier watch response cannot replace feedback from a later cooldown save (%s)", async (outcome) => {
		const watch = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
		vi.mocked(api.addWatches).mockReturnValueOnce(watch.promise);
		vi.mocked(patchRefreshSettings).mockRejectedValueOnce(
			new Error("Cannot save refresh cooldown"),
		);
		const { result } = render();
		await loaded(result);
		let watching!: Promise<boolean>;
		act(() => {
			watching = result.current.vm.toggleWatch(pull.id);
		});
		await act(() => result.current.vm.setRefreshCooldown("details", 600));
		await act(async () => {
			if (outcome === "receipt")
				watch.resolve({ results: [{ status: "added" }] });
			else watch.reject(new Error("Watch request failed"));
			await watching;
		});
		expect(result.current.vm.feedbackKind).toBe("refresh-settings");
		expect(result.current.vm.mutationError).toBe(
			"Cannot save refresh cooldown",
		);
		expect(result.current.vm.pageRows[0]?.watchPending).toBe(false);
	});
	it("repository filter selects the stable ID when an earlier repository has that name", async () => {
		const correct = fixture.catalog.data[0]!;
		vi.mocked(api.loadCatalog).mockResolvedValue({
			...fixture.catalog,
			data: [
				{
					...correct,
					key: "collision",
					repository: {
						...correct.repository,
						id: "other-id",
						name: correct.repository.id!,
					},
				},
				correct,
			],
		});
		const { result } = render(`/?repo=${correct.repository.id}`);
		await loaded(result);
		expect(result.current.vm.selectedRepository?.id).toBe(
			correct.repository.id,
		);
		await act(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${correct.repository.id}`,
		});
	});
	it("Discover retains the selected ADO ID when its name is another repository ID", async () => {
		const firstId = "11111111-1111-1111-1111-111111111111";
		const secondId = "22222222-2222-2222-2222-222222222222";
		const repo = fixture.catalog.data[0]!;
		const baseUrl = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/`;
		vi.mocked(api.loadCatalog).mockResolvedValue({
			...fixture.catalog,
			data: [
				{
					...repo,
					key: "first",
					repository: {
						...repo.repository,
						id: firstId,
						name: "main",
						url: `${baseUrl}main`,
					},
				},
				{
					...repo,
					key: "second",
					repository: {
						...repo.repository,
						id: secondId,
						name: firstId,
						url: `${baseUrl}${firstId}`,
					},
				},
			],
		});
		const { result } = render();
		await loaded(result);
		act(() => result.current.vm.selectRepository("second"));
		expect(result.current.vm.selectedRepository?.id).toBe(secondId);
		await act(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: `${baseUrl}${secondId}`,
		});
	});
	it("explicit discovery respects repository identity and reports scheduling failures", async () => {
		const { result } = render();
		await loaded(result);
		await act(async () =>
			expect(await result.current.vm.discoverRepo()).toBe(false),
		);
		act(() => result.current.vm.selectRepository("repo-key"));
		await act(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.id}`,
		});
		await act(() => result.current.vm.scan(project.id));
		expect(api.discover).toHaveBeenCalledWith("cli", { projectId: project.id });
		vi.mocked(api.discover).mockRejectedValue(new Error("Scheduler offline"));
		await act(() => result.current.vm.scan());
		expect(result.current.vm.mutationError).toBe("Scheduler offline");
		expect(result.current.vm.canScan({ ...project, provider: "github" })).toBe(
			false,
		);
	});
	it("repository pages remain useful with empty catalogs or a failed project read", async () => {
		vi.mocked(api.loadCatalog).mockResolvedValue({
			...fixture.catalog,
			data: [],
			projects: [{ ...publicProject(project), repositories: [] }],
		});
		const { result } = render("/projects");
		await loaded(result);
		expect(result.current.vm.projects[0]?.total).toBe(0);
		vi.mocked(api.loadCatalog).mockRejectedValue(new Error("No cache"));
		await act(() => result.current.vm.reload());
		expect(result.current.vm.error).toBe("No cache");
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
