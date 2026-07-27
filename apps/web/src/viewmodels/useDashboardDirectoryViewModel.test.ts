import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	listDevelopers,
	listRepos,
	listTags,
	listTeams,
} from "@/models/entitiesApi";
import { fetchSettings } from "@/models/settingsApi";
import { useDashboardDirectoryViewModel } from "./useDashboardDirectoryViewModel";

vi.mock("@/models/entitiesApi", () => ({
	listDevelopers: vi.fn(),
	listTeams: vi.fn(),
	listTags: vi.fn(),
	listRepos: vi.fn(),
}));
vi.mock("@/models/settingsApi", () => ({
	fetchSettings: vi.fn(),
}));

const settings = {
	pipelineConfigVersion: 3,
	scoresStale: false,
	scoresStaleReason: null,
	timezone: "Asia/Shanghai",
};

const mounted = async () => {
	const hook = renderHook(() => useDashboardDirectoryViewModel());
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
};

describe("useDashboardDirectoryViewModel", () => {
	beforeEach(() => {
		vi.mocked(listDevelopers)
			.mockReset()
			.mockResolvedValue([{}, {}] as never);
		vi.mocked(listTeams)
			.mockReset()
			.mockResolvedValue([{}] as never);
		vi.mocked(listTags)
			.mockReset()
			.mockResolvedValue([] as never);
		vi.mocked(listRepos)
			.mockReset()
			.mockResolvedValue([{}, {}, {}] as never);
		vi.mocked(fetchSettings)
			.mockReset()
			.mockResolvedValue(settings as never);
	});

	it("counts each entity list and exposes the pipeline config", async () => {
		const { result } = await mounted();
		expect(result.current.counts).toEqual({
			developers: 2,
			teams: 1,
			tags: 0,
			repos: 3,
		});
		expect(result.current.config).toEqual({
			version: 3,
			stale: false,
			staleReason: null,
			timezone: "Asia/Shanghai",
		});
		expect(result.current.error).toBeNull();
	});

	it("carries the stale flag and its reason", async () => {
		vi.mocked(fetchSettings).mockResolvedValueOnce({
			...settings,
			scoresStale: true,
			scoresStaleReason: "weights updated",
		} as never);
		const { result } = await mounted();
		expect(result.current.config?.stale).toBe(true);
		expect(result.current.config?.staleReason).toBe("weights updated");
	});

	it("one failed list fails the whole set rather than showing partial counts", async () => {
		// A zero next to "Repos" would read as "none bound", not "not loaded".
		vi.mocked(listRepos).mockRejectedValueOnce(new Error("repos down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("repos down");
		expect(result.current.counts).toBeNull();
		expect(result.current.config).toBeNull();
	});

	it("coerces a non-Error rejection", async () => {
		vi.mocked(fetchSettings).mockRejectedValueOnce("weird");
		const { result } = await mounted();
		expect(result.current.error).toBe("Failed to load");
	});

	it("reload refetches and clears a previous error", async () => {
		vi.mocked(listTeams).mockRejectedValueOnce(new Error("teams down"));
		const { result } = await mounted();
		expect(result.current.error).toBe("teams down");

		await act(async () => {
			result.current.reload();
		});
		expect(result.current.error).toBeNull();
		expect(result.current.counts?.teams).toBe(1);
	});
});
