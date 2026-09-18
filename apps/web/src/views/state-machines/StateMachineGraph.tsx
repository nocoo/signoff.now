import { Button } from "@nocoo/basalt";
import { useTheme } from "@nocoo/basalt/providers/theme";
import type { MachinePage } from "@signoff/domain/query";
import type { StateMachine } from "@signoff/domain/workbench";
import {
	Background,
	BackgroundVariant,
	Controls,
	Handle,
	MiniMap,
	type NodeProps,
	Position,
	ReactFlow,
	type ReactFlowInstance,
	useNodesState,
} from "@xyflow/react";
import {
	CheckCheck,
	CircleDot,
	Crosshair,
	Expand,
	GitBranch,
	GitMerge,
	GitPullRequest,
	Layers3,
	Network,
	Route,
	Scan,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
	MACHINE_COLORS,
	type MachineNode,
	type MachineSelection,
	machineGraph,
} from "@/models/stateMachineGraph";
import "@xyflow/react/dist/style.css";
import "./state-machines.css";

function FactNode({ data, selected }: NodeProps<MachineNode>) {
	const Icon =
		data.category === "state"
			? CheckCheck
			: data.category === "mapping"
				? Route
				: data.category === "aggregate"
					? Layers3
					: data.category === "lifecycle"
						? GitPullRequest
						: data.entityId.startsWith("build:")
							? GitBranch
							: ShieldCheck;
	return (
		<div
			className={cn(
				"machine-node h-full rounded-xl border bg-basalt-card p-3 text-basalt-foreground shadow-sm",
				selected &&
					"ring-2 ring-basalt-primary ring-offset-2 ring-offset-basalt-background",
			)}
			style={{
				borderColor: data.active ? MACHINE_COLORS[data.color] : undefined,
			}}
			title={data.detail}
		>
			<Handle
				type="target"
				position={Position.Left}
				style={{ background: MACHINE_COLORS[data.color] }}
			/>
			<div className="flex items-start gap-2.5">
				<div
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
					style={{
						backgroundColor: `${MACHINE_COLORS[data.color]}1a`,
						color: MACHINE_COLORS[data.color],
					}}
				>
					<Icon size={16} aria-hidden />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[12px] font-semibold leading-5">
						{data.label}
					</div>
					<p className="mt-1 line-clamp-2 text-[10px] leading-4 text-basalt-muted-foreground">
						{data.detail}
					</p>
				</div>
				{data.active ? (
					<CircleDot
						size={12}
						className="shrink-0"
						style={{ color: MACHINE_COLORS[data.color] }}
						aria-hidden
					/>
				) : null}
			</div>
			<Handle
				type="source"
				position={Position.Right}
				style={{ background: MACHINE_COLORS[data.color] }}
			/>
		</div>
	);
}
function GroupNode({ data }: NodeProps<MachineNode>) {
	return (
		<div className="h-full rounded-2xl border border-basalt-border/70 bg-basalt-muted/20 px-4 py-3">
			<span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-basalt-muted-foreground">
				{data.label}
			</span>
		</div>
	);
}
const nodeTypes = { machine: FactNode, group: GroupNode };
type Graph = ReturnType<typeof machineGraph>;

async function arrange(graph: Graph) {
	const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
	const result = await new ELK().layout({
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.hierarchyHandling": "INCLUDE_CHILDREN",
			"elk.spacing.nodeNode": "35",
			"elk.layered.spacing.nodeNodeBetweenLayers": "75",
			"elk.edgeRouting": "ORTHOGONAL",
		},
		children: graph.nodes
			.filter((node) => node.type === "group")
			.map((group) => ({
				id: group.id,
				layoutOptions: {
					"elk.padding": "[top=48,left=20,bottom=20,right=20]",
					"elk.spacing.nodeNode": "18",
				},
				children: graph.nodes
					.filter((node) => node.parentId === group.id)
					.map((node) => ({ id: node.id, width: 224, height: 86 })),
			})),
		edges: graph.edges.map((edge) => ({
			id: edge.id,
			sources: [edge.source],
			targets: [edge.target],
		})),
	});
	const positions = new Map<
		string,
		{ x: number; y: number; width?: number; height?: number }
	>();
	for (const group of result.children ?? []) {
		positions.set(group.id, {
			x: group.x ?? 0,
			y: group.y ?? 0,
			width: group.width,
			height: group.height,
		});
		for (const child of group.children ?? [])
			positions.set(child.id, { x: child.x ?? 20, y: child.y ?? 48 });
	}
	return positions;
}

