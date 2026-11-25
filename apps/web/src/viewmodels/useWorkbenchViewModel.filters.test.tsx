// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/models/monitoringApi";
import {
	DEFAULT_PULL_FILTER,
	PULL_FILTER_STORAGE_KEY,
	readPullFilter,
} from "@/models/workbench";
import { pullHref } from "@/models/workspaceLocation";
import {
	fixtureObservation,
	fixtureProject as project,
	publicProject,
	publicPull,
	fixturePull as pull,
} from "@/test/monitoring-fixture";
import { awaitReactAct } from "@/test/reactAct";
import {
	deferred,
	fixture,
	loaded,
	renderWorkbenchHook as render,
	renderView,
	resetWorkbenchMocks,
} from "@/test/workbench-test-helpers";
import { PullsPage } from "@/views/workbench/PullsPage";
import { WorkbenchProvider } from "./WorkbenchProvider";

vi.mock("@/models/prCollectionsApi", () => ({
	loadCollections: vi.fn(async () => ({ items: [] })),
	loadMemberships: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@/models/aiScheduleApi", () => ({
	loadAiSchedule: vi.fn(async () => ({
		revision: 1,
		cooldownSeconds: 300,
		pulls: [],
		projects: [],
	})),
	sendAiPresence: vi.fn(async () => undefined),
	tickAi: vi.fn(async () => undefined),
}));
vi.mock("@/models/workbenchApi", () => ({
	createProject: vi.fn(),
	deleteProject: vi.fn(),
	patchProject: vi.fn(),
	patchRefreshSettings: vi.fn(),
}));
vi.mock("@/models/monitoringApi", async (original) => ({
	...(await original<typeof import("@/models/monitoringApi")>()),
	loadCatalog: vi.fn(),
	loadPulls: vi.fn(),
	loadCollector: vi.fn(),
	loadCollectorGroups: vi.fn(async () => ({
		data: [],
		nextCursor: null,
		generatedAt: new Date().toISOString(),
	})),
	loadCollectorHistory: vi.fn(),
	loadPull: vi.fn(),
	lookupPull: vi.fn(),
	loadPending: vi.fn(),
	addWatches: vi.fn(),
	removeWatches: vi.fn(),
	discover: vi.fn(),
	refreshWatches: vi.fn(),
}));

