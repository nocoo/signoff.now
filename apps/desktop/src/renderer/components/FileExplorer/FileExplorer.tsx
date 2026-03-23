/**
 * FileExplorer — tree view for navigating workspace files.
 *
 * Supports two modes:
 * - Static: pass `tree` prop (for tests or storybook)
 * - Live: pass `workspacePath` prop to fetch from filesystem tRPC
 *
 * Uses lazy loading: directories are fetched on expand.
 */

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import type { FileTreeData, FileTreeNode } from "./types";

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

/** Static FileExplorer — renders a pre-built tree. */
export function FileExplorer({
	tree,
	rootId = "root",
	onFileSelect,
}: {
	tree: FileTreeData;
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

/**
 * LiveFileExplorer — lazy-loads directory contents from the filesystem tRPC router.
 *
 * Fetches the root directory on mount, then fetches subdirectories on expand.
 */
export function LiveFileExplorer({
	workspacePath,
	onFileSelect,
}: {
	workspacePath: string;
	onFileSelect?: (relativePath: string) => void;
}) {
	const [tree, setTree] = useState<FileTreeData>({
		root: { id: "root", name: "workspace", isDirectory: true, children: [] },
	});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [fetchedDirs, setFetchedDirs] = useState<Set<string>>(new Set());

	// Fetch root directory on mount
	const { data: rootData, isLoading } = trpc.filesystem.listDirectory.useQuery(
		{ workspacePath, relativePath: "" },
		{ enabled: Boolean(workspacePath) },
	);

	// Populate tree when root data arrives
	useEffect(() => {
		if (!rootData) return;
		const children: string[] = [];
		const newNodes: FileTreeData = {};

		for (const entry of rootData.entries) {
			children.push(entry.name);
			newNodes[entry.name] = {
				id: entry.name,
				name: entry.name,
				isDirectory: entry.isDirectory,
				children: entry.isDirectory ? [] : undefined,
			};
		}

		setTree((prev) => ({
			...prev,
			...newNodes,
			root: { ...prev.root, children },
		}));
		setFetchedDirs((prev) => new Set([...prev, ""]));
	}, [rootData]);

	const utils = trpc.useUtils();

	const handleToggle = useCallback(
		async (id: string) => {
			setExpanded((prev) => {
				const next = new Set(prev);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				return next;
			});

			// Lazy load: fetch children if not already fetched
			if (!fetchedDirs.has(id)) {
				try {
					const data = await utils.filesystem.listDirectory.fetch({
						workspacePath,
						relativePath: id,
					});

					const children: string[] = [];
					const newNodes: FileTreeData = {};

					for (const entry of data.entries) {
						const childId = `${id}/${entry.name}`;
						children.push(childId);
						newNodes[childId] = {
							id: childId,
							name: entry.name,
							isDirectory: entry.isDirectory,
							children: entry.isDirectory ? [] : undefined,
						};
					}

					setTree((prev) => ({
						...prev,
						...newNodes,
						[id]: { ...prev[id], children },
					}));
					setFetchedDirs((prev) => new Set([...prev, id]));
				} catch {
					// Silently fail — user will see empty directory
				}
			}
		},
		[workspacePath, fetchedDirs, utils],
	);

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

	if (isLoading) {
		return (
			<div className="p-2 text-xs text-muted-foreground">Loading files…</div>
		);
	}

	const rootNode = tree.root;
	if (!rootNode?.children?.length) {
		return (
			<div className="p-2 text-xs text-muted-foreground">Empty directory</div>
		);
	}

	return (
		<div className="overflow-y-auto text-xs" data-testid="file-explorer">
			{rootNode.children.map((childId) => renderNode(childId, 0))}
		</div>
	);
}
