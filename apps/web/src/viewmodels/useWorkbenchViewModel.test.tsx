// @vitest-environment happy-dom
import type { ProjectWrite } from "@signoff/domain/workbench";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/models/monitoringApi";
import { PULL_FILTER_STORAGE_KEY } from "@/models/workbench";
import {
	createProject,
	deleteProject,
	patchProject,
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
import { awaitReactAct } from "@/test/reactAct";
import {
	deferred,
	draft,
	fixture,
	loaded,
	renderWorkbenchHook as render,
	resetWorkbenchMocks,
} from "@/test/workbench-test-helpers";
import { useProjectFormViewModel } from "./useWorkbenchViewModel";

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
			await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {});
		const reads = [
			api.loadPulls,
			api.loadPull,
			api.loadCatalog,
			api.loadPending,
		];
		for (const read of reads) vi.mocked(read).mockClear();
		await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {});
		vi.mocked(api.loadPulls).mockClear();
		const slow = deferred<typeof fixture.pulls>();
		vi.mocked(api.loadPulls).mockImplementationOnce(() => slow.promise);
		vi.mocked(api.loadPull).mockRejectedValueOnce(
			new Error("Detail unavailable"),
		);
		revision = "2";
		await awaitReactAct(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(result.current.vm.detailError).toBe("Detail unavailable");
		expect(result.current.vm.rows).toHaveLength(1);
		expect(result.current.vm.loading).toBe(false);
		for (revision of ["3", "4"])
			await awaitReactAct(async () => {
				await vi.advanceTimersByTimeAsync(3000);
			});
		expect(api.loadPulls).toHaveBeenCalledTimes(1);
		vi.mocked(api.loadPulls).mockResolvedValue({
			...fixture.pulls,
			dataRevision: "4",
			data: [{ ...fixture.pulls.data[0]!, title: "Newest publication" }],
		});
		await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {});
		vi.mocked(api.loadCatalog).mockClear();
		visibility.mockReturnValue("hidden");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		revision = "2";
		await awaitReactAct(async () => {
			await vi.advanceTimersByTimeAsync(60000);
		});
		expect(api.loadCatalog).not.toHaveBeenCalled();
		visibility.mockReturnValue("visible");
		await awaitReactAct(async () => {
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
		await awaitReactAct(() => result.current.vm.reload());
		expect(result.current.vm.error).toBe("Read failed");
		expect(result.current.vm.rows).toHaveLength(1);
		await awaitReactAct(() => result.current.vm.reload());
		expect(result.current.vm.error).toBeNull();
	});
	it("never displays a late Live result in Sample", async () => {
		const old = deferred<typeof fixture.pulls>();
		vi.mocked(api.loadPulls).mockReturnValueOnce(old.promise);
		const { result } = render();
		await awaitReactAct(async () => {});
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await loaded(result);
		await awaitReactAct(async () => old.resolve(fixture.pulls));
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
		await awaitReactAct(() => result.current.vm.reloadDetail());
		expect(result.current.vm.selected?.pull.id).toBe("off-page");
		expect(result.current.vm.detailError).toBeNull();
		expect(api.loadPulls).toHaveBeenCalledTimes(listReads);
		vi.mocked(api.loadPull).mockRejectedValueOnce(new Error("Connection lost"));
		await awaitReactAct(() => result.current.vm.reloadDetail());
		expect(result.current.vm.selected?.pull.description).toBe("Full detail");
		expect(result.current.vm.detailError).toBe("Connection lost");
	});
	it("changing routes stops the PR page query while preserving global source and catalog", async () => {
		localStorage.setItem(
			PULL_FILTER_STORAGE_KEY,
			"source=live&q=review&watching=watching&sort=title&direction=desc&repo=old-repo&author=old-author",
		);
		const { result } = render("/projects?source=live");
		await loaded(result);
		expect(api.loadPulls).not.toHaveBeenCalled();
		act(() => result.current.vm.setFilter({ source: "demo" }));
		act(() => result.current.navigate("/"));
		await loaded(result);
		expect(result.current.vm.filter).toMatchObject({
			source: "demo",
			query: "review",
			watching: "watching",
			sort: "title",
			sortDirection: "desc",
			repository: "",
			authors: [],
		});
		expect(result.current.vm.pageRows[0]?.project.source).toBe("demo");
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
			await awaitReactAct(() => result.current.vm.reload());
			expect(result.current.vm.canScan(sample)).toBe(false);
			expect(result.current.vm.data?.demoMode).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("saves project CRUD without collecting, using captured revisions", async () => {
		const { result } = render();
		await loaded(result);
		await awaitReactAct(() => result.current.vm.save(draft, null));
		expect(createProject).toHaveBeenCalledWith(draft);
		await awaitReactAct(() => result.current.vm.save(draft, project));
		expect(patchProject).toHaveBeenCalledWith(project.id, {
			...draft,
			revision: project.revision,
		});
		await awaitReactAct(() => result.current.vm.remove(project));
		expect(deleteProject).toHaveBeenCalledWith(project.id, project.revision);
		expect(api.discover).not.toHaveBeenCalled();
	});
	it("accepts valid discovery and detail cooldowns", async () => {
		const { result } = render();
		await loaded(result);
		expect(result.current.vm.detailCooldownSeconds).toBe(300);
		await awaitReactAct(async () =>
			expect(await result.current.vm.setRefreshCooldown("list", 120)).toBe(
				true,
			),
		);
		await awaitReactAct(async () =>
			expect(await result.current.vm.setRefreshCooldown("details", 1)).toBe(
				false,
			),
		);
		await awaitReactAct(() =>
			result.current.vm.setRefreshCooldown("details", 600),
		);
		expect(patchRefreshSettings).toHaveBeenCalledWith({
			detailCooldownSeconds: 600,
		});
	});
	it.each(["success", "failure"] as const)(
		"retains global cooldown save feedback across a source switch (%s)",
		async (outcome) => {
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
			await awaitReactAct(async () => {
				if (outcome === "success") save.resolve([]);
				else save.reject(new Error("Cannot save refresh cooldown"));
				expect(await write).toBe(outcome === "success");
			});
			expect(result.current.vm.feedbackKind).toBe("refresh-settings");
			expect(result.current.vm.busy).toBeNull();
			if (outcome === "success")
				expect(result.current.vm.notice).toBe("Collector cooldown saved.");
			else
				expect(result.current.vm.mutationError).toBe(
					"Cannot save refresh cooldown",
				);
		},
	);
	it.each(["receipt", "transport"] as const)(
		"an earlier watch response cannot replace feedback from a later cooldown save (%s)",
		async (outcome) => {
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
			await awaitReactAct(() =>
				result.current.vm.setRefreshCooldown("details", 600),
			);
			await awaitReactAct(async () => {
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
		},
	);
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
		await awaitReactAct(() => result.current.vm.discoverRepo());
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
		await awaitReactAct(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: `${baseUrl}${secondId}`,
		});
	});
	it("explicit discovery respects repository identity and reports scheduling failures", async () => {
		const { result } = render();
		await loaded(result);
		await awaitReactAct(async () =>
			expect(await result.current.vm.discoverRepo()).toBe(false),
		);
		act(() => result.current.vm.selectRepository("repo-key"));
		await awaitReactAct(() => result.current.vm.discoverRepo());
		expect(api.discover).toHaveBeenCalledWith("cli", {
			repositoryUrl: `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.id}`,
		});
		await awaitReactAct(() => result.current.vm.scan(project.id));
		expect(api.discover).toHaveBeenCalledWith("cli", { projectId: project.id });
		vi.mocked(api.discover).mockRejectedValue(new Error("Scheduler offline"));
		await awaitReactAct(() => result.current.vm.scan());
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
		await awaitReactAct(() => result.current.vm.reload());
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
		await awaitReactAct(async () =>
			expect(await result.current.submit()).toBe(false),
		);
		expect(result.current.errors.repositories).toBeDefined();
		expect(onSave).not.toHaveBeenCalled();
		act(() => result.current.setRepositoryText("api, web"));
		expect(result.current.errors.repositories).toBeUndefined();
		await awaitReactAct(async () =>
			expect(await result.current.submit()).toBe(true),
		);
		expect(onSave).toHaveBeenLastCalledWith(
			expect.objectContaining({ repositories: ["api", "web"] }),
		);
		act(() => result.current.setRepositoryText(""));
		await awaitReactAct(() => result.current.submit());
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
		await awaitReactAct(async () =>
			expect(await result.current.submit()).toBe(false),
		);
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
		await awaitReactAct(async () =>
			expect(await result.current.submit()).toBe(false),
		);
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
		await awaitReactAct(async () =>
			expect(await result.current.submit()).toBe(true),
		);
	});
});

