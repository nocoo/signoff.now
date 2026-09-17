import { demoWorkspace } from "@signoff/domain/demo";
import {
	DEFAULT_READINESS_RULES,
	type ReadinessRule,
	readinessRuleKey,
} from "@signoff/domain/workbench";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReadinessFormViewModel } from "./useReadinessFormViewModel";

afterEach(cleanup);
const workspace = demoWorkspace(1_800_000_000);
const project = workspace.projects[0];
const pull = workspace.pullRequests[0];
const policy = {
	id: "gate",
	name: "Presence",
	state: "failed" as const,
	required: true,
	detail: "Check presence",
	owner: "Maya",
};
const pulls = [
	{
		...pull,
		projectId: project.id,
		policies: [
			policy,
			{ ...policy, id: "duplicate", name: " presence " },
			{ ...policy, id: "ci", name: "CI" },
			{ ...policy, name: "Optional", required: false },
		],
	},
	{
		...pull,
		projectId: "another",
		policies: [{ ...policy, name: "Private to other project" }],
	},
];
function mount(rules?: ReadinessRule[]) {
	const onSave = vi.fn().mockResolvedValue(true);
	return {
		...renderHook(() =>
			useReadinessFormViewModel(
				{ ...project, readinessRules: rules },
				pulls,
				onSave,
			),
		),
		onSave,
	};
}
describe("readiness editor", () => {
	it("discovers only this project's required policy names, with no duplicates", () => {
		const { result } = mount();
		expect(result.current.policyOptions).toEqual(["CI", "Presence"]);
		act(() => result.current.addPolicy("Presence"));
		expect(result.current.rules).toContainEqual({
			policy: "Presence",
			label: "Presence",
			color: "yellow",
		});
		expect(result.current.policyOptions).toEqual(["CI"]);
		act(() => result.current.addPolicy("Presence"));
		act(() => result.current.addPolicy("Unknown"));
		expect(result.current.rules).toHaveLength(10);
	});
	it("reorders immutably, supports keyboard movement boundaries, and saves the edited list", async () => {
		const rules = structuredClone(DEFAULT_READINESS_RULES);
		const { result, onSave } = mount(rules);
		act(() => result.current.moveRule("kind:blocked", 1));
		expect(result.current.rules[1]).toMatchObject({ kind: "blocked" });
		expect(rules).toEqual(DEFAULT_READINESS_RULES);
		act(() => result.current.moveRule("missing", 1));
		act(() => result.current.moveRule("kind:ready", -1));
		act(() => result.current.moveRule("kind:closed", 99));
		expect(result.current.rules[0]).toMatchObject({ kind: "ready" });
		expect(result.current.rules[result.current.rules.length - 1]).toMatchObject(
			{ kind: "closed" },
		);
		act(() =>
			result.current.updateRule("kind:blocked", {
				kind: "blocked",
				color: "purple",
			}),
		);
		await act(async () => {
			expect(await result.current.submit()).toBe(true);
		});
		expect(onSave).toHaveBeenCalledWith(result.current.rules);
		expect(result.current.rules[1]).toEqual({
			kind: "blocked",
			color: "purple",
		});
	});
	it("allows removing policy rules and resetting defaults, while retaining base states", () => {
		const { result } = mount();
		act(() => result.current.addPolicy("CI"));
		act(() => result.current.removePolicy("policy:ci"));
		expect(result.current.policyOptions).toContain("CI");
		act(() => result.current.removePolicy("kind:ready"));
		expect(result.current.rules.map(readinessRuleKey)).toContain("kind:ready");
		act(() => result.current.addPolicy("Presence"));
		act(() => result.current.reset());
		expect(result.current.rules).toEqual(DEFAULT_READINESS_RULES);
	});
	it("keeps invalid labels out of persistence and retains draft after a failed save", async () => {
		const { result, onSave } = mount();
		act(() => result.current.addPolicy("CI"));
		act(() =>
			result.current.updateRule("policy:ci", {
				policy: "CI",
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
			result.current.updateRule("policy:ci", {
				policy: "CI",
				label: "Validation",
				color: "yellow",
			}),
		);
		expect(result.current.error).toBeNull();
		onSave.mockResolvedValueOnce(false);
		await act(async () => {
			expect(await result.current.submit()).toBe(false);
		});
		expect(result.current.rules).toContainEqual({
			policy: "CI",
			label: "Validation",
			color: "yellow",
		});
	});
});
