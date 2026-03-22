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
	Plus,
} from "lucide-react";
import { useCallback, useRef } from "react";
import { trpc } from "../../lib/trpc";
import { useActiveWorkspaceStore } from "../../stores/active-workspace";
import {
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	SidebarMode,
	useSidebarStore,
} from "../../stores/sidebar-state";
import { useTabsStore } from "../../stores/tabs";
import { TabType } from "../../stores/tabs/types";
import { LiveFileExplorer } from "../FileExplorer/FileExplorer";

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
						<FileExplorerPanel />
					) : (
						<ChangesPanel />
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

/** File explorer panel — shows files when a workspace is active. */
function FileExplorerPanel() {
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);
	const { addTab, addPane, panes } = useTabsStore();

	const openTab = useCallback(
		(tab: {
			id: string;
			label: string;
			type: TabType;
			isDirty: boolean;
			data?: Record<string, unknown>;
		}) => {
			const paneIds = Object.keys(panes);
			if (paneIds.length > 0) {
				addTab(paneIds[0], tab);
			} else {
				addPane(tab);
			}
		},
		[addTab, addPane, panes],
	);

	const handleFileSelect = useCallback(
		(relativePath: string) => {
			if (!activeWorkspace) return;
			const fileName = relativePath.split("/").pop() ?? relativePath;

			openTab({
				id: `editor-${relativePath}-${Date.now()}`,
				label: fileName,
				type: TabType.Editor,
				isDirty: false,
				data: {
					workspacePath: activeWorkspace.workspacePath,
					filePath: relativePath,
				},
			});
		},
		[activeWorkspace, openTab],
	);

	if (!activeWorkspace) {
		return (
			<div className="text-center text-xs text-muted-foreground">
				Select a workspace to browse files
			</div>
		);
	}

	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">Files</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-5 w-5"
							onClick={() => {
								if (!activeWorkspace) return;
								openTab({
									id: `terminal-${Date.now()}`,
									label: "Terminal",
									type: TabType.Terminal,
									isDirty: false,
									data: {
										workspaceId: activeWorkspace.id,
										workspacePath: activeWorkspace.workspacePath,
									},
								});
							}}
						>
							<Plus className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>New Terminal</TooltipContent>
				</Tooltip>
			</div>
			<LiveFileExplorer
				workspacePath={activeWorkspace.workspacePath}
				onFileSelect={handleFileSelect}
			/>
		</div>
	);
}

/** Changes panel — shows git changes for the active workspace. */
function ChangesPanel() {
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);

	if (!activeWorkspace) {
		return (
			<div className="text-center text-xs text-muted-foreground">
				Select a workspace to see changes
			</div>
		);
	}

	return <ChangesContent workspacePath={activeWorkspace.workspacePath} />;
}

/** Git changes content — fetches and displays git status. */
function ChangesContent({ workspacePath }: { workspacePath: string }) {
	const { data, isLoading } = trpc.changes.status.useQuery({ workspacePath });
	const { addTab, addPane, panes } = useTabsStore();
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);

	const handleDiffClick = useCallback(
		(filePath: string, staged: boolean) => {
			if (!activeWorkspace) return;
			const tab = {
				id: `diff-${filePath}-${staged ? "staged" : "unstaged"}-${Date.now()}`,
				label: `${filePath.split("/").pop()} (diff)`,
				type: TabType.Diff,
				isDirty: false,
				data: { workspacePath, filePath, staged },
			};
			const paneIds = Object.keys(panes);
			if (paneIds.length > 0) {
				addTab(paneIds[0], tab);
			} else {
				addPane(tab);
			}
		},
		[workspacePath, activeWorkspace, addTab, addPane, panes],
	);

	if (isLoading) {
		return (
			<div className="text-center text-xs text-muted-foreground">
				Loading changes…
			</div>
		);
	}

	if (!data?.files?.length) {
		return (
			<div className="text-center text-xs text-muted-foreground">
				No changes
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{data.files.map(
				(file: { path: string; status: string; staged: boolean }) => (
					<button
						key={`${file.path}-${file.staged}`}
						type="button"
						onClick={() => handleDiffClick(file.path, file.staged)}
						className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
					>
						<span
							className={`w-1.5 h-1.5 rounded-full shrink-0 ${
								file.status === "added"
									? "bg-green-500"
									: file.status === "deleted"
										? "bg-red-500"
										: "bg-yellow-500"
							}`}
						/>
						<span className="min-w-0 flex-1 truncate text-left">
							{file.path}
						</span>
						<span className="text-muted-foreground text-[10px]">
							{file.staged ? "S" : "U"}
						</span>
					</button>
				),
			)}
		</div>
	);
}
