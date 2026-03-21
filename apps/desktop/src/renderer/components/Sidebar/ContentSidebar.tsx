/**
 * ContentSidebar — middle-left panel for tabs and changes.
 *
 * Supports:
 * - Tabs mode (workspace tab list)
 * - Changes mode (git changes)
 * - Resizable width (200-500px)
 * - Collapsible (0px when closed)
 */

import {
	FileText,
	GitBranch,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { useCallback, useRef } from "react";
import {
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	SidebarMode,
	useSidebarStore,
} from "../../stores/sidebar-state";

export function ContentSidebar() {
	const {
		isSidebarOpen,
		sidebarWidth,
		isResizing,
		currentMode,
		setSidebarWidth,
		setIsResizing,
		setMode,
		toggleSidebar,
	} = useSidebarStore();

	const sidebarRef = useRef<HTMLDivElement>(null);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsResizing(true);

			const startX = e.clientX;
			const startWidth = sidebarWidth;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const delta = moveEvent.clientX - startX;
				const newWidth = startWidth + delta;
				if (newWidth < MIN_SIDEBAR_WIDTH / 2) {
					setSidebarWidth(0);
				} else {
					setSidebarWidth(newWidth);
				}
			};

			const handleMouseUp = () => {
				setIsResizing(false);
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[sidebarWidth, setSidebarWidth, setIsResizing],
	);

	if (!isSidebarOpen) {
		return (
			<div className="flex h-full flex-col border-r border-border">
				<button
					type="button"
					onClick={toggleSidebar}
					className="p-2 text-muted-foreground hover:text-foreground"
					title="Open sidebar"
				>
					<PanelLeftOpen className="h-4 w-4" />
				</button>
			</div>
		);
	}

	return (
		<div
			ref={sidebarRef}
			className="relative flex h-full flex-col border-r border-border bg-sidebar"
			style={{ width: sidebarWidth, minWidth: MIN_SIDEBAR_WIDTH }}
			data-testid="content-sidebar"
		>
			{/* Header with mode toggle */}
			<div className="flex h-10 items-center justify-between border-b border-border px-3">
				<div className="flex gap-1">
					<button
						type="button"
						onClick={() => setMode(SidebarMode.Tabs)}
						className={`rounded px-2 py-1 text-xs font-medium ${
							currentMode === SidebarMode.Tabs
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<FileText className="mr-1 inline h-3.5 w-3.5" />
						Tabs
					</button>
					<button
						type="button"
						onClick={() => setMode(SidebarMode.Changes)}
						className={`rounded px-2 py-1 text-xs font-medium ${
							currentMode === SidebarMode.Changes
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<GitBranch className="mr-1 inline h-3.5 w-3.5" />
						Changes
					</button>
				</div>
				<button
					type="button"
					onClick={toggleSidebar}
					className="rounded p-1 text-muted-foreground hover:text-foreground"
					title="Close sidebar"
				>
					<PanelLeftClose className="h-4 w-4" />
				</button>
			</div>

			{/* Content area placeholder */}
			<div className="flex-1 overflow-y-auto px-2 py-2">
				{currentMode === SidebarMode.Tabs ? (
					<div className="text-center text-xs text-muted-foreground">
						No open tabs
					</div>
				) : (
					<div className="text-center text-xs text-muted-foreground">
						No changes
					</div>
				)}
			</div>

			{/* Resize handle */}
			{/* biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a vertical resize handle with absolute positioning */}
			<div
				role="separator"
				tabIndex={0}
				aria-orientation="vertical"
				aria-valuenow={sidebarWidth}
				aria-valuemin={MIN_SIDEBAR_WIDTH}
				aria-valuemax={MAX_SIDEBAR_WIDTH}
				className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20"
				onMouseDown={handleMouseDown}
				data-testid="content-sidebar-resize"
				style={{
					opacity: isResizing ? 1 : undefined,
					backgroundColor: isResizing ? "hsl(var(--primary) / 0.3)" : undefined,
				}}
			/>
		</div>
	);
}
