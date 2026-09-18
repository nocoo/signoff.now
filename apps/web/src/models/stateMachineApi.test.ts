import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { machineFixture } from "@/test/state-machine-fixture";
import {
	loadMachine,
	loadMachinePulls,
	loadMachineVersion,
	previewMachine,
	saveMachine,
} from "./stateMachineApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());
it("loads lightweight PR pages with the current scope, watch filter and cursor", async () => {
	const page = {
		data: [{ id: "pr", number: 42, title: "Change", watched: true }],
		nextCursor: "next",
	};
	vi.mocked(apiFetch).mockResolvedValue(page);
	const controller = new AbortController();
	const scope = {
		source: "cli" as const,
		projectId: "p /",
		repositoryId: "r /",
	};
	expect(
		await loadMachinePulls(
			scope,
			{ search: "#42", watchedOnly: true, cursor: null },
			controller.signal,
		),
	).toEqual(page);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/state-machines/p%20%2F/pulls?source=live&repositoryId=r+%2F&q=%2342&watched=true",
		{ signal: expect.any(AbortSignal) },
	);
	await loadMachinePulls(
		scope,
		{ search: "", watchedOnly: false, cursor: "next /" },
		controller.signal,
	);
	expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toContain(
		"q=&watched=false&cursor=next+%2F",
	);
	controller.abort();
	expect(vi.mocked(apiFetch).mock.lastCall?.[1]?.signal?.aborted).toBe(true);
});
it("keeps machine reads source/repository scoped and validates cached data", async () => {
	const page = machineFixture();
	vi.mocked(apiFetch).mockResolvedValue(page);
	const signal = new AbortController().signal;
	expect(
		await loadMachine(
			{ source: "cli", projectId: "p /", repositoryId: "r /" },
			"pr:42",
			signal,
		),
	).toEqual(page);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/state-machines/p%20%2F?source=live&repositoryId=r+%2F&pullId=pr%3A42",
		{ signal },
	);
	vi.mocked(apiFetch).mockResolvedValue({});
	await expect(
		loadMachine(
			{ source: "demo", projectId: "p", repositoryId: null },
			null,
			signal,
		),
	).rejects.toThrow();
});
it("previews, saves and loads versions with schema-checked payloads", async () => {
	const page = machineFixture();
	const scope = { source: "demo" as const, projectId: "p", repositoryId: null };
	const body = { revision: 1, repositoryId: null, config: page.config };
	const preview = {
		revision: 1,
		dataRevision: "1",
		evaluatedCount: 1,
		total: 1,
		truncated: false,
		changed: 0,
		changes: [],
		evaluations: page.evaluations,
	};
	vi.mocked(apiFetch)
		.mockResolvedValueOnce(preview)
		.mockResolvedValueOnce({ revision: 2 })
		.mockResolvedValueOnce({ revision: 2, config: null });
	expect(await previewMachine(scope, body, "historical:pr")).toEqual(preview);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/state-machines/p/preview?source=sample&pullId=historical%3Apr",
		{ method: "POST", body: JSON.stringify(body) },
	);
	expect(await saveMachine(scope, body)).toEqual({ revision: 2 });
	expect(await loadMachineVersion(scope, 1)).toEqual({
		revision: 2,
		config: null,
	});
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/state-machines/p/versions/1?source=sample",
	);
	await expect(saveMachine(scope, { ...body, revision: 0 })).rejects.toThrow();
});
