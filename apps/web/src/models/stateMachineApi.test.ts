import { afterEach, expect, test, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	fixtureObservation,
	fixtureProject,
	fixturePull,
	publicPull,
	queryFixture,
} from "@/test/monitoring-fixture";
import { loadMachineHistory, loadMachinePulls } from "./stateMachineApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());
test("picker pages only the requested cache scope and includes terminal or unwatched PRs", async () => {
	const fixture = queryFixture();
	const signal = new AbortController().signal;
	vi.mocked(apiFetch).mockResolvedValue({
		...fixture.pulls,
		data: [
			publicPull(fixturePull, fixtureProject, fixtureObservation()),
			publicPull(),
		],
		page: { limit: 50, total: 70, nextCursor: "next" },
	});
	const scope = {
		source: "cli" as const,
		projectId: "project/a",
		repositoryId: "repo",
	};
	const result = await loadMachinePulls(
		scope,
		{ search: "query", watchedOnly: true, cursor: "previous" },
		signal,
	);
	expect(result.data.map((p) => p.watched)).toEqual([true, false]);
	expect(result.nextCursor).toBe("next");
	const request = new URL(
		String(vi.mocked(apiFetch).mock.lastCall?.[0]),
		"http://localhost",
	);
	expect(Object.fromEntries(request.searchParams)).toMatchObject({
		source: "live",
		projectId: "project/a",
		repositoryId: "repo",
		state: "all",
		draft: "include",
		watching: "true",
		q: "query",
		cursor: "previous",
	});
	await loadMachinePulls(
		{ ...scope, repositoryId: null, source: "demo" },
		{ search: "", watchedOnly: false, cursor: null },
		signal,
	);
	expect(String(vi.mocked(apiFetch).mock.lastCall?.[0])).not.toContain(
		"repositoryId",
	);
	expect(String(vi.mocked(apiFetch).mock.lastCall?.[0])).not.toContain(
		"watching",
	);
	vi.mocked(apiFetch).mockResolvedValueOnce({ events: [] });
	expect(await loadMachineHistory(scope, "pr/a", signal)).toEqual({
		events: [],
	});
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toBe(
		"/api/state-machines/project%2Fa/history?source=live&pullId=pr%2Fa",
	);
});
