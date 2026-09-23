import {
	type ContributionFilters,
	type ContributionReport,
	contributionFiltersSchema,
	type DataSource,
	type DirectoryData,
	repositoryKey,
} from "@signoff/domain/insights";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { fetchContributionReport } from "@/models/contributionsApi";
import { discover, loadCollectionJob } from "@/models/monitoringApi";
import { fixtureJob, fixtureProject } from "@/test/monitoring-fixture";
import { useContributionReport } from "./useContributionReport";

vi.mock("@/models/contributionsApi", () => ({
	fetchContributionReport: vi.fn(),
}));
vi.mock("@/models/monitoringApi", () => ({
	discover: vi.fn(),
	loadCollectionJob: vi.fn(),
}));

const filters = contributionFiltersSchema.parse({
	source: "cli",
	from: "2026-06-26",
	to: "2026-09-23",
});
const project = {
	...fixtureProject,
	id: "p1",
	provider: "ado" as const,
	enabled: true,
};
const directory: DirectoryData = {
	source: "cli",
	blockedContributorKeys: [],
	revision: 1,
	members: [],
	teams: [],
	tags: [],
	identities: [],
	projects: [project, { ...project, id: "p2" }],
	repositories: [
		{
			key: repositoryKey("p1", "r1"),
			projectId: "p1",
			id: "r1",
			name: "First",
		},
		{
			key: repositoryKey("p1", "r2"),
			projectId: "p1",
			id: "r2",
			name: "Second",
		},
		{
			key: repositoryKey("p2", "r3"),
			projectId: "p2",
			id: "r3",
			name: "Third",
		},
	],
};
const report: ContributionReport = {
	filters,
	calculatedAt: 100,
	coverage: "observed",
	members: [],
	repositories: [],
	contributions: [],
	totals: {
		total: 1,
		open: 1,
		merged: 0,
		closed: 0,
		draft: 0,
		contributors: 1,
		repositories: 1,
		lastCollectedAt: 100,
	},
};
const receipt = (id: string) => ({
	jobs: [
		{
			id,
			kind: "discover" as const,
			state: "queued" as const,
			coalesced: false,
			notBefore: "2026-09-23T00:00:00Z",
		},
	],
});
const storageKey = (source: DataSource) => `signoff-insights-jobs:${source}`;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function setup(
	overrides: Partial<{
		source: DataSource;
		filters: ContributionFilters | null;
		directory: DirectoryData | null;
	}> = {},
) {
	const initialProps = {
		source: "cli" as DataSource,
		filters: filters as ContributionFilters | null,
		directory: directory as DirectoryData | null,
		...overrides,
	};
	return renderHook(
		(props: typeof initialProps) =>
			useContributionReport(props.source, props.filters, props.directory),
		{ initialProps },
	);
}
async function flush() {
	await act(async () => {});
}
async function tick(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	sessionStorage.clear();
	vi.mocked(fetchContributionReport).mockImplementation(async (scope) => ({
		...report,
		filters: scope,
	}));
	vi.mocked(discover).mockImplementation(async (_source, target) =>
		receipt("projectId" in target ? target.projectId : "url"),
	);
	vi.mocked(loadCollectionJob).mockImplementation(async (_source, id) =>
		fixtureJob({ id, kind: "discover", state: "running" }),
	);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("loads cache immediately without discovery, calculation writes, or idle polling", async () => {
	const { result } = setup();
	expect(result.current.loading).toBe(true);
	await flush();
	expect(result.current.report).toEqual(report);
	expect(fetchContributionReport).toHaveBeenCalledWith(
		filters,
		expect.any(AbortSignal),
	);
	await tick(9000);
	expect(fetchContributionReport).toHaveBeenCalledTimes(1);
	expect(discover).not.toHaveBeenCalled();
	expect(loadCollectionJob).not.toHaveBeenCalled();
});

it("dispatches deep discovery by project and selected repository, excluding disabled and foreign projects", async () => {
	const { result } = setup({
		filters: {
			...filters,
			repositoryKeys: [
				directory.repositories[0].key,
				directory.repositories[2].key,
			],
		},
		directory: {
			...directory,
			projects: [
				...directory.projects,
				{ ...project, id: "disabled", enabled: false },
				{ ...project, id: "github", provider: "github" },
				{ ...project, id: "demo", source: "demo" },
			],
		},
	});
	await flush();
	await act(async () => result.current.calculate());
	expect(vi.mocked(discover).mock.calls).toEqual([
		["cli", { projectId: "p1", repositoryIds: ["r1"], depth: "deep" }],
		["cli", { projectId: "p2", repositoryIds: ["r3"], depth: "deep" }],
	]);
	expect(result.current.calculating).toBe(true);
	expect(result.current.report).toEqual({
		...report,
		filters: {
			...filters,
			repositoryKeys: [
				directory.repositories[0].key,
				directory.repositories[2].key,
			],
		},
	});
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["p1", "p2"]);
	await act(async () => result.current.calculate());
	expect(discover).toHaveBeenCalledTimes(2);
});

