import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@/models/stateMachineApi";
import { machineFixture } from "@/test/state-machine-fixture";
import { useStateMachineViewModel } from "./useStateMachineViewModel";

vi.mock("@/models/stateMachineApi", () => ({
	loadMachine: vi.fn(),
	previewMachine: vi.fn(),
	saveMachine: vi.fn(),
	loadMachineVersion: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(api.loadMachine).mockResolvedValue(machineFixture());
});
const scope = { source: "cli" as const, projectId: "p", repositoryId: "repo" };
const preview = () => ({
	revision: 1,
	dataRevision: "1",
	evaluatedCount: 1,
	total: 1,
	truncated: false,
	changed: 0,
	changes: [],
	evaluations: machineFixture().evaluations,
});
it("preserves edits across polling and requires a matching preview before save", async () => {
	const { result } = renderHook(() => useStateMachineViewModel(scope, null));
	await waitFor(() => expect(result.current.data).not.toBeNull());
	const config = structuredClone(result.current.config!);
	config.states[0]!.label = "Customized";
	act(() => result.current.update(config));
	await act(() => result.current.save());
	expect(api.saveMachine).not.toHaveBeenCalled();
	vi.mocked(api.previewMachine).mockResolvedValue(preview());
	await act(() => result.current.previewDraft());
	expect(result.current.canSave).toBe(true);
	vi.mocked(api.saveMachine).mockResolvedValue({ revision: 2 });
	await act(() => result.current.save());
	expect(api.saveMachine).toHaveBeenCalledWith(scope, {
		revision: 1,
		repositoryId: "repo",
		config,
	});
	expect(result.current.dirty).toBe(false);
});
it("rejects invalid drafts and retains them when the service rejects a save", async () => {
	const { result } = renderHook(() => useStateMachineViewModel(scope, null));
	await waitFor(() => expect(result.current.config).not.toBeNull());
	const config = structuredClone(result.current.config!);
	config.states[0]!.label = "";
	act(() => result.current.update(config));
	await act(() => result.current.previewDraft());
	expect(api.previewMachine).not.toHaveBeenCalled();
	expect(result.current.error).toBeTruthy();
	config.states[0]!.label = "Good";
	act(() => result.current.update(structuredClone(config)));
	vi.mocked(api.previewMachine).mockResolvedValue(preview());
	await act(() => result.current.previewDraft());
	vi.mocked(api.saveMachine).mockRejectedValue(new Error("Revision conflict"));
	await act(() => result.current.save());
	expect(result.current.error).toBe("Revision conflict");
	expect(result.current.dirty).toBe(true);
	act(() => result.current.discard());
	expect(result.current.dirty).toBe(false);
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
it("does no work until a project is selected and reports read errors", async () => {
	const { result, rerender } = renderHook(
		({ projectId }) => useStateMachineViewModel({ ...scope, projectId }, null),
		{ initialProps: { projectId: "" } },
	);
	act(() => {
		result.current.update(null);
		result.current.rebase();
	});
	await act(() => result.current.previewDraft());
	expect(result.current.config).toBeNull();
	expect(api.loadMachine).not.toHaveBeenCalled();
	vi.mocked(api.loadMachine).mockRejectedValueOnce(new Error("Offline"));
	rerender({ projectId: "p" });
	await waitFor(() => expect(result.current.error).toBe("Offline"));
	expect(result.current.canSave).toBe(false);
});
it("preserves draft revisions through polling and requires preview again after rebasing", async () => {
	const { result } = renderHook(() => useStateMachineViewModel(scope, null));
	await waitFor(() => expect(result.current.config).not.toBeNull());
	await act(() => result.current.previewDraft());
	expect(api.previewMachine).not.toHaveBeenCalled();
	act(() => result.current.update(result.current.config!));
	vi.mocked(api.previewMachine).mockResolvedValue(preview());
	await act(() => result.current.previewDraft());
	vi.mocked(api.loadMachine).mockResolvedValue({
		...machineFixture(),
		revision: 2,
	});
	await act(() => result.current.reload());
	expect(result.current.conflict).toBe(true);
	expect(result.current.canSave).toBe(false);
	vi.mocked(api.previewMachine).mockClear();
	await act(() => result.current.previewDraft());
	expect(api.previewMachine).not.toHaveBeenCalled();
	act(() => result.current.rebase());
	expect(result.current.conflict).toBe(false);
	expect(result.current.preview).toBeNull();
	await act(() => result.current.previewDraft());
	expect(api.previewMachine).toHaveBeenCalledWith(
		scope,
		expect.objectContaining({ revision: 2 }),
		null,
	);
});
it("fences a pending preview when the user rebases or edits again", async () => {
	const { result } = renderHook(() => useStateMachineViewModel(scope, null));
	await waitFor(() => expect(result.current.config).not.toBeNull());
	act(() => result.current.update(result.current.config!));
	const pending = deferred<ReturnType<typeof preview>>();
	vi.mocked(api.previewMachine).mockReturnValueOnce(pending.promise);
	let request!: Promise<void>;
	act(() => {
		request = result.current.previewDraft();
	});
	await act(() => result.current.restore(1));
	expect(api.loadMachineVersion).not.toHaveBeenCalled();
	act(() => result.current.rebase());
	await act(async () => {
		pending.resolve(preview());
		await request;
	});
	expect(result.current.preview).toBeNull();
	expect(result.current.canSave).toBe(false);
	const next = deferred<ReturnType<typeof preview>>();
	vi.mocked(api.previewMachine).mockReturnValueOnce(next.promise);
	act(() => {
		request = result.current.previewDraft();
	});
	act(() => result.current.update(structuredClone(result.current.config!)));
	await act(async () => {
		next.reject(new Error("Old failure"));
		await request;
	});
	expect(result.current.error).toBeNull();
});
it("keeps repository inheritance distinct from an explicit copied configuration", async () => {
	const page = machineFixture();
	const defaults = structuredClone(page.config);
	defaults.states[0]!.label = "Project default";
	page.project.stateMachine = {
		default: defaults,
		repositories: { repo: page.config },
	};
	vi.mocked(api.loadMachine).mockResolvedValue(page);
	const { result, rerender } = renderHook(
		({ repositoryId }: { repositoryId: string | null }) =>
			useStateMachineViewModel({ ...scope, repositoryId }, null),
		{ initialProps: { repositoryId: "repo" as string | null } },
	);
	await waitFor(() => expect(result.current.config).not.toBeNull());
	act(() => result.current.update(null));
	expect(result.current.config?.states[0]?.label).toBe("Project default");
	vi.mocked(api.previewMachine).mockResolvedValue(preview());
	await act(() => result.current.previewDraft());
	expect(api.previewMachine).toHaveBeenLastCalledWith(
		scope,
		{
			revision: 1,
			repositoryId: "repo",
			config: null,
		},
		null,
	);
	act(() => result.current.discard());
	rerender({ repositoryId: null });
	await waitFor(() => expect(result.current.config).not.toBeNull());
	act(() => result.current.update(null));
	expect(result.current.config?.states[0]?.label).not.toBe("Project default");
});
it("loads a historical version into a draft at the current revision and handles restore errors", async () => {
	const { result } = renderHook(() => useStateMachineViewModel(scope, null));
	await waitFor(() => expect(result.current.config).not.toBeNull());
	vi.mocked(api.loadMachineVersion).mockResolvedValue({
		revision: 1,
		config: null,
	});
	await act(() => result.current.restore(4));
	expect(result.current.dirty).toBe(true);
	expect(result.current.notice).toContain("Revision 4 loaded as a draft");
	expect(result.current.canSave).toBe(false);
	vi.mocked(api.loadMachineVersion).mockRejectedValue("untyped error");
	await act(() => result.current.restore(99));
	expect(result.current.error).toBe("Unable to update state machine");
});
it("ignores an old scope's preview, restore, and save replies", async () => {
	for (const operation of ["preview", "restore", "save"] as const) {
		const { result, rerender, unmount } = renderHook(
			({ projectId }) =>
				useStateMachineViewModel({ ...scope, projectId }, null),
			{ initialProps: { projectId: "p" } },
		);
		await waitFor(() => expect(result.current.config).not.toBeNull());
		act(() => result.current.update(result.current.config!));
		vi.mocked(api.previewMachine).mockResolvedValue(preview());
		await act(() => result.current.previewDraft());
		const pending = deferred<
			ReturnType<typeof preview> & {
				config: ReturnType<typeof machineFixture>["config"];
			}
		>();
		vi.mocked(
			operation === "preview"
				? api.previewMachine
				: operation === "save"
					? api.saveMachine
					: api.loadMachineVersion,
		).mockReturnValueOnce(pending.promise);
		let request!: Promise<void>;
		act(() => {
			request =
				operation === "preview"
					? result.current.previewDraft()
					: operation === "save"
						? result.current.save()
						: result.current.restore(1);
		});
		rerender({ projectId: "other" });
		await act(async () => {
			pending.resolve({
				...preview(),
				revision: 2,
				config: machineFixture().config,
			});
			await request;
		});
		expect(result.current.dirty).toBe(false);
		expect(result.current.notice).toBeUndefined();
		expect(result.current.preview).toBeNull();
		unmount();
	}
});
it("keeps a scope's graph when tracing another PR without leaking the previous raw evidence", async () => {
	const page = machineFixture();
	const { result, rerender } = renderHook(
		({ pullId }: { pullId: string | null }) =>
			useStateMachineViewModel(scope, pullId),
		{ initialProps: { pullId: page.selectedPull!.id } },
	);
	await waitFor(() =>
		expect(result.current.data?.selectedPull?.id).toBe(page.selectedPull!.id),
	);
	const pending = deferred<ReturnType<typeof machineFixture>>();
	vi.mocked(api.loadMachine).mockReturnValueOnce(pending.promise);
	rerender({ pullId: "another-pr" });
	expect(result.current.data?.evaluations).toEqual(page.evaluations);
	expect(result.current.data?.selectedPull).toBeNull();
	expect(result.current.data?.transitions).toEqual([]);
	await act(async () => pending.resolve({ ...page, selectedPull: null }));
});
