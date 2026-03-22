/**
 * WorkspaceSidebar — left panel showing projects and workspaces.
 *
 * Supports:
 * - Expanded view (220-400px) with project/workspace tree
 * - Collapsed icon-only view (52px)
 * - Drag to resize via mouse
 * - Toggle collapse via button
 */

import { ChevronLeft, ChevronRight, FolderGit2, Plus } from "lucide-react";
import { useCallback, useRef } from "react";
import {
	COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
	MAX_WORKSPACE_SIDEBAR_WIDTH,
	MIN_WORKSPACE_SIDEBAR_WIDTH,
	useWorkspaceSidebarStore,
} from "../../stores/workspace-sidebar-state";

export function WorkspaceSidebar() {
	const {
		isOpen,
		width,
		isResizing,
		setWidth,
		setIsResizing,
		toggleCollapsed,
		isCollapsed,
	} = useWorkspaceSidebarStore();

	const sidebarRef = useRef<HTMLDivElement>(null);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsResizing(true);

			const startX = e.clientX;
			const startWidth = width;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const delta = moveEvent.clientX - startX;
				setWidth(startWidth + delta);
			};

			const handleMouseUp = () => {
				setIsResizing(false);
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[width, setWidth, setIsResizing],
	);

	if (!isOpen) return null;

	const collapsed = isCollapsed();

	return (
		<div
			ref={sidebarRef}
			className="relative flex h-full flex-col border-r border-border bg-sidebar"
			style={{ width, minWidth: COLLAPSED_WORKSPACE_SIDEBAR_WIDTH }}
			data-testid="workspace-sidebar"
		>
			{/* Header */}
			<div className="flex h-10 items-center justify-between px-3">
				{!collapsed && (
					<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Projects
					</span>
				)}
				<button
					type="button"
					onClick={toggleCollapsed}
					className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					{collapsed ? (
						<ChevronRight className="h-4 w-4" />
					) : (
						<ChevronLeft className="h-4 w-4" />
					)}
				</button>
			</div>

			{/* Project list placeholder */}
			<div className="flex-1 overflow-y-auto px-2">
				{collapsed ? (
					<div className="flex flex-col items-center gap-2 pt-2">
						<div className="rounded p-2 text-muted-foreground hover:bg-accent">
							<FolderGit2 className="h-5 w-5" />
						</div>
					</div>
				) : (
					<div className="py-2 text-center text-xs text-muted-foreground">
						No projects yet
					</div>
				)}
			</div>

			{/* Footer: add project */}
			<div className="border-t border-border p-2">
				<button
					type="button"
					className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					title="Add project"
				>
					<Plus className="h-3.5 w-3.5" />
					{!collapsed && <span>Add Project</span>}
				</button>
			</div>

			{/* Resize handle */}
			{!collapsed && (
				// biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a vertical resize handle with absolute positioning
				<div
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-valuenow={width}
					aria-valuemin={MIN_WORKSPACE_SIDEBAR_WIDTH}
					aria-valuemax={MAX_WORKSPACE_SIDEBAR_WIDTH}
					className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20"
					onMouseDown={handleMouseDown}
					data-testid="workspace-sidebar-resize"
					style={{
						opacity: isResizing ? 1 : undefined,
						backgroundColor: isResizing
							? "hsl(var(--primary) / 0.3)"
							: undefined,
					}}
				/>
			)}
		</div>
	);
}
