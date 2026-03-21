/**
 * File tree types for the explorer sidebar.
 *
 * Represents a virtual file tree structure used by @headless-tree.
 * The actual file data comes from the filesystem tRPC router (Phase 7 #17).
 */

/** A node in the file tree. */
export interface FileTreeNode {
	/** Unique identifier (relative path from workspace root). */
	id: string;
	/** Display name (filename or directory name). */
	name: string;
	/** Whether this node is a directory. */
	isDirectory: boolean;
	/** Child node IDs (only for directories). */
	children?: string[];
}

/** Flat map of all nodes by ID, as expected by @headless-tree. */
export type FileTreeData = Record<string, FileTreeNode>;

/** File tree item for rendering — extends FileTreeNode with tree state. */
export interface FileTreeItem extends FileTreeNode {
	/** Depth level in the tree (0 = root). */
	depth: number;
	/** Whether the node is expanded (directories only). */
	isExpanded: boolean;
	/** Whether the node is selected / focused. */
	isSelected: boolean;
}
