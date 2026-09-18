import { expect, it } from "vitest";
import { machineFixture } from "@/test/state-machine-fixture";
import { describeCondition, machineGraph, reorder } from "./stateMachineGraph";

it("draws every configured state, mapping and gate while retaining independent fact paths", () => {
	const page = machineFixture();
	const before = JSON.stringify(page);
	const graph = machineGraph(
		page.config,
		page.evaluations,
		page.evaluations[0],
		[],
		"model",
	);
	for (const state of page.config.states)
		expect(graph.nodes.some((n) => n.id === `state:${state.id}`)).toBe(true);
	for (const gate of page.config.gates)
		expect(
			graph.edges.some(
				(e) => e.source === `gate:${gate.gateId}` && e.target === "evaluate",
			),
		).toBe(true);
	const ids = new Set(graph.nodes.map((n) => n.id));
	expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(
		true,
	);
	expect(graph.edges.some((e) => e.animated)).toBe(true);
	expect(JSON.stringify(page)).toBe(before);
	expect(
		machineGraph(page.config, [], undefined, [], "model", false).nodes.some(
			(n) => n.data.category === "gate",
		),
	).toBe(false);
});
it("observed edges only come from retained evidence; missing history does not invent transitions", () => {
	const page = machineFixture();
	const ready = {
		...page.evaluations[0]!.readiness,
		stateId: "old-state",
		label: "Old custom state",
		kind: "review" as const,
		color: undefined,
	};
	const events = [
		{
			id: 1,
			at: 1,
			cause: "observation" as const,
			ruleRevision: 1,
			from: null,
			to: ready,
		},
		{
			id: 2,
			at: 2,
			cause: "observation" as const,
			ruleRevision: 2,
			from: ready,
			to: page.evaluations[0]!.readiness,
		},
	];
	const graph = machineGraph(
		page.config,
		page.evaluations,
		page.evaluations[0],
		[...events, events[1]!],
		"observed",
	);
	expect(graph.edges).toHaveLength(1);
	expect(graph.edges[0]?.label).toBe("2 observations");
	expect(graph.nodes.some((n) => n.id === "state:old-state")).toBe(true);
	expect(
		machineGraph(page.config, [], undefined, [], "observed").edges,
	).toEqual([]);
});
it("reorders presentation immutably and explains typed boolean and multi-value conditions", () => {
	const original = ["build", "review", "pop"];
	expect(reorder(original, 2, 0)).toEqual(["pop", "build", "review"]);
	expect(original).toEqual(["build", "review", "pop"]);
	expect(reorder(original, -1, 0)).toBe(original);
	expect(reorder(original, 0, 9)).toBe(original);
	expect(describeCondition({ fact: "draft", equals: false })).toBe("Draft: no");
	expect(
		describeCondition({ fact: "buildExpired", gateId: "ci", equals: true }),
	).toBe("Build expired: yes");
	expect(
		describeCondition({ fact: "lifecycle", oneOf: ["open", "closed"] }),
	).toBe("Lifecycle: open / closed");
});

it("draws AND/OR condition paths, disabled rules and readiness protection without evaluating them again", () => {
	const page = machineFixture();
	const gate = page.config.gates[0]!;
	page.config.mappings.unshift({
		id: "custom",
		name: "Unsafe ready",
		stateId: "ready",
		enabled: true,
		match: "any",
		conditions: [
			{ fact: "gate", gateId: gate.gateId, oneOf: ["passed"] },
			{ fact: "gate", gateId: gate.gateId, oneOf: ["unknown"] },
			{ fact: "gate", gateId: "not-collected", oneOf: ["passed"] },
			{ fact: "draft", equals: false },
		],
	});
	page.config.mappings[1]!.enabled = false;
	const selected = page.evaluations[0]!;
	selected.trace.unshift({
		ruleId: "custom",
		stateId: "ready",
		matched: true,
		selected: false,
		results: [true, false, false, true],
		guard: "Incomplete evidence",
	});
	const graph = machineGraph(
		page.config,
		page.evaluations,
		selected,
		[],
		"model",
	);
	expect(
		graph.nodes.find((n) => n.id === "mapping:custom")?.data,
	).toMatchObject({ color: "orange", active: false });
	expect(
		graph.nodes.find((n) => n.id === "mapping:custom")?.data.detail,
	).toContain("OR");
	expect(
		graph.nodes.find((n) => n.id === `mapping:${page.config.mappings[1]!.id}`)
			?.data.detail,
	).toContain("Disabled");
	expect(
		graph.edges.filter(
			(e) =>
				e.source === `gate:${gate.gateId}` && e.target === "mapping:custom",
		),
	).toHaveLength(1);
	expect(
		graph.edges.find(
			(e) => e.source === "evaluate" && e.target === "mapping:custom",
		),
	).toBeDefined();
	expect(graph.edges.find((e) => e.source === "mapping:custom")?.label).toBe(
		"Protected",
	);
	expect(selected.readiness.ready).toBe(false);
});
it("labels missing gate evidence and draft/terminal lifecycle independently of gate filtering", () => {
	const page = machineFixture();
	const selected = page.evaluations[0]!;
	selected.readiness = {
		...selected.readiness,
		kind: "draft",
		stateId: undefined,
	};
	selected.requirements = [];
	const graph = machineGraph(page.config, [selected], selected, [], "model");
	expect(graph.nodes.find((n) => n.id === "source:draft")?.data.active).toBe(
		true,
	);
	expect(graph.nodes.find((n) => n.id === "state:draft")?.data.detail).toBe(
		"1 cached PR",
	);
	expect(
		graph.nodes
			.filter((n) => n.data.category === "gate")
			.every((n) => n.data.detail === "No evidence on this PR"),
	).toBe(true);
	const without = machineGraph(page.config, [], undefined, [], "model");
	expect(
		without.nodes
			.filter((n) => n.data.category !== "group")
			.every((n) => !n.data.active),
	).toBe(true);
	selected.lifecycle = "closed";
	selected.readiness.kind = "closed";
	const closed = machineGraph(
		page.config,
		[selected],
		selected,
		[],
		"model",
		false,
	);
	expect(closed.nodes.find((n) => n.id === "source:closed")?.data.active).toBe(
		true,
	);
	expect(closed.nodes.some((n) => n.data.category === "gate")).toBe(false);
});
it("retains self-transitions and historical states without a custom ID or color", () => {
	const page = machineFixture();
	const state = {
		...page.evaluations[0]!.readiness,
		stateId: undefined,
		color: undefined,
		kind: "review" as const,
	};
	const graph = machineGraph(
		page.config,
		[],
		undefined,
		[
			{
				id: 1,
				at: 1,
				cause: "observation",
				ruleRevision: 1,
				from: state,
				to: state,
			},
		],
		"observed",
	);
	expect(graph.edges).toHaveLength(1);
	expect(graph.edges[0]).toMatchObject({
		source: "state:review",
		target: "state:review",
		label: "1 observation",
	});
	expect(reorder([1, 2], 9, 0)).toEqual([1, 2]);
	expect(reorder([1, 2], 0, -1)).toEqual([1, 2]);
	expect(reorder([undefined, 1], 0, 1)).toEqual([1, undefined]);
});