it("allows demo GitHub projects, respects project scope, and lets the project task enumerate repositories", async () => {
	const { result } = setup({
		source: "demo",
		filters: { ...filters, source: "demo", projectIds: ["p2"] },
		directory: {
			...directory,
			source: "demo",
			projects: directory.projects.map((p) => ({
				...p,
				source: "demo",
				provider: "github",
			})),
		},
	});
	await flush();
	await act(async () => result.current.calculate());
	expect(discover).toHaveBeenCalledExactlyOnceWith("demo", {
		projectId: "p2",
		depth: "deep",
	});
});

it("serializes duplicate clicks and deduplicates coalesced job receipts", async () => {
	const pending = deferred<Awaited<ReturnType<typeof discover>>>();
	vi.mocked(discover).mockReturnValue(pending.promise);
	const { result } = setup();
	await flush();
	let calculate!: Promise<void>;
	act(() => {
		calculate = result.current.calculate();
	});
	expect(result.current.progress).toBe("Scheduling discovery by repository…");
	await act(async () => result.current.calculate());
	expect(discover).toHaveBeenCalledTimes(2);
	await act(async () => {
		pending.resolve(receipt("shared"));
		await calculate;
	});
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["shared"]);
});

it("tracks fanout children and refreshes the report when all repository jobs finish", async () => {
	sessionStorage.setItem(storageKey("cli"), JSON.stringify(["catalogue"]));
	let finished = false;
	vi.mocked(loadCollectionJob).mockImplementation(async (_source, id) =>
		fixtureJob({
			id,
			state: id === "catalogue" || finished ? "succeeded" : "running",
			children: id === "catalogue" ? ["r1", "r2", "r1"] : [],
		}),
	);
	const { result } = setup();
	await flush();
	expect(result.current.progress).toContain("1 / 3");
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["catalogue", "r1", "r2"]);
	expect(discover).not.toHaveBeenCalled();
	vi.mocked(fetchContributionReport).mockResolvedValue({
		...report,
		calculatedAt: 200,
	});
	finished = true;
	await tick(2000);
	await flush();
	expect(result.current.calculating).toBe(false);
	expect(result.current.progress).toBe(
		"Discovery complete. Reports show the updated cache.",
	);
	expect(result.current.report?.calculatedAt).toBe(200);
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual([]);
});