it("watches collection rows outside the main page with the same identity and generation guards", async () => {
	const { result } = render();
	await loaded(result);
	const external = api.queryRow(
		publicPull({ ...pull, id: "collection-member", number: 8080 }),
	);
	expect(
		result.current.vm.pageRows.some((row) => row.pull.id === external.pull.id),
	).toBe(false);
	const response = deferred<Awaited<ReturnType<typeof api.addWatches>>>();
	vi.mocked(api.addWatches).mockReturnValue(response.promise);
	let pending!: Promise<boolean>;
	act(() => {
		pending = result.current.vm.toggleWatchRow(external);
	});
	expect(result.current.vm.withWatchState(external).watchPending).toBe(true);
	expect(result.current.vm.withWatchState(external).watching).toBe(true);
	await awaitReactAct(async () => {
		expect(await result.current.vm.toggleWatchRow(external)).toBe(false);
	});
	expect(api.addWatches).toHaveBeenCalledTimes(1);
	expect(api.addWatches).toHaveBeenCalledWith("cli", ["collection-member"]);
	await awaitReactAct(async () => {
		response.resolve({ results: [{ status: "added" }] });
		await pending;
	});
	expect(result.current.vm.withWatchState(external).watchPending).toBe(false);
	const watched = {
		...external,
		observation: fixtureObservation({ generation: 9 }),
	};
	await awaitReactAct(async () => {
		await result.current.vm.toggleWatchRow(watched);
	});
	expect(api.removeWatches).toHaveBeenCalledWith("cli", [watched.observation]);
	vi.mocked(api.addWatches).mockClear();
	await awaitReactAct(async () => {
		expect(
			await result.current.vm.toggleWatchRow({
				...external,
				project: { ...external.project, source: "demo" },
			}),
		).toBe(false);
	});
	expect(api.addWatches).not.toHaveBeenCalled();
});

