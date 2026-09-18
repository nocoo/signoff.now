import { afterEach, expect, test, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";
import {
	fixtureObservation,
	fixturePull,
	publicPull,
	queryFixture,
} from "@/test/monitoring-fixture";
import {
	addWatches,
	discover,
	loadCatalog,
	loadCollector,
	loadPending,
	loadPull,
	loadPulls,
	pullQueryParams,
	queryRow,
	refreshWatches,
	removeWatches,
	seconds,
} from "./monitoringApi";
import { readPullFilter } from "./workbench";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	apiFetch: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

test("wire conversion preserves scope, Draft, checks age, reviews and observation generations", () => {
	const watch = fixtureObservation();
	const result = queryRow(
		publicPull(
			{ ...fixturePull, draft: true, checksObservedAt: null },
			undefined,
			watch,
		),
	);
	expect(result.pull).toMatchObject({
		state: "open",
		draft: true,
		checksObservedAt: null,
	});
	expect(result.observation).toEqual(watch);
	expect(queryRow(publicPull()).observation).toBeNull();
	expect(seconds(null)).toBeNull();
	expect(seconds(undefined)).toBeNull();
});

test("filters use server paging and exclude drafts by default", () => {
	const filter = readPullFilter(new URLSearchParams(), true);
	const normal = new URLSearchParams(pullQueryParams(filter, 1));
	expect(normal.get("limit")).toBe("20");
	expect(normal.get("draft")).toBe("exclude");
	expect(normal.has("watching")).toBe(false);
	const watching = new URLSearchParams(
		pullQueryParams(
			{
				...filter,
				source: "demo",
				watching: "watching",
				authors: ["one", "two"],
			},
			3,
		),
	);
	expect(watching.getAll("author")).toEqual(["one", "two"]);
	expect(watching.get("source")).toBe("sample");
	expect(watching.get("page")).toBe("3");
	expect(watching.get("watching")).toBe("true");
	expect(
		new URLSearchParams(
			pullQueryParams({ ...filter, watching: "unwatched" }, 1),
		).get("watching"),
	).toBe("false");
});

test("independent query endpoints validate responses and do not issue commands", async () => {
	const fixture = queryFixture();
	const signal = new AbortController().signal;
	vi.mocked(apiFetch)
		.mockResolvedValueOnce(fixture.pulls)
		.mockResolvedValueOnce({ ...fixture.envelope, data: fixture.pulls.data[0] })
		.mockResolvedValueOnce(fixture.collector)
		.mockResolvedValueOnce({
			...fixture.envelope,
			data: [],
			page: { ...fixture.page, total: 0 },
		});
	await loadPulls("source=live", signal);
	await loadPull("cli", "pr / 1", signal);
	await loadCollector("cli", signal);
	await loadPending("demo", signal);
	expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual([
		"/api/query/v1/prs?source=live",
		"/api/query/v1/prs/pr%20%2F%201?source=live",
		"/api/query/v1/collector?source=live",
		"/api/query/v1/observations?source=sample&pending=true&limit=20",
	]);
	vi.mocked(apiFetch).mockResolvedValueOnce({ data: [] });
	await expect(loadPulls("", signal)).rejects.toThrow();
});

test("catalog reads every page, retries from the start on revision changes and refuses cursor cycles", async () => {
	const fixture = queryFixture();
	const signal = new AbortController().signal;
	const first = {
		...fixture.catalog,
		page: { ...fixture.page, nextCursor: "next" },
	};
	vi.mocked(apiFetch)
		.mockResolvedValueOnce(first)
		.mockRejectedValueOnce(
			new ApiError("Changed", 409, { error: { code: "SNAPSHOT_CHANGED" } }),
		)
		.mockResolvedValueOnce(first)
		.mockResolvedValueOnce({
			...fixture.catalog,
			data: [],
			page: { ...fixture.page, nextCursor: null },
		});
	expect((await loadCatalog("cli", signal)).data).toHaveLength(1);
	expect(vi.mocked(apiFetch).mock.calls[2]?.[0]).not.toContain("cursor");
	let calls = 0;
	vi.mocked(apiFetch).mockImplementation(async () => {
		if (++calls > 5) throw new Error("Pagination never stopped");
		return first;
	});
	await expect(loadCatalog("cli", signal)).rejects.toThrow(/cursor/i);
});

test("pending first results follow the repository scope, including escaped project names", async () => {
	const fixture = queryFixture();
	vi.mocked(apiFetch).mockResolvedValue({
		...fixture.envelope,
		data: [],
		page: { ...fixture.page, total: 0 },
	});
	await loadPending("cli", new AbortController().signal, {
		organization: "org",
		projectId: "project / one",
		repository: "repo-id",
	});
	const params = new URL(
		String(vi.mocked(apiFetch).mock.calls[0]?.[0]),
		"http://localhost",
	).searchParams;
	expect(Object.fromEntries(params)).toEqual({
		source: "live",
		pending: "true",
		limit: "20",
		org: "org",
		projectId: "project / one",
		repositoryId: "repo-id",
	});
});

test("catalog errors stop after two restarts and unrelated failures are not retried", async () => {
	const signal = new AbortController().signal;
	vi.mocked(apiFetch).mockRejectedValue(
		new ApiError("Changed", 409, { error: { code: "SNAPSHOT_CHANGED" } }),
	);
	await expect(loadCatalog("cli", signal)).rejects.toThrow("Changed");
	expect(apiFetch).toHaveBeenCalledTimes(3);
	vi.mocked(apiFetch).mockClear().mockRejectedValue(new Error("Offline"));
	await expect(loadCatalog("cli", signal)).rejects.toThrow("Offline");
	expect(apiFetch).toHaveBeenCalledOnce();
});

test("watch commands send only complete internal refs or observation ID and captured generation", async () => {
	vi.mocked(apiFetch).mockResolvedValue({ results: [] });
	await addWatches("cli", ["scoped-pr-id"]);
	await removeWatches("demo", [fixtureObservation()]);
	expect(
		JSON.parse(String(vi.mocked(apiFetch).mock.calls[0]?.[1]?.body)),
	).toEqual({ source: "live", refs: [{ pullId: "scoped-pr-id" }] });
	expect(
		JSON.parse(String(vi.mocked(apiFetch).mock.calls[1]?.[1]?.body)),
	).toEqual({ source: "sample", items: [{ id: "watch-1", generation: 1 }] });
	vi.mocked(apiFetch).mockResolvedValue({ jobs: [] });
	await discover("cli", { projectId: "project" });
	await refreshWatches("cli");
	await refreshWatches("demo", "pr");
	expect(
		JSON.parse(String(vi.mocked(apiFetch).mock.calls[3]?.[1]?.body)),
	).toEqual({ source: "live", target: { all: true } });
	expect(
		JSON.parse(String(vi.mocked(apiFetch).mock.calls[4]?.[1]?.body)),
	).toEqual({ source: "sample", target: { pullId: "pr" } });
});
