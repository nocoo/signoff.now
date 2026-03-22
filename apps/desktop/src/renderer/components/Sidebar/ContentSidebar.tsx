/**
 * ContentSidebar — middle-left panel for tabs and changes.
 *
 * Supports:
 * - Tabs mode (workspace tab list)
 * - Changes mode (git changes)
 * - Resizable width (200-500px)
 * - Collapsible (0px when closed)
 */

import { Button } from "@signoff/ui/button";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Separator } from "@signoff/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
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
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							onClick={toggleSidebar}
							className="m-1"
						>
							<PanelLeftOpen className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Open sidebar</TooltipContent>
				</Tooltip>
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
			<div className="flex h-10 items-center justify-between px-3">
				<div className="flex gap-1">
					<Button
						variant={currentMode === SidebarMode.Tabs ? "secondary" : "ghost"}
						size="sm"
						className="h-7 text-xs"
						onClick={() => setMode(SidebarMode.Tabs)}
					>
						<FileText className="mr-1 h-3.5 w-3.5" />
						Tabs
					</Button>
					<Button
						variant={
							currentMode === SidebarMode.Changes ? "secondary" : "ghost"
						}
						size="sm"
						className="h-7 text-xs"
						onClick={() => setMode(SidebarMode.Changes)}
					>
						<GitBranch className="mr-1 h-3.5 w-3.5" />
						Changes
					</Button>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={toggleSidebar}
						>
							<PanelLeftClose className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Close sidebar</TooltipContent>
				</Tooltip>
			</div>

			<Separator />

			{/* Content area */}
			<ScrollArea className="flex-1">
				<div className="px-2 py-2">
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
			</ScrollArea>

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