beforeEach(() => {
	resetWorkbenchMocks(api);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("filters, server pages and temporary selection", () => {
	it("resolves a friendly PR path in its explicit scope, independently of saved filters and legacy query IDs", async () => {
		localStorage.setItem(PULL_FILTER_STORAGE_KEY, "source=sample&state=closed");
		const href = pullHref(project, pull);
		const { result } = render(`${href}?pr=unrelated-id&watching=watching`);
		await loaded(result);
		await waitFor(() => expect(result.current.vm.detailLoading).toBe(false));
		expect(api.lookupPull).toHaveBeenCalledWith(
			"cli",
			{
				repositoryUrl: `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.name}`,
				number: pull.number,
			},
			expect.any(AbortSignal),
		);
		expect(api.loadPull).not.toHaveBeenCalled();
		expect(result.current.vm.selected?.pull.id).toBe(pull.id);
		expect(result.current.vm.filter).toMatchObject({
			source: "cli",
			state: "open",
			watching: "watching",
		});
		expect(
			`${result.current.location.pathname}${result.current.location.search}`,
		).toBe(`${href}?watching=watching`);
		await awaitReactAct(() => result.current.vm.reloadDetail());
		expect(api.loadPull).toHaveBeenCalledWith(
			"cli",
			pull.id,
			expect.any(AbortSignal),
		);
		expect(api.lookupPull).toHaveBeenCalledTimes(1);
	});
	it("restores list filters and PR details with Back and Forward without adding a history entry per keystroke", async () => {
		const { result } = render("/prs");
		await loaded(result);
		act(() => result.current.vm.setFilter({ watching: "watching" }));
		act(() => result.current.vm.setFilter({ query: "rev" }));
		act(() => result.current.vm.setFilter({ query: "review" }));
		await loaded(result);
		act(() => result.current.vm.selectPull(pull.id));
		await waitFor(() =>
			expect(result.current.vm.selected?.pull.id).toBe(pull.id),
		);
		expect(result.current.location.pathname).toBe(pullHref(project, pull));
		act(() => result.current.vm.selectPull(null));
		expect(result.current.location.pathname).toBe("/prs");
		act(() => result.current.navigate(-1));
		await waitFor(() =>
			expect(result.current.vm.selected?.pull.id).toBe(pull.id),
		);
		act(() => result.current.navigate(-1));
		expect(result.current.location.pathname).toBe("/prs");
		expect(result.current.vm.filter).toMatchObject({
			watching: "watching",
			query: "review",
		});
		act(() => result.current.navigate(-1));
		expect(result.current.vm.filter).toMatchObject({
			source: "cli",
			watching: "all",
			query: "",
		});
		act(() => result.current.navigate(1));
		expect(result.current.vm.filter).toMatchObject({
			watching: "watching",
			query: "review",
		});
	});
	it("does not fetch legacy query IDs on invalid resource paths or trace IDs on machine pages", async () => {
		const { result } = render("/prs/ado/org/project/repo/0?pr=unrelated-id");
		await loaded(result);
		expect(result.current.vm.detailError).toBe("Invalid PR address");
		expect(result.current.vm.selected).toBeNull();
		expect(api.loadPull).not.toHaveBeenCalled();
		expect(api.lookupPull).not.toHaveBeenCalled();
		act(() => result.current.navigate("/sm/ado/org/project/repo?pr=1"));
		await loaded(result);
		expect(result.current.vm.detailError).toBeNull();
		expect(api.loadPull).not.toHaveBeenCalled();
		expect(api.lookupPull).not.toHaveBeenCalled();
	});
	it("fences an in-flight friendly detail lookup when switching sources and restores it with Back", async () => {
		const pending = deferred<Awaited<ReturnType<typeof api.lookupPull>>>();
		vi.mocked(api.lookupPull).mockReturnValueOnce(pending.promise);
		const href = pullHref(project, pull);
		const { result } = render(href);
		await loaded(result);
		expect(result.current.vm.detailLoading).toBe(true);
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await loaded(result);
		await awaitReactAct(async () =>
			pending.resolve({ ...fixture.envelope, data: fixture.pulls.data[0]! }),
		);
		expect(result.current.location.pathname).toBe("/prs");
		expect(result.current.vm.filter.source).toBe("demo");
		expect(result.current.vm.selected).toBeNull();
		act(() => result.current.navigate(-1));
		await waitFor(() =>
			expect(result.current.vm.selected?.pull.id).toBe(pull.id),
		);
		expect(result.current.vm.filter.source).toBe("cli");
		expect(result.current.location.pathname).toBe(href);
	});
	it("clears the traced PR when its source or repository scope changes, preserving it for display filters", async () => {
		const { result } = render("/state-machines?source=cli&trace=old-pr");
		await loaded(result);
		act(() => result.current.vm.setFilter({ query: "find" }));
		expect(
			new URLSearchParams(result.current.location.search).get("trace"),
		).toBe("old-pr");
		act(() => result.current.vm.setFilter({ repository: "another" }));
		expect(
			new URLSearchParams(result.current.location.search).has("trace"),
		).toBe(false);
		act(() =>
			result.current.navigate("/state-machines?source=cli&trace=old-pr"),
		);
		act(() => result.current.vm.setFilter({ source: "demo" }));
		expect(
			new URLSearchParams(result.current.location.search).has("trace"),
		).toBe(false);
	});
	it.each(["/", "/prs"])(
		"restores saved filters at %s and gives explicit URL filters priority",
		async (path) => {
			localStorage.setItem(
				PULL_FILTER_STORAGE_KEY,
				"source=demo&q=review+me&org=northstar&project=core&repo=repo-id&draft=include&author=one&author=two&state=all&watching=watching&sort=updated&direction=asc",
			);
			const first = render(path);
			await loaded(first.result);
			expect(first.result.current.vm.filter).toEqual({
				source: "demo",
				query: "review me",
				organization: "northstar",
				projectId: "core",
				repository: "repo-id",
				draft: "include",
				authors: ["one", "two"],
				state: "all",
				status: "all",
				watching: "watching",
				sort: "updated",
				sortDirection: "asc",
			});
			expect(first.result.current.location.pathname).toBe("/prs");
			expect(
				new URLSearchParams(first.result.current.location.search).get("source"),
			).toBe("sample");
			first.unmount();
			const second = render(`${path}?source=cli`);
			await loaded(second.result);
			expect(second.result.current.vm.filter).toEqual({
				...DEFAULT_PULL_FILTER,
				source: "cli",
			});
		},
	);
	it("switches the policy editor source without retaining a foreign project scope", async () => {
		const { result } = render(
			"/policy-instructions/ado/northstar/Platform/repo?source=live",
		);
		await loaded(result);
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await loaded(result);
		expect(result.current.location.pathname).toBe("/policy-instructions");
		expect(result.current.vm.filter.source).toBe("demo");
	});

	it.each([
		"/sm/ado/northstar/Platform/repo?pr=1",
		"/sm?source=live&tab=priority",
		"/policy-instructions/ado/northstar/Platform/repo?source=live",
		"/projects?source=live",
		pullHref(project, pull),
	])(
		"keeps list preferences when visiting %s and returning through the sidebar",
		async (path) => {
			const saved =
				"source=sample&draft=only&status=attention&watching=watching&sort=progress&direction=asc";
			localStorage.setItem(PULL_FILTER_STORAGE_KEY, saved);
			const { result } = render(path);
			await loaded(result);
			expect(localStorage.getItem(PULL_FILTER_STORAGE_KEY)).toBe(saved);
			act(() => result.current.navigate(result.current.vm.pullsHref));
			await loaded(result);
			expect(result.current.vm.filter).toMatchObject({
				source: "demo",
				draft: "only",
				status: "attention",
				watching: "watching",
				sort: "progress",
				sortDirection: "asc",
			});
		},
	);
	it("persists changed filters and sort direction across reloads, including clearing them", async () => {
		const first = render("/prs");
		await loaded(first.result);
		act(() =>
			first.result.current.vm.setFilter({
				watching: "unwatched",
				status: "attention",
				draft: "include",
				authors: ["one", "two"],
				query: "review",
				sort: "title",
				sortDirection: "desc",
			}),
		);
		const expected = first.result.current.vm.filter;
		expect(
			readPullFilter(
				new URLSearchParams(localStorage.getItem(PULL_FILTER_STORAGE_KEY)!),
				true,
			),
		).toEqual(expected);
		const url = `${first.result.current.location.pathname}${first.result.current.location.search}`;
		first.unmount();
		const reloaded = render(url);
		await loaded(reloaded.result);
		expect(reloaded.result.current.vm.filter).toEqual(expected);
		reloaded.unmount();
		const reopened = render("/prs");
		await loaded(reopened.result);
		expect(reopened.result.current.vm.filter).toEqual(expected);
		act(() =>
			reopened.result.current.vm.setFilter({
				...DEFAULT_PULL_FILTER,
				source: "cli",
			}),
		);
		expect(localStorage.getItem(PULL_FILTER_STORAGE_KEY)).toBe("source=live");
		reopened.unmount();
		const cleared = render("/prs");
		await loaded(cleared.result);
		expect(cleared.result.current.vm.filter).toEqual({
			...DEFAULT_PULL_FILTER,
			source: "cli",
		});
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
		await awaitReactAct(async () => {});
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
		await awaitReactAct(() => result.current.vm.discoverRepo());
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
		await awaitReactAct(async () =>
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
	])(
		"does not retarget a delayed repository resolution after its project identity changes (%j)",
		async (changed) => {
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
			await awaitReactAct(() => response.resolve(fixture.catalog));
			expect(result.current.vm.selectedRepository).toBeNull();
			expect(result.current.vm.filter.repository).toBe(url);
			expect(
				new URLSearchParams(localStorage.getItem(PULL_FILTER_STORAGE_KEY)!).get(
					"repo",
				),
			).toBe(url);
			await awaitReactAct(async () =>
				expect(await result.current.vm.discoverRepo()).toBe(false),
			);
			expect(api.discover).not.toHaveBeenCalled();
		},
	);
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
		await awaitReactAct(async () => {});
		expect(first.result.current.vm.page).toBe(3);
		vi.mocked(api.loadPulls).mockResolvedValue(fixture.pulls);
		await awaitReactAct(() => first.result.current.vm.reload());
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
