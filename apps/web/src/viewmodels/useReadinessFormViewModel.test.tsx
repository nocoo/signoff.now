import { demoWorkspace } from "@signoff/domain/demo";
import {
	projectReadinessRules,
	type ReadinessRule,
} from "@signoff/domain/workbench";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useReadinessFormViewModel } from "./useReadinessFormViewModel";

afterEach(cleanup);
const workspace = demoWorkspace(1_800_000_000);
const project = workspace.projects[0];
const pull = {
	...workspace.pullRequests[0],
	projectId: project.id,
	builds: [],
	reviewers: [],
	requiredApprovals: 0,
	policies: [
		{
			id: "review",
			name: "Reviewers",
			kind: "review" as const,
			state: "passed" as const,
			required: true,
			detail: "Approved",
			owner: "Reviewers",
		},
		{
			id: "presence",
			name: "Presence",
			kind: "policy" as const,
			state: "queued" as const,
			required: true,
			detail: "Pending",
			owner: "Maintainers",
		},
	],
};
const defaults = projectReadinessRules(project, [pull]);
function mount(rules?: ReadinessRule[]) {
	const onSave = vi.fn().mockResolvedValue(true);
	return {
		...renderHook(() =>
			useReadinessFormViewModel(
				{ ...project, readinessRules: rules },
				[pull],
				onSave,
			),
		),
		onSave,
	};
}
it("automatically lists the actual requirements, including passed ones, without generic state choices", () => {
	const { result } = mount();
	expect(result.current.rules.map((rule) => rule.gateId)).toEqual([
		"merge-conflicts",
		"review",
		"presence",
	]);
	expect(result.current.requirements.map((gate) => gate.name)).toContain(
		"Reviewers",
	);
});
it("reorders immutably, honors boundaries, edits color and label, and saves only real requirement IDs", async () => {
	const input = structuredClone(defaults);
	const { result, onSave } = mount(input);
	act(() => result.current.moveRule("presence", 0));
	expect(result.current.rules[0].gateId).toBe("presence");
	expect(input).toEqual(defaults);
	act(() => result.current.moveRule("missing", 1));
	act(() => result.current.moveRule("presence", -1));
	act(() => result.current.moveRule("presence", 99));
	expect(result.current.rules[0].gateId).toBe("presence");
	act(() =>
		result.current.updateRule("presence", {
			gateId: "presence",
			label: "PoP",
			color: "yellow",
		}),
	);
	await act(async () => {
		expect(await result.current.submit()).toBe(true);
	});
	expect(onSave).toHaveBeenCalledWith(result.current.rules);
	expect(result.current.rules[0]).toEqual({
		gateId: "presence",
		label: "PoP",
		color: "yellow",
	});
	act(() => result.current.reset());
	expect(result.current.rules).toEqual(defaults);
});
it("rejects invalid edits and retains the draft after a failed save", async () => {
	const { result, onSave } = mount();
	act(() =>
		result.current.updateRule("presence", {
			gateId: "presence",
			label: " ",
			color: "yellow",
		}),
	);
	await act(async () => {
		expect(await result.current.submit()).toBe(false);
	});
	expect(result.current.error).toBeTruthy();
	expect(onSave).not.toHaveBeenCalled();
	act(() =>
		result.current.updateRule("presence", {
			gateId: "presence",
			label: "PoP",
			color: "yellow",
		}),
	);
	expect(result.current.error).toBeNull();
	onSave.mockResolvedValueOnce(false);
	await act(async () => {
		expect(await result.current.submit()).toBe(false);
	});
	expect(
		result.current.rules.find((rule) => rule.gateId === "presence")?.label,
	).toBe("PoP");
});
