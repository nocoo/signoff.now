import type { ProjectWrite } from "@signoff/domain/workbench";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
	useProjectFormViewModel,
	useWorkbenchViewModel,
} from "./useWorkbenchViewModel";

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
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
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
		vi.mocked(api.loadPull).mockRejectedValue(new Error("PR is not cached"));
		act(() => result.current.vm.selectPull("missing"));
		await waitFor(() => expect(result.current.vm.missingSelection).toBe(true));
		expect(result.current.vm.detailError).toBe("PR is not cached");
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
		expect(result.current.vm.selectedCount).toBe(0);
	});
});

describe("shared watch mutations", () => {
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
	it("explicit discovery respects repository identity and reports scheduling failures", async () => {
		const { result } = render();
		await loaded(result);
		await act(async () =>
			expect(await result.current.vm.discoverRepo()).toBe(false),
		);
		act(() => result.current.vm.selectRepository("repo-key"));
		await act(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: fixture.catalog.data[0]!.repository.url,
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
