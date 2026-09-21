import { JEV_MODEL, JEV_RUBRIC } from "@signoff/domain/ai-readiness";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureProject } from "@/test/monitoring-fixture";
import { useAiSettingsViewModel } from "./useAiSettingsViewModel";
import { useStateMachineViewModel } from "./useStateMachineViewModel";

const settings = {
	configured: false,
	storageReady: true,
	revision: 1,
	testedAt: null,
	testState: "untested",
	testError: null,
	model: JEV_MODEL,
	rubric: JEV_RUBRIC,
};
const machine = {
	project: fixtureProject,
	repositoryId: null,
	repositories: [],
	revision: 1,
	inherited: false,
	catalog: [],
	policyCodes: {},
	instructions: [
		{ gateId: "a", description: "" },
		{ gateId: "b", description: "" },
	],
};
let calls: {
	url: string;
	method: string;
	body: Record<string, unknown> | null;
}[] = [];
let reply: (
	url: string,
	method: string,
	body: Record<string, unknown> | null,
) => Response;
beforeEach(() => {
	calls = [];
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	localStorage.clear();
	reply = (url) =>
		Response.json(url.includes("state-machines") ? machine : settings);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url, init) => {
			const method = init?.method ?? "GET",
				body = init?.body ? JSON.parse(init.body) : null;
			calls.push({ url: String(url), method, body });
			return reply(String(url), method, body);
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("keeps credentials in memory, clears them after save and supports test, clear and retry with reloads", async () => {
	const { result } = renderHook(useAiSettingsViewModel);
	await waitFor(() => expect(result.current.settings.data).not.toBeNull());
	act(() => result.current.setKey(" private-key "));
	await act(() => result.current.act("save"));
	expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
		revision: 1,
		apiKey: "private-key",
	});
	expect(result.current.key).toBe("");
	expect(localStorage.length).toBe(0);
	expect(result.current.notice).toContain("saved");
	for (const action of ["test", "retry", "clear"] as const)
		await act(() => result.current.act(action));
	expect(calls.some((c) => c.url.endsWith("/test"))).toBe(true);
	expect(calls.some((c) => c.url.endsWith("/retry"))).toBe(true);
	expect(
		calls.filter((c) => c.method === "PUT").slice(-1)[0]?.body?.apiKey,
	).toBeNull();
	expect(result.current.notice).toContain("cleared");
});
it("reports connection errors without claiming verification", async () => {
	reply = (_url, method) =>
		method === "POST"
			? Response.json({ error: "Rejected key" }, { status: 400 })
			: Response.json(settings);
	const { result } = renderHook(useAiSettingsViewModel);
	await waitFor(() => expect(result.current.settings.data).not.toBeNull());
	await act(() => result.current.act("test"));
	expect(result.current.error).toContain("Rejected key");
	expect(result.current.notice).toBeNull();
	expect(result.current.busy).toBeNull();
});
it("retains policy descriptions and priority under the original CAS revision", async () => {
	reply = (_url, method, body) =>
		Response.json(
			method === "PUT"
				? {
						...machine,
						revision: 2,
						instructions: body?.instructions ?? machine.instructions,
					}
				: machine,
		);
	const { result } = renderHook(() =>
		useStateMachineViewModel({
			projectId: "project/id",
			source: "cli",
			repositoryId: "repo/id",
		}),
	);
	await waitFor(() => expect(result.current.query.data).not.toBeNull());
	expect(calls[0]?.url).toContain(
		"project%2Fid?source=live&repositoryId=repo%2Fid",
	);
	act(() => result.current.describe("a", "Human approval is needed."));
	act(() => result.current.move(0, 1));
	act(() => result.current.move(-1, -1));
	expect(result.current.instructions[1]?.description).toContain("Human");
	expect(result.current.dirty).toBe(true);
	await act(() => result.current.save());
	expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
		revision: 1,
		repositoryId: "repo/id",
		instructions: [
			{ gateId: "b", description: "" },
			{ gateId: "a", description: "Human approval is needed." },
		],
	});
	expect(result.current.dirty).toBe(false);
	act(() => result.current.describe("b", "Draft"));
	act(() => result.current.discard());
	expect(result.current.instructions[0]?.description).toBe("");
	await act(() => result.current.save(true));
	expect(
		calls.filter((c) => c.method === "PUT").slice(-1)[0]?.body?.instructions,
	).toBeNull();
});
it("keeps policy drafts after conflicts and does not query without a project", async () => {
	const empty = renderHook(() =>
		useStateMachineViewModel({
			projectId: "",
			source: "cli",
			repositoryId: null,
		}),
	);
	await act(() => empty.result.current.save());
	expect(calls).toHaveLength(0);
	empty.unmount();
	reply = (_url, method) =>
		method === "PUT"
			? Response.json({ error: "Reload before saving" }, { status: 409 })
			: Response.json(machine);
	const { result } = renderHook(() =>
		useStateMachineViewModel({
			projectId: "project",
			source: "cli",
			repositoryId: null,
		}),
	);
	await waitFor(() => expect(result.current.query.data).not.toBeNull());
	act(() => result.current.describe("b", "New meaning"));
	await act(() => result.current.save());
	expect(result.current.error).toContain("Reload before saving");
	expect(result.current.dirty).toBe(true);
	expect(result.current.busy).toBe(false);
});
