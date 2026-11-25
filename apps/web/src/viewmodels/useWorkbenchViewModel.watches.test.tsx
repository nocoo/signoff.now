// @vitest-environment happy-dom
import { makeWatchRef } from "@signoff/domain/monitoring";
import {
	cleanup,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/models/monitoringApi";
import { patchProject } from "@/models/workbenchApi";
import {
	fixtureObservation,
	pendingInspection,
	fixtureProject as project,
	publicPull,
	fixturePull as pull,
} from "@/test/monitoring-fixture";
import { awaitReactAct } from "@/test/reactAct";
import {
	deferred,
	draft,
	fixture,
	loaded,
	pendingEnvelope,
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

describe("shared watch mutations", () => {
	it.each(["merged", "closed"] as const)(
		"keeps retired %s PRs watched and supports explicit removal",
		async (state) => {
			const observation = fixtureObservation({
				active: false,
				stopReason: state === "merged" ? "completed" : "abandoned",
			});
			vi.mocked(api.loadPulls).mockResolvedValue({
				...fixture.pulls,
				data: [publicPull({ ...pull, state }, project, observation)],
			});
			const { result } = render(`/?state=${state}&watching=watching`);
			await loaded(result);
			expect(result.current.vm.filter).toMatchObject({
				state,
				watching: "watching",
			});
			expect(result.current.vm.pageRows[0]?.watching).toBe(true);
			expect(result.current.vm.selectableCount).toBe(1);
			await awaitReactAct(() =>
				result.current.vm.toggleWatchRow(result.current.vm.pageRows[0]!),
			);
			expect(api.removeWatches).toHaveBeenCalledOnce();
			expect(api.removeWatches).toHaveBeenCalledWith(project.source, [
				observation,
			]);
			expect(api.addWatches).not.toHaveBeenCalled();
		},
	);
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
		const findWatchButton = (number: number) =>
			screen.findByRole("button", {
				name: `Watch PR #${number} in ${project.projectKey}/${pull.repository.name}`,
			}) as Promise<HTMLButtonElement>;
		const firstButton = await findWatchButton(pull.number);
		const secondButton = await findWatchButton(other.number);
		fireEvent.click(firstButton);
		expect(firstButton.getAttribute("aria-pressed")).toBe("true");
		expect(firstButton.getAttribute("aria-busy")).toBe("true");
		expect(secondButton.disabled).toBe(false);
		fireEvent.click(secondButton);
		expect(secondButton.getAttribute("aria-pressed")).toBe("true");
		expect(api.addWatches).toHaveBeenCalledTimes(2);
		await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {
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
		expect(await findWatchButton(pull.number)).toBe(firstButton);
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
		await awaitReactAct(() => result.current.vm.toggleWatch(pull.id));
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
		await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {
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
			await awaitReactAct(async () => {
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
		await awaitReactAct(async () => {
			expect(await result.current.vm.toggleWatch(pull.id)).toBe(false);
			saved.resolve(project);
			await write;
		});
		expect(api.addWatches).not.toHaveBeenCalled();
	});
	it.each([
		{ generation: 4, active: false },
		{ generation: 5, active: true },
	])(
		"a late add receipt cannot overwrite a newer CLI watch state: %j",
		async (latest) => {
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
			await awaitReactAct(() => result.current.vm.reload());
			vi.mocked(api.loadPulls).mockReturnValue(nextRead.promise);
			await awaitReactAct(async () => {
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
		},
	);
	it.each(
		[
			{ projectKey: "ReplacementProject" },
			{ organization: "replacement-org" },
			{ id: "new-registration" },
		].flatMap((identity) =>
			[false, true].map((watched) => ({ identity, watched })),
		),
	)(
		"fences optimistic state, selection and delayed receipts across project identity changes: %j",
		async ({ identity, watched }) => {
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
			await awaitReactAct(() => result.current.vm.reload());
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
			await awaitReactAct(async () => {
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
		},
	);
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
		await awaitReactAct(() => result.current.vm.toggleWatch(pull.id));
		expect(result.current.vm.selected).toBeNull();
		expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id]);
		expect(result.current.vm.pageRows[0]?.observation?.active).toBe(true);
		await awaitReactAct(() => result.current.vm.toggleWatch(pull.id));
		expect(api.removeWatches).toHaveBeenCalledWith("cli", [observation]);
		expect(result.current.vm.pageRows[0]?.observation).toBeNull();
		expect(result.current.vm.selectedIds).toEqual(new Set(["second"]));
		await awaitReactAct(async () =>
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
		await awaitReactAct(() => result.current.vm.watchSelected(true));
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
		await awaitReactAct(() => result.current.vm.watchSelected(true));
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
		await awaitReactAct(() => result.current.vm.reload());
		vi.mocked(api.removeWatches).mockResolvedValue({
			results: [{ status: "conflict" }],
		});
		await awaitReactAct(() => result.current.vm.watchSelected(false));
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
		await awaitReactAct(() => result.current.vm.toggleWatch());
		expect(api.addWatches).toHaveBeenCalledWith("cli", [pull.id]);
		await awaitReactAct(() => result.current.vm.refreshPull());
		expect(api.refreshWatches).toHaveBeenCalledWith("cli", undefined);
		expect(result.current.vm.notice).toBe("The watch list is empty.");
		await awaitReactAct(() => result.current.vm.refreshPull(pull.id));
		expect(api.refreshWatches).toHaveBeenLastCalledWith("cli", pull.id);
		act(() => result.current.vm.selectPull(null));
		await awaitReactAct(async () =>
			expect(await result.current.vm.toggleWatch()).toBe(false),
		);
	});
	it("empty selections are no-ops and concurrent clicks do not duplicate writes", async () => {
		const { result } = render();
		await loaded(result);
		await awaitReactAct(() => result.current.vm.watchSelected(true));
		expect(api.addWatches).not.toHaveBeenCalled();
		act(() => result.current.vm.selectPage(true));
		const pending = deferred<{ results: { status: "added" }[] }>();
		vi.mocked(api.addWatches).mockReturnValue(pending.promise);
		let running!: Promise<boolean>;
		act(() => {
			running = result.current.vm.watchSelected(true);
		});
		await awaitReactAct(async () =>
			expect(await result.current.vm.watchSelected(true)).toBe(false),
		);
		act(() => result.current.vm.setFilter({ source: "demo" }));
		await awaitReactAct(async () => {
			pending.resolve({ results: [{ status: "added" }] });
			await running;
		});
		expect(result.current.vm.notice).toBeNull();
		expect(api.addWatches).toHaveBeenCalledOnce();
	});
	it("pending refs stay visible and removals surface conflicts and rejections", async () => {
		const watch = fixtureObservation();
		const item = pendingInspection(watch);
		vi.mocked(api.loadPending).mockResolvedValue({
			...pendingEnvelope,
			data: [item],
			page: { ...fixture.page, total: 1 },
		});
		const { result } = render("/?watching=watching");
		await loaded(result);
		await waitFor(() => expect(result.current.vm.pendingTotal).toBe(1));
		await awaitReactAct(() => result.current.vm.removePending(watch));
		expect(result.current.vm.notice).toContain("removed");
		for (const status of ["conflict", "rejected"] as const) {
			vi.mocked(api.removeWatches).mockResolvedValue({ results: [{ status }] });
			await awaitReactAct(() => result.current.vm.removePending(watch));
			expect(result.current.vm.mutationError).not.toBeNull();
		}
	});
	it("pending-reference removal is optimistic and rolls back a rejected generation without locking the page", async () => {
		const watch = fixtureObservation();
		vi.mocked(api.loadPending).mockResolvedValue({
			...pendingEnvelope,
			data: [pendingInspection(watch)],
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
		await awaitReactAct(async () => {
			response.resolve({ results: [{ status: "conflict" }] });
			await write;
		});
		expect(result.current.vm.pendingTotal).toBe(1);
		expect(result.current.vm.pendingObservations[0]?.watch.id).toBe(watch.id);
		expect(result.current.vm.mutationError).toContain("generation changed");
	});
	it("pending errors are visible and retried independently while retaining the last good page", async () => {
		const response = {
			...pendingEnvelope,
			data: [pendingInspection(fixtureObservation())],
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
		await awaitReactAct(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingTotal).toBe(1);
		expect(result.current.vm.pendingError).toBeNull();
		expect(api.loadPulls).toHaveBeenCalledTimes(listReads);
		vi.mocked(api.loadPending).mockRejectedValueOnce(new Error("Network lost"));
		await awaitReactAct(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingError).toBe("Network lost");
		expect(result.current.vm.pendingObservations).toEqual(response.data);
	});
	it("a delayed pending removal never hides a newly re-added generation", async () => {
		const watch = fixtureObservation();
		const item = pendingInspection(watch);
		vi.mocked(api.loadPending).mockResolvedValue({
			...pendingEnvelope,
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
			...pendingEnvelope,
			data: [{ ...item, watch: { ...item.watch, generation: 2 } }],
			page: { ...fixture.page, total: 1 },
		});
		await awaitReactAct(() => result.current.vm.reloadPending());
		expect(result.current.vm.pendingTotal).toBe(1);
		vi.mocked(api.loadPending).mockReturnValue(nextRead.promise);
		await awaitReactAct(async () => {
			response.resolve({
				results: [
					{
						status: "removed",
						observation: {
							...publicPull(pull, project, watch).observation!,
							active: false,
						},
					},
				],
			});
			await write;
		});
		expect(result.current.vm.pendingObservations[0]?.watch.generation).toBe(2);
		expect(result.current.vm.pendingTotal).toBe(1);
	});
	it("all 21 pending watches are reachable, and removing the last page or changing scope resets its page", async () => {
		let items = Array.from({ length: 21 }, (_, i) =>
			pendingInspection({ ...fixtureObservation(), id: `pending-${i}` }),
		);
		vi.mocked(api.loadPending).mockImplementation(
			async (_source, _signal, _scope, page = 1) => ({
				...pendingEnvelope,
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
			expect(result.current.vm.pendingObservations[0]?.watch.id).toBe(
				"pending-20",
			),
		);
		vi.mocked(api.removeWatches).mockImplementation(async (_source, refs) => {
			items = items.filter((item) => item.watch.id !== refs[0]?.id);
			return { results: [{ status: "removed" }] };
		});
		await awaitReactAct(() =>
			result.current.vm.removePending(
				result.current.vm.pendingObservations[0]!.watch,
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
		await awaitReactAct(() => result.current.vm.watchSelected(true));
		expect(result.current.vm.mutationError).toBe("Request failed");
		expect(result.current.vm.selectedCount).toBe(1);
		act(() => result.current.vm.clearMutationError());
		expect(result.current.vm.mutationError).toBeNull();
	});
});
