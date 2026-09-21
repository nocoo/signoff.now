import { afterEach, expect, test, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";
import {
	fixtureJob,
	fixtureObservation,
	fixturePull,
	publicPull,
	queryFixture,
} from "@/test/monitoring-fixture";
import {
	addWatches,
	discover,
	loadCatalog,
	loadCollectionJob,
	loadCollector,
	loadCollectorGroups,
	loadCollectorHistory,
	loadPending,
	loadPull,
	loadPulls,
	lookupPull,
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

test("collector history and detail reads validate payloads and encode scoped cursors", async () => {
	vi.mocked(apiFetch).mockResolvedValueOnce({ data: [], nextCursor: null });
	await loadCollectorHistory(
		"demo",
		{ lane: "checks", outcome: "issues", cursor: "a+/=" },
		new AbortController().signal,
	);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toBe(
		"/api/query/v1/jobs?source=sample&lane=checks&outcome=issues&cursor=a%2B%2F%3D",
	);
	vi.mocked(apiFetch).mockResolvedValueOnce({ data: [], nextCursor: null });
	await loadCollectorHistory(
		"cli",
		{ lane: "all", outcome: "all" },
		new AbortController().signal,
	);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).not.toContain("cursor");
	vi.mocked(apiFetch).mockResolvedValueOnce(fixtureJob());
	expect(
		(await loadCollectionJob("cli", "job / 1", new AbortController().signal))
			.id,
	).toBe("job-1");
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toBe(
		"/api/query/v1/jobs/job%20%2F%201?source=live",
	);
	vi.mocked(apiFetch).mockResolvedValueOnce({ data: [{ state: "invalid" }] });
	await expect(
		loadCollectorHistory(
			"cli",
			{ lane: "all", outcome: "all" },
			new AbortController().signal,
		),
	).rejects.toThrow();
});

test("friendly PR links resolve from the scoped cache without invoking collection", async () => {
	const fixture = queryFixture();
	vi.mocked(apiFetch).mockResolvedValue({
		...fixture.envelope,
		data: fixture.pulls.data[0],
	});
	const reference = {
		repositoryUrl: "https://dev.azure.com/org/Core%20API/_git/client",
		number: 59380,
	};
	await lookupPull("demo", reference, new AbortController().signal);
	const [path, options] = vi.mocked(apiFetch).mock.lastCall!;
	const url = new URL(path, "https://signoff.dev.hexly.ai");
	expect(url.pathname).toBe("/api/query/v1/prs/lookup");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		source: "sample",
		repositoryUrl: reference.repositoryUrl,
		number: "59380",
	});
	expect(options?.method).toBeUndefined();
});

test("subsecond summary clocks remain valid domain timestamps while checks keep their independent age", () => {
	const value = publicPull();
	value.freshness.listObservedAt = "2026-09-18T06:12:02.456Z";
	value.freshness.checksObservedAt = "2026-09-18T06:01:30.000Z";
	const row = queryRow(value);
	expect(row.pull.observedAt).toBe(Date.parse("2026-09-18T06:12:02Z") / 1000);
	expect(row.pull.summaryObservedAt).toBe(
		Date.parse(value.freshness.listObservedAt) / 1000,
	);
	expect(row.pull.checksObservedAt).toBe(
		Date.parse(value.freshness.checksObservedAt) / 1000,
	);
});

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

test("pending watches have independent page navigation", async () => {
	const fixture = queryFixture();
	vi.mocked(apiFetch).mockResolvedValue({
		...fixture.envelope,
		data: [],
		page: { ...fixture.page, total: 21 },
	});
	await loadPending("cli", new AbortController().signal, undefined, 2);
	expect(apiFetch).toHaveBeenCalledWith(
		"/api/query/v1/observations?source=live&pending=true&limit=20&page=2",
		expect.anything(),
	);
});
test("unresolved repository URLs are never sent as stable provider IDs", async () => {
	const fixture = queryFixture();
	const repository = fixture.catalog.data[0]!.repository.url;
	const filter = { ...readPullFilter(new URLSearchParams(), true), repository };
	const params = new URLSearchParams(pullQueryParams(filter, 1));
	expect(params.get("repo")).toBe(repository);
	expect(params.has("repositoryId")).toBe(false);
	vi.mocked(apiFetch).mockResolvedValue({
		...fixture.envelope,
		data: [],
		page: { ...fixture.page, total: 0 },
	});
	await loadPending("cli", new AbortController().signal, filter);
	const pending = new URL(
		String(vi.mocked(apiFetch).mock.calls[0]?.[0]),
		"http://localhost",
	).searchParams;
	expect(pending.get("repo")).toBe(repository);
	expect(pending.has("repositoryId")).toBe(false);
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

test("repository reference resolution keeps its full scope through cache-only catalog pagination", async () => {
	const fixture = queryFixture();
	vi.mocked(apiFetch)
		.mockResolvedValueOnce({
			...fixture.catalog,
			page: { ...fixture.page, nextCursor: "next" },
		})
		.mockResolvedValueOnce({ ...fixture.catalog, data: [] });
	const scope = {
		repository: "https://dev.azure.com/Acme/Platform%20Team/_git/old-name",
		projectId: "registration / one",
	};
	await loadCatalog("demo", new AbortController().signal, scope);
	for (const [path, init] of vi.mocked(apiFetch).mock.calls) {
		const params = new URL(String(path), "http://localhost").searchParams;
		expect(params.get("repo")).toBe(scope.repository);
		expect(params.get("projectId")).toBe(scope.projectId);
		expect(params.get("source")).toBe("sample");
		expect(init?.method).toBeUndefined();
	}
	expect(vi.mocked(apiFetch).mock.calls[1]?.[0]).toContain("cursor=next");
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

test("collector groups validate responses and preserve group and pagination scopes", async () => {
	const payload = {
		data: [],
		nextCursor: null,
		generatedAt: new Date().toISOString(),
	};
	const signal = new AbortController().signal;
	vi.mocked(apiFetch).mockResolvedValue(payload);
	expect(await loadCollectorGroups("cli", undefined, signal)).toEqual(payload);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toBe(
		"/api/query/v1/collector/groups?source=live",
	);
	await loadCollectorGroups("demo", "pr:a+/=", signal);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toBe(
		"/api/query/v1/collector/groups?source=sample&cursor=pr%3Aa%2B%2F%3D",
	);
	vi.mocked(apiFetch).mockResolvedValue({ data: [], nextCursor: null });
	await loadCollectorHistory(
		"cli",
		{ lane: "all", outcome: "all", group: "pr:a+/=" },
		signal,
	);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toContain(
		"group=pr%3Aa%2B%2F%3D",
	);
	vi.mocked(apiFetch).mockResolvedValue({ data: [{}] });
	await expect(loadCollectorGroups("cli", undefined, signal)).rejects.toThrow();
});
