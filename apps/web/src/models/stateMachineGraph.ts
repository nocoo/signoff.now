import type { MachinePage } from "@signoff/domain/query";
import type {
	MachineCondition,
	ReadinessColor,
	StateMachine,
} from "@signoff/domain/workbench";
import { type Edge, MarkerType, type Node } from "@xyflow/react";

export const MACHINE_COLORS: Record<ReadinessColor, string> = {
	green: "#22a06b",
	yellow: "#d6a11b",
	orange: "#e78335",
	blue: "#329dde",
	red: "#df5765",
	purple: "#9370db",
	gray: "#8b96a9",
};
export type MachineNodeData = {
	label: string;
	detail: string;
	color: ReadinessColor;
	category: "lifecycle" | "gate" | "mapping" | "state" | "aggregate" | "group";
	entityId: string;
	active: boolean;
	status?: string;
};
export type MachineNode = Node<MachineNodeData>;
export type MachineSelection = {
	category: MachineNodeData["category"];
	id: string;
};
type Evaluation = MachinePage["evaluations"][number];
const gateColors: Record<string, ReadinessColor> = {
	passed: "green",
	failed: "red",
	running: "blue",
	queued: "blue",
	waiting: "yellow",
	canceled: "orange",
	skipped: "gray",
	unknown: "gray",
};
export function describeCondition(condition: MachineCondition) {
	const name = {
		lifecycle: "Lifecycle",
		draft: "Draft",
		mergeable: "Mergeability",
		coverage: "Coverage",
		checksValidity: "Check validity",
		baseline: "Default judgment",
		gate: "Gate",
		policyStatus: "Provider status",
		buildExpired: "Build expired",
		buildNotCurrent: "Behind target",
	}[condition.fact];
	return `${name}: ${"oneOf" in condition ? condition.oneOf.join(" / ") : condition.equals ? "yes" : "no"}`;
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
	if (from < 0 || to < 0 || from >= items.length || to >= items.length)
		return items;
	const next = [...items];
	next.splice(to, 0, ...next.splice(from, 1));
	return next;
}

type Graph = { nodes: MachineNode[]; edges: Edge[] };
function addNode(
	graph: Graph,
	id: string,
	group: string,
	data: MachineNodeData,
) {
	const parentId = `group:${group}`;
	if (!graph.nodes.some((n) => n.id === parentId))
		graph.nodes.push({
			id: parentId,
			type: "group",
			position: { x: 0, y: 0 },
			data: {
				label: group,
				detail: "",
				color: "gray",
				category: "group",
				entityId: group,
				active: false,
			},
			selectable: false,
			draggable: false,
			style: { width: 300, height: 200, borderRadius: 16 },
		});
	graph.nodes.push({
		id,
		type: "machine",
		parentId,
		extent: "parent",
		position: { x: 25, y: 60 },
		data,
		ariaLabel: `${data.label}. ${data.detail}`,
		width: 224,
		height: 86,
	});
}
function addEdge(
	graph: Graph,
	source: string,
	target: string,
	active: boolean,
	label?: string,
	color: ReadinessColor = "gray",
	dashed = false,
) {
	const id = `${source}→${target}`;
	if (graph.edges.some((e) => e.id === id)) return;
	graph.edges.push({
		id,
		source,
		target,
		type: "smoothstep",
		animated: active,
		label,
		style: {
			stroke: MACHINE_COLORS[active ? color : "gray"],
			strokeWidth: active ? 2.5 : 1,
			opacity: active ? 1 : 0.4,
			...(dashed ? { strokeDasharray: "5 5" } : {}),
		},
		markerEnd: {
			type: MarkerType.ArrowClosed,
			color: MACHINE_COLORS[active ? color : "gray"],
		},
	});
}

