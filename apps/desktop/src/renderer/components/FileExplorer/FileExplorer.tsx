/**
 * FileExplorer — tree view for navigating workspace files.
 *
 * Phase 3 scaffold: renders a static placeholder tree.
 * Phase 7 #17 will connect this to the filesystem tRPC router.
 *
 * Uses @headless-tree for accessible tree keyboard navigation.
 */

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useCallback, useState } from "react";
import type { FileTreeData, FileTreeNode } from "./types";

/** Static demo tree for scaffold phase. */
const DEMO_TREE: FileTreeData = {
	root: {
		id: "root",
		name: "workspace",
		isDirectory: true,
		children: ["src", "package.json", "tsconfig.json"],
	},
	src: {
		id: "src",
		name: "src",
		isDirectory: true,
		children: ["src/index.ts", "src/utils.ts"],
	},
	"src/index.ts": {
		id: "src/index.ts",
		name: "index.ts",
		isDirectory: false,
	},
	"src/utils.ts": {
		id: "src/utils.ts",
		name: "utils.ts",
		isDirectory: false,
	},
	"package.json": {
		id: "package.json",
		name: "package.json",
		isDirectory: false,
	},
	"tsconfig.json": {
		id: "tsconfig.json",
		name: "tsconfig.json",
		isDirectory: false,
	},
};

function TreeNode({
	node,
	depth,
	expanded,
	onToggle,
	onSelect,
	selectedId,
}: {
	node: FileTreeNode;
	depth: number;
	expanded: Set<string>;
	onToggle: (id: string) => void;
	onSelect: (id: string) => void;
	selectedId: string | null;
	tree: FileTreeData;
}) {
	const isExpanded = expanded.has(node.id);
	const isSelected = selectedId === node.id;

	return (
		<div>
			<button
				type="button"
				className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs ${
					isSelected
						? "bg-accent text-foreground"
						: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
				}`}
				style={{ paddingLeft: `${depth * 12 + 4}px` }}
				onClick={() => {
					if (node.isDirectory) {
						onToggle(node.id);
					}
					onSelect(node.id);
				}}
			>
				{node.isDirectory ? (
					isExpanded ? (
						<ChevronDown className="h-3.5 w-3.5 shrink-0" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 shrink-0" />
					)
				) : (
					<span className="w-3.5" />
				)}
				{node.isDirectory ? (
					<Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
				) : (
					<File className="h-3.5 w-3.5 shrink-0" />
				)}
				<span className="truncate">{node.name}</span>
			</button>
		</div>
	);
}

export function FileExplorer({
	tree = DEMO_TREE,
	rootId = "root",
	onFileSelect,
}: {
	tree?: FileTreeData;
	rootId?: string;
	onFileSelect?: (fileId: string) => void;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(
		new Set(["root", "src"]),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const handleToggle = useCallback((id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const handleSelect = useCallback(
		(id: string) => {
			setSelectedId(id);
			const node = tree[id];
			if (node && !node.isDirectory && onFileSelect) {
				onFileSelect(id);
			}
		},
		[tree, onFileSelect],
	);

	function renderNode(nodeId: string, depth: number): React.ReactNode {
		const node = tree[nodeId];
		if (!node) return null;

		return (
			<div key={node.id}>
				<TreeNode
					node={node}
					depth={depth}
					expanded={expanded}
					onToggle={handleToggle}
					onSelect={handleSelect}
					selectedId={selectedId}
					tree={tree}
				/>
				{node.isDirectory && expanded.has(node.id) && node.children && (
					<div>
						{node.children.map((childId) => renderNode(childId, depth + 1))}
					</div>
				)}
			</div>
		);
	}

	const rootNode = tree[rootId];
	if (!rootNode) {
		return <div className="p-2 text-xs text-muted-foreground">No files</div>;
	}

	return (
		<div className="overflow-y-auto text-xs" data-testid="file-explorer">
			{rootNode.children?.map((childId) => renderNode(childId, 0))}
		</div>
	);
}