it("keeps successful project receipts when other dispatches fail and reports partial child results", async () => {
	vi.mocked(discover)
		.mockResolvedValueOnce(receipt("catalogue"))
		.mockRejectedValueOnce(new Error("Project p2 denied"));
	vi.mocked(loadCollectionJob).mockImplementation(async (_source, id) =>
		fixtureJob({
			id,
			state:
				id === "catalogue"
					? "succeeded"
					: id === "partial"
						? "partial"
						: "failed",
			children: id === "catalogue" ? ["partial", "failed"] : undefined,
			error: id === "failed" ? "Repository failed" : null,
			message: id === "partial" ? "Partial history" : "Complete",
		}),
	);
	const { result } = setup();
	await flush();
	await act(async () => result.current.calculate());
	await flush();
	expect(result.current.calculating).toBe(false);
	expect(result.current.error).toContain("Project p2 denied");
	expect(result.current.error).toContain("Partial history");
	expect(result.current.error).toContain("Repository failed");
	expect(result.current.progress).toContain("finished with issues");
	expect(result.current.report).toEqual(report);
});

it("keeps scheduling failures visible after successful queued work completes", async () => {
	vi.mocked(discover)
		.mockResolvedValueOnce(receipt("p1"))
		.mockRejectedValueOnce("Denied");
	vi.mocked(loadCollectionJob).mockResolvedValue(
		fixtureJob({ state: "succeeded" }),
	);
	const { result } = setup();
	await flush();
	await act(async () => result.current.calculate());
	await flush();
	expect(result.current.error).toBe("Could not start discovery");
	expect(result.current.calculating).toBe(false);
});

it("shows empty receipts without a stuck calculating state", async () => {
	vi.mocked(discover).mockResolvedValue({ jobs: [] });
	const { result } = setup();
	await flush();
	await act(async () => result.current.calculate());
	expect(result.current.calculating).toBe(false);
	expect(result.current.progress).toBe("No discovery tasks were scheduled.");
	expect(result.current.error).toBeNull();
});

it.each([
	{ filters: null },
	{ directory: null },
	{ directory: { ...directory, source: "demo" as const } },
	{ filters: { ...filters, source: "demo" as const } },
])("never dispatches without a valid matching scope (%s)", async (props) => {
	const { result } = setup(props);
	await flush();
	await act(async () => result.current.calculate());
	expect(discover).not.toHaveBeenCalled();
	if (props.filters === null || props.filters?.source === "demo")
		expect(fetchContributionReport).not.toHaveBeenCalled();
});

it.each([
	{
		scope: { repositoryKeys: ["removed"] },
		error: "A selected repository is unavailable",
	},
	{
		scope: { projectIds: ["removed"] },
		error: "No enabled repositories match",
	},
	{
		scope: {
			projectIds: ["p1"],
			repositoryKeys: [directory.repositories[2].key],
		},
		error: "No enabled repositories match",
	},
])("rejects an invalid project/repository intersection (%s)", async ({
	scope,
	error,
}) => {
	const { result } = setup({ filters: { ...filters, ...scope } });
	await flush();
	await act(async () => result.current.calculate());
	expect(result.current.error).toContain(error);
	expect(discover).not.toHaveBeenCalled();
	expect(result.current.calculating).toBe(false);
});

it("shows read errors, retries job polling, and leaves cached results available", async () => {
	sessionStorage.setItem(storageKey("cli"), JSON.stringify(["job"]));
	vi.mocked(loadCollectionJob).mockRejectedValueOnce(
		new Error("Job temporarily unavailable"),
	);
	const { result } = setup();
	await flush();
	expect(result.current.error).toBe("Job temporarily unavailable");
	expect(result.current.report).toEqual(report);
	await tick(4000);
	expect(result.current.error).toBeNull();
	vi.mocked(fetchContributionReport).mockRejectedValueOnce(
		new Error("Cache unavailable"),
	);
	await act(async () => result.current.reload());
	expect(result.current.error).toBe("Cache unavailable");
	expect(result.current.report).toEqual(report);
});

