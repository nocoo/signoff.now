/**
 * RightSidebar — right panel with Changes and Files tabs.
 *
 * Matches superset's RightSidebar pattern:
 * - Tab header: Changes | Files toggle buttons
 * - Expand/Collapse and Close buttons
 * - ChangesView and FilesView content panels
 */

import { Button } from "@signoff/ui/button";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";
import { File, GitCompareArrows, Maximize2, Minimize2, X } from "lucide-react";
import { useCallback } from "react";
import { trpc } from "../../lib/trpc";
import { useActiveWorkspaceStore } from "../../stores/active-workspace";
import {
	RightSidebarTab,
	SidebarMode,
	useSidebarStore,
} from "../../stores/sidebar-state";
import { useTabsStore } from "../../stores/tabs";
import { TabType } from "../../stores/tabs/types";
import { LiveFileExplorer } from "../FileExplorer/FileExplorer";

function TabButton({
	isActive,
	onClick,
	icon,
	label,
	compact,
}: {
	isActive: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	compact?: boolean;
}) {
	if (compact) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={onClick}
						className={cn(
							"flex items-center justify-center shrink-0 h-full w-10 transition-all",
							isActive
								? "text-foreground bg-border/30"
								: "text-muted-foreground/70 hover:text-muted-foreground hover:bg-tertiary/20",
						)}
					>
						{icon}
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-2 shrink-0 px-3 h-full transition-all text-sm",
				isActive
					? "text-foreground bg-border/30"
					: "text-muted-foreground/70 hover:text-muted-foreground hover:bg-tertiary/20",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

export function RightSidebar() {
	const _activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);
	const currentMode = useSidebarStore((s) => s.currentMode);
	const rightSidebarTab = useSidebarStore((s) => s.rightSidebarTab);
	const setRightSidebarTab = useSidebarStore((s) => s.setRightSidebarTab);
	const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);
	const setMode = useSidebarStore((s) => s.setMode);
	const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
	const isExpanded = currentMode === SidebarMode.Changes;
	const compactTabs = sidebarWidth < 250;

	const handleExpandToggle = () => {
		setMode(isExpanded ? SidebarMode.Tabs : SidebarMode.Changes);
	};

	return (
		<aside className="h-full flex flex-col overflow-hidden">
			{/* Tab header */}
			<div className="flex items-center bg-background shrink-0 h-10 border-b">
				<div className="flex items-center h-full">
					<TabButton
						isActive={rightSidebarTab === RightSidebarTab.Changes}
						onClick={() => setRightSidebarTab(RightSidebarTab.Changes)}
						icon={<GitCompareArrows className="size-3.5" />}
						label="Changes"
						compact={compactTabs}
					/>
					<TabButton
						isActive={rightSidebarTab === RightSidebarTab.Files}
						onClick={() => setRightSidebarTab(RightSidebarTab.Files)}
						icon={<File className="size-3.5" />}
						label="Files"
						compact={compactTabs}
					/>
				</div>
				<div className="flex-1" />
				<div className="flex items-center h-10 pr-2 gap-0.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleExpandToggle}
								className="size-6 p-0"
							>
								{isExpanded ? (
									<Minimize2 className="size-3.5" />
								) : (
									<Maximize2 className="size-3.5" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							{isExpanded ? "Collapse sidebar" : "Expand sidebar"}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleSidebar}
								className="size-6 p-0"
							>
								<X className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Close sidebar</TooltipContent>
					</Tooltip>
				</div>
			</div>

			{/* Changes tab content */}
			<div
				className={
					rightSidebarTab === RightSidebarTab.Changes
						? "flex-1 min-h-0 flex flex-col overflow-hidden"
						: "hidden"
				}
			>
				<ChangesPanel />
			</div>

			{/* Files tab content */}
			<div
				className={
					rightSidebarTab === RightSidebarTab.Files
						? "flex-1 min-h-0 flex flex-col overflow-hidden"
						: "hidden"
				}
			>
				<FilesPanel />
			</div>
		</aside>
	);
}

/** Changes panel — shows git changes for the active workspace. */
function ChangesPanel() {
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);

	if (!activeWorkspace) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<span className="text-center text-xs text-muted-foreground">
					Select a workspace to see changes
				</span>
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
			<div className="flex-1 flex items-center justify-center">
				<span className="text-xs text-muted-foreground">Loading changes…</span>
			</div>
		);
	}

	if (!data?.files?.length) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<span className="text-xs text-muted-foreground">No changes</span>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1">
			<div className="flex flex-col gap-0.5 p-2">
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
		</ScrollArea>
	);
}

/** Files panel — shows file explorer for the active workspace. */
function FilesPanel() {
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);
	const { addTab, addPane, panes } = useTabsStore();

	const handleFileSelect = useCallback(
		(relativePath: string) => {
			if (!activeWorkspace) return;
			const fileName = relativePath.split("/").pop() ?? relativePath;
			const tab = {
				id: `editor-${relativePath}-${Date.now()}`,
				label: fileName,
				type: TabType.Editor,
				isDirty: false,
				data: {
					workspacePath: activeWorkspace.workspacePath,
					filePath: relativePath,
				},
			};
			const paneIds = Object.keys(panes);
			if (paneIds.length > 0) {
				addTab(paneIds[0], tab);
			} else {
				addPane(tab);
			}
		},
		[activeWorkspace, addTab, addPane, panes],
	);

	if (!activeWorkspace) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<span className="text-center text-xs text-muted-foreground">
					Select a workspace to browse files
				</span>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1">
			<div className="p-2">
				<LiveFileExplorer
					workspacePath={activeWorkspace.workspacePath}
					onFileSelect={handleFileSelect}
				/>
			</div>
		</ScrollArea>
	);
}
