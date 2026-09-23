import {
	type DataSource,
	type DirectoryData,
	defaultContributionFilters,
} from "@signoff/domain/insights";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDirectory } from "@/models/directoryApi";
import { useInsightsViewModel } from "./useInsightsViewModel";

vi.mock("@/models/directoryApi", () => ({ fetchDirectory: vi.fn() }));
const fetch = vi.mocked(fetchDirectory);
const directory = (source: DataSource): DirectoryData => ({
	source,
	blockedContributorKeys: [],
	revision: 0,
	members: [],
	teams: [],
	tags: [],
	identities: [],
	projects: [],
	repositories: [],
});
beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	fetch.mockImplementation(async (source) => directory(source));
});

describe("insights filters and directory scope", () => {
	it.each([
		"null",
		"7",
		'"saved"',
		"[]",
		'{"includeDraft":true}',
	])("restores page defaults from incomplete or non-object storage: %s", async (stored) => {
		localStorage.setItem("signoff-insights-filters:cli", stored);
		const { result } = renderHook(() => useInsightsViewModel("cli"));
		expect(result.current.filters.from).toBe(
			defaultContributionFilters("cli").from,
		);
		expect(result.current.filters.to).toBe(
			defaultContributionFilters("cli").to,
		);
		expect(result.current.filters.includeDraft).toBe(
			stored.includes("includeDraft"),
		);
		await waitFor(() => expect(result.current.loading).toBe(false));
	});
	it("persists every filter separately by source and page, with no draft default", async () => {
		const { result, rerender, unmount } = renderHook(
			({ source }) => useInsightsViewModel(source),
			{ initialProps: { source: "cli" as DataSource } },
		);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.filters.includeDraft).toBe(false);
		act(() =>
			result.current.setFilters({
				teamIds: ["team"],
				repositoryKeys: ["repo"],
				contributorKeys: ["person"],
				includeDraft: true,
			}),
		);
		rerender({ source: "demo" });
		expect(result.current.filters.teamIds).toEqual([]);
		expect(result.current.directory).toBeNull();
		await waitFor(() => expect(result.current.directory?.source).toBe("demo"));
		rerender({ source: "cli" });
		expect(result.current.filters.teamIds).toEqual(["team"]);
		unmount();
		const restored = renderHook(() => useInsightsViewModel("cli"));
		expect(restored.result.current.filters).toMatchObject({
			includeDraft: true,
			teamIds: ["team"],
			contributorKeys: ["person"],
			repositoryKeys: ["repo"],
		});
		const repos = renderHook(() => useInsightsViewModel("cli", "repositories"));
		expect(repos.result.current.filters).toMatchObject({
			from: null,
			to: null,
			includeDraft: false,
			teamIds: [],
		});
		await waitFor(() => expect(repos.result.current.loading).toBe(false));
	});

	it("reports invalid date edits without loading a different statistics scope, and reset restores defaults", async () => {
		const { result } = renderHook(() => useInsightsViewModel("cli"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => result.current.setFilters({ from: "2026-02-30" }));
		expect(result.current.validFilters).toBeNull();
		expect(result.current.filterError).toBeTruthy();
		act(() => result.current.resetFilters());
		expect(result.current.validFilters).not.toBeNull();
		expect(result.current.filterError).toBeNull();
	});

	it("falls back from broken storage and works when storage is unavailable", async () => {
		localStorage.setItem("signoff-insights-filters:cli", "broken");
		const { result, unmount } = renderHook(() => useInsightsViewModel("cli"));
		expect(result.current.filters.includeDraft).toBe(false);
		await waitFor(() => expect(result.current.loading).toBe(false));
		unmount();
		const get = vi
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new Error("Denied");
			});
		const set = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("Denied");
			});
		const denied = renderHook(() => useInsightsViewModel("demo"));
		act(() => denied.result.current.setFilters({ audience: "followed" }));
		expect(denied.result.current.filters.audience).toBe("followed");
		await waitFor(() => expect(denied.result.current.loading).toBe(false));
		denied.unmount();
		get.mockRestore();
		set.mockRestore();
	});

	it("ignores an old directory response, surfaces load failures and reloads only on request", async () => {
		let resolve!: (data: DirectoryData) => void;
		fetch
			.mockReturnValueOnce(
				new Promise((done) => {
					resolve = done;
				}),
			)
			.mockRejectedValueOnce(new Error("Network down"));
		const { result, rerender } = renderHook(
			({ source }) => useInsightsViewModel(source),
			{ initialProps: { source: "cli" as DataSource } },
		);
		rerender({ source: "demo" });
		await waitFor(() => expect(result.current.error).toBe("Network down"));
		await act(async () => {
			resolve(directory("cli"));
		});
		expect(result.current.directory).toBeNull();
		fetch.mockRejectedValueOnce("Unavailable");
		await act(async () => {
			await result.current.reloadDirectory();
		});
		expect(result.current.error).toBe("Could not load directory");
		await act(async () => {
			await result.current.reloadDirectory();
		});
		expect(result.current.directory?.source).toBe("demo");
		expect(result.current.error).toBeNull();
	});
});

it("keeps directory controls available while a background refresh fails", async () => {
	const vm = renderHook(() => useInsightsViewModel("cli"));
	await waitFor(() => expect(vm.result.current.directory).not.toBeNull());
	const cached = vm.result.current.directory;
	let reject!: (error: Error) => void;
	fetch.mockImplementationOnce(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	let pending!: Promise<void>;
	act(() => {
		pending = vm.result.current.reloadDirectory();
	});
	expect(vm.result.current.loading).toBe(false);
	expect(vm.result.current.directory).toBe(cached);
	await act(async () => {
		reject(new Error("Offline"));
		await pending;
	});
	expect(vm.result.current.directory).toBe(cached);
	expect(vm.result.current.error).toBe("Offline");
});
