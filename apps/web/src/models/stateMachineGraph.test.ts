import { presentReadiness } from "@signoff/domain/ai-readiness";
import { type MachineHistory, machinePageSchema } from "@signoff/domain/query";
import { expect, test } from "vitest";
import {
	fixtureObservation,
	fixtureProject,
	fixturePull,
	publicPull,
} from "@/test/monitoring-fixture";
import { machineGraph } from "./stateMachineGraph";

const pull = publicPull(fixturePull, fixtureProject, fixtureObservation());
const page = machinePageSchema.parse({
	project: fixtureProject,
	repositoryId: null,
	repositories: [],
	revision: 1,
	inherited: false,
	catalog: pull.requirements,
	instructions: pull.requirements.map((g) => ({
		gateId: g.id,
		description: "Instruction",
	})),
	policyCodes: {},
});
const history: MachineHistory = { events: [] };
test("renders all lifecycle, priority-ordered policies and actual persisted judgments without reclassification", () => {
	const result = {
		kind: "running" as const,
		model: "jev-test",
		rubric: "test",
		fingerprint: "f",
		evaluatedAt: new Date().toISOString(),
		probabilities: { running: 1 },
		confidence: 1,
	};
	const failing = {
		...pull,
		requirements: pull.requirements.map((g) => ({
			...g,
			state: "failed" as const,
		})),
		readiness: presentReadiness("complete", result),
	};
	const graph = machineGraph(page, failing, history, "model");
	expect(graph.nodes.find((n) => n.id === "state:running")?.data.active).toBe(
		true,
	);
	expect(graph.nodes.find((n) => n.id === "state:attention")?.data.active).toBe(
		false,
	);
	expect(
		graph.nodes
			.filter((n) => n.data.category === "gate")
			.map((n) => n.data.entityId),
	).toEqual(page.instructions.map((i) => i.gateId));
	expect(
		graph.edges.every(
			(e) =>
				graph.nodes.some((n) => n.id === e.source) &&
				graph.nodes.some((n) => n.id === e.target),
		),
	).toBe(true);
	const pending = machineGraph(
		page,
		{ ...failing, readiness: presentReadiness("pending", null, null, result) },
		history,
		"model",
	);
	expect(
		pending.nodes.find((n) => n.id === "state:running")?.data.detail,
	).toContain("Previous judgment");
	expect(
		machineGraph(page, undefined, history, "model").nodes.filter(
			(n) => n.data.active,
		),
	).toHaveLength(0);
	const unwatched = machineGraph(page, publicPull(), history, "model");
	expect(
		unwatched.nodes.filter((n) => n.data.category === "state" && n.data.active),
	).toHaveLength(0);
	const filtered = machineGraph(
		page,
		{ ...pull, requirements: [] },
		history,
		"model",
		false,
	);
	expect(filtered.nodes.filter((n) => n.data.category === "gate")).toHaveLength(
		0,
	);
	const extra = structuredClone(page);
	extra.instructions = [{ gateId: "missing", description: "" }];
	extra.catalog[0]!.sourceIds = ["underlying"];
	extra.instructions.push(
		{ gateId: "underlying", description: "" },
		{ gateId: extra.catalog[0]!.id, description: "Same logical gate" },
	);
	extra.policyCodes[extra.catalog[0]!.id] = "C1";
	const mapped = machineGraph(
		extra,
		{
			...pull,
			requirements: [
				{ ...pull.requirements[0]!, id: "underlying", required: false },
			],
		},
		history,
		"model",
	);
	expect(mapped.nodes.filter((n) => n.data.category === "gate")).toHaveLength(
		extra.catalog.length,
	);
	expect(
		mapped.nodes.find((n) => n.id === `gate:${extra.catalog[0]!.id}`)?.data
			.detail,
	).toContain("Advisory");
});

test("observed transitions use retained provider facts, including initial and unchanged observations", () => {
	const gate = page.catalog[0]!.id;
	const before = {
		lifecycle: "open",
		gates: { [gate]: "queued" as const, missing: "unknown" as const },
	};
	const after = {
		lifecycle: "merged",
		gates: {
			[gate]: "passed" as const,
			missing: "unknown" as const,
			added: "failed" as const,
		},
	};
	const events: MachineHistory = {
		events: [
			{ id: 1, at: 1, from: null, to: before },
			{ id: 2, at: 2, from: before, to: after },
			{ id: 3, at: 3, from: after, to: after },
			{ id: 4, at: 4, from: before, to: after },
		],
	};
	const graph = machineGraph(page, pull, events, "observed");
	expect(graph.edges).toHaveLength(2);
	expect(graph.edges.map((e) => e.id)).toContain(
		`gate:${gate}:queued→gate:${gate}:passed`,
	);
	expect(graph.nodes.some((n) => n.id === "aggregate:jev")).toBe(false);
	expect(graph.nodes.some((n) => n.id === "state:ready")).toBe(false);
	expect(machineGraph(page, pull, history, "observed")).toEqual({
		nodes: [],
		edges: [],
	});
});