it("clears expired task history and allows a new calculation while retaining the report", async () => {
	sessionStorage.setItem(storageKey("cli"), JSON.stringify(["expired"]));
	vi.mocked(loadCollectionJob).mockRejectedValueOnce(
		new ApiError("Not found", 404),
	);
	const { result } = setup();
	await flush();
	expect(result.current.calculating).toBe(false);
	expect(result.current.error).toContain("Discovery task history expired");
	expect(result.current.report).toEqual(report);
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual([]);
	await act(async () => result.current.calculate());
	expect(discover).toHaveBeenCalledTimes(2);
	expect(result.current.calculating).toBe(true);
	expect(result.current.error).toBeNull();
});

it("keeps an expired child's siblings running and waits for them before enabling Calculate", async () => {
	sessionStorage.setItem(
		storageKey("cli"),
		JSON.stringify(["expired", "running"]),
	);
	let done = false;
	vi.mocked(loadCollectionJob).mockImplementation(async (_source, id) => {
		if (id === "expired") throw new ApiError("Not found", 404);
		return fixtureJob({ id, state: done ? "succeeded" : "running" });
	});
	const { result } = setup();
	await flush();
	expect(result.current.calculating).toBe(true);
	expect(result.current.progress).toContain("1 / 2");
	done = true;
	await tick(2000);
	expect(result.current.calculating).toBe(false);
	expect(result.current.error).toContain("Discovery task history expired");
});

it("keeps temporary HTTP failures resumable instead of treating them as expired", async () => {
	sessionStorage.setItem(storageKey("cli"), JSON.stringify(["retry"]));
	vi.mocked(loadCollectionJob).mockRejectedValueOnce(
		new ApiError("Service unavailable", 503),
	);
	const { result } = setup();
	await flush();
	expect(result.current.calculating).toBe(true);
	expect(result.current.error).toBe("Service unavailable");
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["retry"]);
	await tick(4000);
	expect(result.current.error).toBeNull();
});

it("ignores late report responses after filters and sources change", async () => {
	const pending = deferred<ContributionReport>();
	vi.mocked(fetchContributionReport).mockReturnValueOnce(pending.promise);
	const { result, rerender } = setup();
	await flush();
	rerender({
		source: "cli",
		directory,
		filters: { ...filters, projectIds: ["p2"] },
	});
	await flush();
	expect(result.current.report?.filters.projectIds).toEqual(["p2"]);
	rerender({
		source: "demo",
		directory: null,
		filters: { ...filters, source: "demo" },
	});
	await flush();
	await act(async () => pending.resolve(report));
	expect(result.current.report?.filters.source).toBe("demo");
	expect(discover).not.toHaveBeenCalled();
});

it("ignores late old-source job results without clearing its resumable tasks", async () => {
	const pending = deferred<Awaited<ReturnType<typeof loadCollectionJob>>>();
	sessionStorage.setItem(storageKey("cli"), JSON.stringify(["old"]));
	vi.mocked(loadCollectionJob).mockReturnValueOnce(pending.promise);
	const { result, rerender } = setup();
	await flush();
	rerender({
		source: "demo",
		directory: { ...directory, source: "demo" },
		filters: { ...filters, source: "demo" },
	});
	await flush();
	await act(async () =>
		pending.resolve(fixtureJob({ id: "old", state: "succeeded" })),
	);
	expect(result.current.calculating).toBe(false);
	expect(result.current.progress).toBeNull();
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["old"]);
});

it("persists in-flight old-source receipts for resume without publishing them to the new source", async () => {
	const pending = deferred<Awaited<ReturnType<typeof discover>>>();
	vi.mocked(discover).mockReturnValue(pending.promise);
	const { result, rerender } = setup();
	await flush();
	let calculate!: Promise<void>;
	act(() => {
		calculate = result.current.calculate();
	});
	rerender({
		source: "demo",
		directory: null,
		filters: { ...filters, source: "demo" },
	});
	await act(async () => {
		pending.resolve(receipt("cli-job"));
		await calculate;
	});
	expect(result.current.calculating).toBe(false);
	expect(result.current.progress).toBeNull();
	expect(
		JSON.parse(sessionStorage.getItem(storageKey("cli")) ?? "null"),
	).toEqual(["cli-job"]);
	rerender({ source: "cli", directory, filters });
	await flush();
	expect(result.current.calculating).toBe(true);
	expect(loadCollectionJob).toHaveBeenCalledWith(
		"cli",
		"cli-job",
		expect.any(AbortSignal),
	);
});