export function StateMachineGraph({
	config,
	evaluations,
	selected,
	transitions,
	mode,
	showAllGates,
	storageKey,
	onSelect,
}: {
	config: StateMachine;
	evaluations: MachinePage["evaluations"];
	selected: MachinePage["evaluations"][number] | undefined;
	transitions: MachinePage["transitions"];
	mode: "model" | "observed";
	showAllGates: boolean;
	storageKey: string;
	onSelect: (selection: MachineSelection) => void;
}) {
	const { theme } = useTheme();
	const graph = useMemo(
		() =>
			machineGraph(
				config,
				evaluations,
				selected,
				transitions,
				mode,
				showAllGates,
			),
		[config, evaluations, selected, transitions, mode, showAllGates],
	);
	const latest = useRef(graph);
	latest.current = graph;
	const [nodes, setNodes, onNodesChange] = useNodesState<MachineNode>([]);
	const instance = useRef<ReactFlowInstance<MachineNode> | null>(null);
	const canvas = useRef<HTMLElement | null>(null);
	const [reset, setReset] = useState(0);
	const [layoutError, setLayoutError] = useState<string | null>(null);
	const structure = JSON.stringify([
		graph.nodes.map((n) => [n.id, n.parentId]),
		graph.edges.map((e) => e.id),
	]);
	useEffect(() => {
		setNodes((current) =>
			graph.nodes.map((node) => {
				const previous = current.find((n) => n.id === node.id);
				return previous
					? { ...node, position: previous.position, style: previous.style }
					: node;
			}),
		);
	}, [graph, setNodes]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only structural changes re-layout; polling changes colors and trace without moving the canvas
	useEffect(() => {
		let active = true;
		setLayoutError(null);
		void arrange(latest.current)
			.then((positions) => {
				if (!active) return;
				let saved: Record<string, { x: number; y: number }> = {};
				try {
					saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
				} catch {
					/* A private browser can still display the graph. */
				}
				setNodes(
					latest.current.nodes.map((node) => {
						const position = positions.get(node.id) ?? { x: 0, y: 0 };
						const stored = saved?.[node.id];
						return {
							...node,
							position:
								stored &&
								Number.isFinite(stored.x) &&
								Number.isFinite(stored.y) &&
								node.type !== "group"
									? stored
									: { x: position.x, y: position.y },
							style:
								node.type === "group"
									? {
											...node.style,
											width: position.width,
											height: position.height,
										}
									: node.style,
						};
					}),
				);
				// Fit ELK's known bounds directly: React Flow may still be measuring
				// the previous nodes in the frame when async layout completes.
				const groups = latest.current.nodes
					.filter((node) => node.type === "group")
					.map((node) => positions.get(node.id));
				const width = Math.max(
					1,
					...groups.map((group) => (group?.x ?? 0) + (group?.width ?? 0)),
				);
				const height = Math.max(
					1,
					...groups.map((group) => (group?.y ?? 0) + (group?.height ?? 0)),
				);
				void instance.current?.fitBounds(
					{ x: 0, y: 0, width, height },
					{ padding: 0.08, duration: 250 },
				);
			})
			.catch(() => {
				if (active)
					setLayoutError(
						"Unable to arrange this graph. Try auto layout again.",
					);
			});
		return () => {
			active = false;
		};
	}, [structure, storageKey, reset, setNodes]);
	return (
		<section
			ref={canvas}
			className="machine-canvas relative h-[650px] min-h-[460px] w-full overflow-hidden bg-basalt-background"
			aria-label="State machine graph"
		>
			<div className="absolute left-4 top-4 z-10 flex gap-2">
				<Button
					size="sm"
					variant="outline"
					className="bg-basalt-card/95 shadow-sm"
					onClick={() => {
						try {
							localStorage.removeItem(storageKey);
						} catch {
							/* Layout works without persistence. */
						}
						setReset((n) => n + 1);
					}}
				>
					<Network className="h-3.5 w-3.5" aria-hidden />
					Auto layout
				</Button>
				<Button
					size="icon"
					variant="outline"
					className="h-8 w-8 bg-basalt-card/95 shadow-sm"
					aria-label="Fit entire graph"
					onClick={() =>
						void instance.current?.fitView({ padding: 0.08, duration: 250 })
					}
				>
					<Scan className="h-4 w-4" aria-hidden />
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="bg-basalt-card/95 shadow-sm"
					disabled={!selected}
					onClick={() => {
						const gateId = selected?.readiness.primaryRequirementId;
						const id =
							mode === "model" && gateId
								? `gate:${gateId}`
								: `state:${selected?.readiness.stateId ?? selected?.readiness.kind}`;
						void instance.current?.fitView({
							nodes: [{ id }],
							padding: 0.8,
							maxZoom: 1.1,
							duration: 250,
						});
					}}
				>
					<Crosshair size={14} aria-hidden />
					Focus PR
				</Button>
				<Button
					size="icon"
					variant="outline"
					className="h-8 w-8 bg-basalt-card/95 shadow-sm"
					aria-label="Toggle graph fullscreen"
					onClick={() => {
						const action = document.fullscreenElement
							? document.exitFullscreen()
							: canvas.current?.requestFullscreen();
						void action?.catch(() =>
							setLayoutError("Fullscreen is unavailable in this browser."),
						);
					}}
				>
					<Expand size={14} aria-hidden />
				</Button>
			</div>
			{layoutError ? (
				<p
					role="alert"
					className="absolute left-4 top-16 z-10 rounded bg-basalt-card p-3 text-sm text-basalt-destructive"
				>
					{layoutError}
				</p>
			) : null}
			{mode === "observed" && !transitions.length ? (
				<div className="absolute left-4 top-16 z-10 max-w-xs rounded-xl border border-basalt-border bg-basalt-card/95 p-3 text-xs text-basalt-muted-foreground">
					<GitMerge size={16} className="mb-2" aria-hidden />
					No retained observations for this PR yet. History starts with new
					collected evidence.
				</div>
			) : null}
			<ReactFlow<MachineNode>
				colorMode={theme}
				nodes={nodes}
				edges={graph.edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onInit={(flow) => {
					instance.current = flow;
				}}
				onNodeClick={(_, node) =>
					onSelect({ category: node.data.category, id: node.data.entityId })
				}
				onNodeDoubleClick={(_, node) =>
					void instance.current?.fitView({
						nodes: [{ id: node.id }],
						padding: 0.8,
						maxZoom: 1.1,
						duration: 250,
					})
				}
				onNodeDragStop={(_, node) => {
					try {
						const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
						localStorage.setItem(
							storageKey,
							JSON.stringify({ ...saved, [node.id]: node.position }),
						);
					} catch {
						/* Dragging stays local when persistence is unavailable. */
					}
				}}
				minZoom={0.12}
				maxZoom={1.6}
				fitView
				nodesConnectable={false}
				deleteKeyCode={null}
				edgesFocusable={false}
				elevateEdgesOnSelect={false}
				defaultEdgeOptions={{
					labelStyle: { fontSize: 10 },
					labelBgStyle: { fill: "var(--machine-label-background)" },
					labelBgPadding: [6, 4],
				}}
			>
				<Background
					variant={BackgroundVariant.Dots}
					gap={22}
					size={1}
					color="var(--machine-grid-color)"
				/>
				<Controls showInteractive={false} />
				<MiniMap
					pannable
					zoomable
					nodeColor={(node) =>
						node.data?.color
							? MACHINE_COLORS[node.data.color as keyof typeof MACHINE_COLORS]
							: "#8b96a9"
					}
					maskColor="var(--machine-minimap-mask)"
				/>
			</ReactFlow>
		</section>
	);
}