function addObservedEdges(
	graph: Graph,
	transitions: MachinePage["transitions"],
) {
	const counts = new Map<string, number>();
	for (const event of transitions) {
		for (const state of [event.from, event.to]) {
			if (!state) continue;
			const id = state.stateId ?? state.kind;
			if (!graph.nodes.some((n) => n.id === `state:${id}`))
				addNode(graph, `state:${id}`, "States · Previous versions", {
					label: state.label,
					detail: `Observed at revision ${event.ruleRevision}`,
					color: state.color ?? "gray",
					category: "state",
					entityId: id,
					active: false,
				});
		}
		if (!event.from) continue;
		const source = `state:${event.from.stateId ?? event.from.kind}`;
		const target = `state:${event.to.stateId ?? event.to.kind}`;
		const key = `${source}→${target}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		addEdge(graph, source, target, true, undefined, event.to.color ?? "blue");
	}
	for (const e of graph.edges)
		e.label = `${counts.get(e.id)} observation${counts.get(e.id) === 1 ? "" : "s"}`;
}

function addModelFacts(
	graph: Graph,
	config: StateMachine,
	selected: Evaluation | undefined,
	showAllGates: boolean,
) {
	for (const [id, label, color] of [
		["open", "Active", "blue"],
		["draft", "Draft", "gray"],
		["merged", "Completed", "purple"],
		["closed", "Abandoned", "gray"],
	] as const) {
		addNode(graph, `source:${id}`, "Provider lifecycle", {
			label,
			detail:
				id === "merged" || id === "closed"
					? "Stops automatic observation"
					: "Provider fact",
			color,
			category: "lifecycle",
			entityId: id,
			active:
				id ===
				(selected?.readiness.kind === "draft" ? "draft" : selected?.lifecycle),
		});
	}
	addEdge(graph, "source:draft", "source:open", false, "Publish");
	addEdge(graph, "source:open", "source:draft", false, "Convert to draft");
	addEdge(graph, "source:open", "source:merged", false, "Complete");
	addEdge(graph, "source:open", "source:closed", false, "Abandon");
	addEdge(graph, "source:draft", "source:closed", false, "Abandon");
	addEdge(
		graph,
		"source:closed",
		"source:open",
		false,
		"Reopen · discover / watch",
		"gray",
		true,
	);
	addNode(graph, "evaluate", "Evaluation", {
		label: "Evaluate evidence",
		detail:
			config.priority === "severity"
				? "All blockers · highest urgency"
				: "All blockers · gate priority",
		color: "blue",
		category: "aggregate",
		entityId: "evaluate",
		active: Boolean(selected),
	});
	for (const gate of config.gates) {
		const fact = selected?.requirements.find((r) => r.id === gate.gateId);
		if (!showAllGates && !fact) continue;
		addNode(graph, `gate:${gate.gateId}`, `Gates · ${gate.group}`, {
			label: gate.label,
			detail: fact ? fact.state : "No evidence on this PR",
			color: fact ? (gateColors[fact.state] ?? "gray") : "gray",
			category: "gate",
			entityId: gate.gateId,
			active: Boolean(fact),
			status: fact?.state,
		});
		addEdge(
			graph,
			"source:open",
			`gate:${gate.gateId}`,
			Boolean(fact && selected?.lifecycle === "open"),
			undefined,
			fact ? gateColors[fact.state] : "gray",
			!fact,
		);
		addEdge(
			graph,
			`gate:${gate.gateId}`,
			"evaluate",
			Boolean(fact),
			undefined,
			fact ? gateColors[fact.state] : "gray",
			!fact,
		);
	}
	addEdge(graph, "source:open", "evaluate", false, "Lifecycle + coverage");
}

function addMappings(
	graph: Graph,
	config: StateMachine,
	selected: Evaluation | undefined,
) {
	for (const [index, rule] of config.mappings.entries()) {
		const trace = selected?.trace.find((t) => t.ruleId === rule.id);
		addNode(graph, `mapping:${rule.id}`, "Mappings · first match wins", {
			label: `${index + 1}. ${rule.name}`,
			detail: `${rule.enabled ? (rule.match === "all" ? "AND" : "OR") : "Disabled"} · ${rule.conditions.map(describeCondition).join(" · ")}`,
			color: trace?.guard ? "orange" : trace?.selected ? "blue" : "gray",
			category: "mapping",
			entityId: rule.id,
			active: trace?.selected ?? false,
		});
		const sources = rule.conditions.map((condition) => {
			if (
				"gateId" in condition &&
				graph.nodes.some((n) => n.id === `gate:${condition.gateId}`)
			)
				return `gate:${condition.gateId}`;
			if (
				condition.fact === "baseline" &&
				condition.oneOf.length === 1 &&
				["draft", "merged", "closed"].includes(condition.oneOf[0] ?? "")
			)
				return `source:${condition.oneOf[0]}`;
			return "evaluate";
		});
		for (const [i, source] of sources.entries())
			addEdge(
				graph,
				source,
				`mapping:${rule.id}`,
				Boolean(trace?.selected && trace.results[i]),
				undefined,
				"blue",
			);
		addEdge(
			graph,
			`mapping:${rule.id}`,
			`state:${rule.stateId}`,
			trace?.selected ?? false,
			trace?.guard ? "Protected" : undefined,
			config.states.find((s) => s.id === rule.stateId)?.color,
		);
	}
}

/** A view of evaluator configuration; drawing and filtering never rewrite facts or rules. */
export function machineGraph(
	config: StateMachine,
	evaluations: Evaluation[],
	selected: Evaluation | undefined,
	transitions: MachinePage["transitions"],
	mode: "model" | "observed",
	showAllGates = true,
) {
	const graph: Graph = { nodes: [], edges: [] };
	for (const state of config.states) {
		const count = evaluations.filter(
			(p) => (p.readiness.stateId ?? p.readiness.kind) === state.id,
		).length;
		addNode(graph, `state:${state.id}`, `States · ${state.group}`, {
			label: state.label,
			detail: `${count} cached PR${count === 1 ? "" : "s"}`,
			color: state.color,
			category: "state",
			entityId: state.id,
			active:
				(selected?.readiness.stateId ?? selected?.readiness.kind) === state.id,
		});
	}
	if (mode === "observed") addObservedEdges(graph, transitions);
	else {
		addModelFacts(graph, config, selected, showAllGates);
		addMappings(graph, config, selected);
	}
	return graph;
}