it("bulk watches collection rows in bounded batches and excludes history and other sources", async () => {
	const { result } = render();
	await loaded(result);
	const rows = Array.from({ length: 101 }, (_, i) =>
		api.queryRow(publicPull({ ...pull, id: `bulk-${i}`, number: i + 1 })),
	);
	vi.mocked(api.addWatches).mockImplementation(async (_, ids) => ({
		results: ids.map(() => ({ status: "added" as const })),
	}));
	await awaitReactAct(async () => {
		expect(
			await result.current.vm.watchRows([
				...rows,
				{ ...rows[0]!, pull: { ...pull, state: "merged" } },
				{ ...rows[0]!, project: { ...project, source: "demo" } },
			]),
		).toBe(true);
	});
	expect(
		vi.mocked(api.addWatches).mock.calls.map((call) => call[1].length),
	).toEqual([100, 1]);
	vi.mocked(api.addWatches)
		.mockReset()
		.mockResolvedValue({
			results: [
				{
					status: "rejected",
					error: { code: "FAILED", message: "Unavailable", retryable: true },
				},
			],
		});
	await awaitReactAct(async () =>
		expect(await result.current.vm.watchRows(rows)).toBe(false),
	);
	expect(api.addWatches).toHaveBeenCalledTimes(1);
});
