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
		"review:reviewers",
		"policy:presence",
	]);
	expect(result.current.requirements.map((gate) => gate.name)).toContain(
		"Reviewers",
	);
});
it("reorders immutably, honors boundaries, edits color and label, and saves only real requirement IDs", async () => {
	const input = structuredClone(defaults);
	const { result, onSave } = mount(input);
	act(() => result.current.moveRule("policy:presence", 0));
	expect(result.current.rules[0].gateId).toBe("policy:presence");
	expect(input).toEqual(defaults);
	act(() => result.current.moveRule("missing", 1));
	act(() => result.current.moveRule("policy:presence", -1));
	act(() => result.current.moveRule("policy:presence", 99));
	expect(result.current.rules[0].gateId).toBe("policy:presence");
	act(() =>
		result.current.updateRule("policy:presence", {
			gateId: "policy:presence",
			label: "PoP",
			color: "yellow",
		}),
	);
	await act(async () => {
		expect(await result.current.submit()).toBe(true);
	});
	expect(onSave).toHaveBeenCalledWith(result.current.rules);
	expect(result.current.rules[0]).toEqual({
		gateId: "policy:presence",
		label: "PoP",
		color: "yellow",
	});
	act(() => result.current.reset());
	expect(result.current.rules).toEqual(defaults);
});
it("rejects invalid edits and retains the draft after a failed save", async () => {
	const { result, onSave } = mount();
	act(() =>
		result.current.updateRule("policy:presence", {
			gateId: "policy:presence",
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
		result.current.updateRule("policy:presence", {
			gateId: "policy:presence",
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
		result.current.rules.find((rule) => rule.gateId === "policy:presence")
			?.label,
	).toBe("PoP");
});

it("merges newly collected requirements into an open draft without duplicating policies or losing edits", () => {
	const onSave = vi.fn();
	const { result, rerender } = renderHook(
		({ policies }) =>
			useReadinessFormViewModel(project, [{ ...pull, policies }], onSave),
		{ initialProps: { policies: pull.policies } },
	);
	act(() =>
		result.current.updateRule("policy:presence", {
			gateId: "policy:presence",
			label: "PoP",
			color: "yellow",
		}),
	);
	const newPolicy = { ...pull.policies[1], id: "security", name: "Security" };
	rerender({
		policies: [
			...pull.policies,
			{ ...pull.policies[0], id: "review-2" },
			newPolicy,
		],
	});
	expect(
		result.current.rules.filter((rule) => rule.gateId === "review:reviewers"),
	).toHaveLength(1);
	expect(
		result.current.rules.find((rule) => rule.gateId === "policy:presence"),
	).toMatchObject({ label: "PoP", color: "yellow" });
	expect(
		result.current.rules.some((rule) => rule.gateId === "policy:security"),
	).toBe(true);
});
