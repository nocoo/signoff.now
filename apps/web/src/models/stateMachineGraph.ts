import {
	AI_LABELS,
	type AiReadiness,
	readinessBadge,
} from "@signoff/domain/ai-readiness";
import type {
	MachineHistory,
	MachinePage,
	PullQueryItem,
} from "@signoff/domain/query";
import type { ReadinessColor as ProviderColor } from "@signoff/domain/workbench";
import { type Edge, MarkerType, type Node } from "@xyflow/react";

type ReadinessColor = ProviderColor | "cyan" | "rose";
export const MACHINE_COLORS: Record<ReadinessColor, string> = {
	green: "#22a06b",
	yellow: "#d6a11b",
	orange: "#e78335",
	blue: "#329dde",
	red: "#df5765",
	purple: "#9370db",
	gray: "#8b96a9",
	cyan: "#16a6b6",
	rose: "#eb8797",
};
export type MachineNodeData = {
	label: string;
	detail: string;
	color: ReadinessColor;
	category: "lifecycle" | "gate" | "state" | "aggregate" | "group";
	entityId: string;
	active: boolean;
	status?: string;
};
export type MachineNode = Node<MachineNodeData>;
export type MachineSelection = {
	category: MachineNodeData["category"];
	id: string;
};
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
export type MachineGraph = { nodes: MachineNode[]; edges: Edge[] };
function addNode(
	graph: MachineGraph,
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
	graph: MachineGraph,
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

export const STATE_COLORS: Record<AiReadiness["kind"], ReadinessColor> = {
	conflict: "red",
	attention: "rose",
	warning: "yellow",
	running: "blue",
	ready: "green",
	waiting: "gray",
	review_needed: "purple",
	skipped: "cyan",
	unknown: "gray",
	error: "red",
};
function add(
	graph: MachineGraph,
	id: string,
	group: string,
	label: string,
	detail: string,
	color: ReadinessColor,
	category: MachineNodeData["category"],
	active = false,
	status?: string,
) {
	addNode(graph, id, group, {
		label,
		detail,
		color,
		category,
		entityId: id.slice(id.indexOf(":") + 1),
		active,
		status,
	});
}

function observedGraph(
	page: MachinePage,
	history: MachineHistory,
): MachineGraph {
	const graph: MachineGraph = { nodes: [], edges: [] };
	for (const event of history.events) {
		const snapshots = [event.from, event.to];
		for (const snapshot of snapshots) {
			if (!snapshot) continue;
			const id = `lifecycle:${snapshot.lifecycle}`;
			if (!graph.nodes.some((n) => n.id === id))
				add(
					graph,
					id,
					"Observed lifecycle",
					snapshot.lifecycle,
					"Provider fact",
					"blue",
					"lifecycle",
				);
			for (const [gate, status] of Object.entries(snapshot.gates)) {
				const nodeId = `gate:${gate}:${status}`;
				if (!graph.nodes.some((n) => n.id === nodeId))
					add(
						graph,
						nodeId,
						"Observed checks",
						page.catalog.find((g) => g.id === gate)?.name ?? gate,
						status,
						gateColors[status] ?? "gray",
						"gate",
						false,
						status,
					);
			}
		}
		if (!event.from) continue;
		if (event.from.lifecycle !== event.to.lifecycle)
			addEdge(
				graph,
				`lifecycle:${event.from.lifecycle}`,
				`lifecycle:${event.to.lifecycle}`,
				true,
				"Observed",
				"blue",
			);
		for (const [gate, status] of Object.entries(event.to.gates)) {
			const previous = event.from.gates[gate];
			if (previous && previous !== status)
				addEdge(
					graph,
					`gate:${gate}:${previous}`,
					`gate:${gate}:${status}`,
					true,
					"Observed",
					gateColors[status],
				);
		}
	}
	return graph;
}
export function machineGraph(
	page: MachinePage,
	pull: PullQueryItem | undefined,
	history: MachineHistory,
	mode: "model" | "observed",
	allGates = true,
): MachineGraph {
	const graph: MachineGraph = { nodes: [], edges: [] };

	if (mode === "observed") return observedGraph(page, history);

	for (const [id, label, color] of [
		["open", "Active", "blue"],
		["draft", "Draft", "gray"],
		["merged", "Completed", "purple"],
		["closed", "Abandoned", "gray"],
	] as const)
		add(
			graph,
			`lifecycle:${id}`,
			"Provider lifecycle",
			label,
			"Provider fact",
			color,
			"lifecycle",
			pull?.state === id,
		);
	for (const [from, to, label] of [
		["draft", "open", "Publish"],
		["open", "draft", "Convert to draft"],
		["open", "merged", "Complete"],
		["open", "closed", "Abandon"],
		["closed", "open", "Reopen"],
	])
		addEdge(graph, `lifecycle:${from}`, `lifecycle:${to}`, false, label);
	add(
		graph,
		"aggregate:jev",
		"Classification",
		"Jev",
		pull
			? `${pull.readiness.status} · ${pull.readiness.current?.model ?? pull.readiness.previous?.model ?? "No persisted judgment"}`
			: "Watch a PR to evaluate",
		"purple",
		"aggregate",
		Boolean(pull?.readiness.current),
	);
	const prioritized = page.instructions
		.map((i) =>
			page.catalog.find(
				(g) => g.id === i.gateId || g.sourceIds?.includes(i.gateId),
			),
		)
		.filter((g) => g !== undefined);
	const gates = new Map(
		[...prioritized, ...page.catalog].map((g) => [g.id, g]),
	);
	for (const gate of gates.values()) {
		const fact = pull?.requirements.find(
			(g) => g.id === gate.id || gate.sourceIds?.includes(g.id),
		);
		if (!allGates && !fact) continue;
		const color = gateColors[fact?.state ?? "unknown"] ?? "gray";
		add(
			graph,
			`gate:${gate.id}`,
			`Policies · ${gate.kind}`,
			`${page.policyCodes[gate.id] ?? ""} ${gate.name}`.trim(),
			fact
				? `${fact.state} · ${fact.required ? "Required" : "Advisory"}`
				: "No evidence on this PR",
			color,
			"gate",
			Boolean(fact),
			fact?.state,
		);
		addEdge(
			graph,
			"lifecycle:open",
			`gate:${gate.id}`,
			Boolean(fact && pull?.state === "open"),
			undefined,
			color,
			!fact,
		);
		addEdge(
			graph,
			`gate:${gate.id}`,
			"aggregate:jev",
			Boolean(fact && pull?.observation?.active),
			undefined,
			color,
			!fact,
		);
	}
	const readiness = pull ? readinessBadge(pull.readiness) : null;
	for (const [kind, label] of Object.entries(AI_LABELS)) {
		const key = kind as AiReadiness["kind"];
		const direct = kind === "conflict" || kind === "skipped";
		add(
			graph,
			`state:${kind}`,
			"Readiness",
			label,
			direct
				? "Direct provider / target check"
				: readiness?.kind === kind
					? `${pull?.readiness.previous ? "Previous judgment · " : ""}${readiness.nextAction}`
					: "Persisted classification",
			STATE_COLORS[key],
			"state",
			Boolean(readiness?.kind === kind && readiness.status !== "not_watched"),
		);
		addEdge(
			graph,
			direct ? "lifecycle:open" : "aggregate:jev",
			`state:${kind}`,
			readiness?.kind === kind && readiness.status !== "not_watched",
			direct ? "Direct" : undefined,
			STATE_COLORS[key],
		);
	}
	return graph;
}