it("rejects old calculate handlers after filter changes, source changes, and unmount", async () => {
	const { result, rerender, unmount } = setup();
	await flush();
	const previousFilter = result.current.calculate;
	rerender({
		source: "cli",
		directory,
		filters: { ...filters, projectIds: ["p2"] },
	});
	await act(async () => previousFilter());
	expect(discover).not.toHaveBeenCalled();
	const previousSource = result.current.calculate;
	rerender({
		source: "demo",
		directory: null,
		filters: { ...filters, source: "demo" },
	});
	await act(async () => previousSource());
	expect(discover).not.toHaveBeenCalled();
	rerender({ source: "cli", directory, filters });
	await flush();
	const detached = result.current.calculate;
	unmount();
	await act(async () => detached());
	expect(discover).not.toHaveBeenCalled();
});

it("resumes a submission when switching back before its receipt and blocks duplicate dispatch", async () => {
	const pending = deferred<Awaited<ReturnType<typeof discover>>>();
	vi.mocked(discover).mockReturnValue(pending.promise);
	const { result, rerender } = setup();
	await flush();
	let calculate!: Promise<void>;
	act(() => {
		calculate = result.current.calculate();
	});
	rerender({
		source: "demo",
		directory: null,
		filters: { ...filters, source: "demo" },
	});
	rerender({ source: "cli", directory, filters });
	await flush();
	expect(result.current.calculating).toBe(true);
	await act(async () => result.current.calculate());
	expect(discover).toHaveBeenCalledTimes(2);
	await act(async () => {
		pending.resolve(receipt("resumed"));
		await calculate;
	});
	expect(result.current.calculating).toBe(true);
	expect(loadCollectionJob).toHaveBeenCalledWith(
		"cli",
		"resumed",
		expect.any(AbortSignal),
	);
});

it.each([
	"broken",
	"{}",
	"[1]",
])("ignores invalid stored jobs (%s)", async (saved) => {
	sessionStorage.setItem(storageKey("cli"), saved);
	const { result } = setup();
	await flush();
	expect(result.current.calculating).toBe(false);
	expect(loadCollectionJob).not.toHaveBeenCalled();
});

it("works when browser session storage is unavailable", async () => {
	vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new Error("Denied");
	});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new Error("Denied");
	});
	const { result } = setup();
	await flush();
	await act(async () => result.current.calculate());
	expect(result.current.calculating).toBe(true);
	expect(result.current.error).toBeNull();
});

it("revalidates directory changes without clearing the visible report", async () => {
	const vm = setup();
	await flush();
	const visible = vm.result.current.report;
	const pending = deferred<ContributionReport>();
	vi.mocked(fetchContributionReport).mockReturnValueOnce(pending.promise);
	vm.rerender({
		source: "cli",
		filters,
		directory: { ...directory, revision: 2 },
	});
	await flush();
	expect(vm.result.current.report).toBe(visible);
	expect(vm.result.current.loading).toBe(false);
	await act(async () =>
		pending.resolve({ ...report, totals: { ...report.totals, total: 2 } }),
	);
	expect(vm.result.current.report?.totals.total).toBe(2);
	vi.mocked(fetchContributionReport).mockRejectedValueOnce(
		new Error("Temporarily offline"),
	);
	vm.rerender({
		source: "cli",
		filters,
		directory: { ...directory, revision: 3 },
	});
	await flush();
	expect(vm.result.current.report?.totals.total).toBe(2);
	expect(vm.result.current.error).toBe("Temporarily offline");
});
