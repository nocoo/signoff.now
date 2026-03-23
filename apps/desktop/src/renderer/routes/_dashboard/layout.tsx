/**
 * Dashboard layout — the main app shell.
 *
 * Top bar + two-column layout:
 * 0. TopBar — drag handle, sidebar toggle, window controls
 * 1. Project sidebar (left) — project list with dashboard pages, collapsible to 52px
 * 2. Outlet (right) — workspace page (mosaic + right sidebar)
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ResizablePanel } from "../../components/ResizablePanel";
import { WorkspaceSidebar } from "../../components/Sidebar/WorkspaceSidebar";
import { TopBar } from "../../components/TopBar";
import {
	COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
	DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
	MAX_WORKSPACE_SIDEBAR_WIDTH,
	useWorkspaceSidebarStore,
} from "../../stores/workspace-sidebar-state";

export const Route = createFileRoute("/_dashboard")({
	component: DashboardLayout,
});

function DashboardLayout() {
	const {
		isOpen: isWorkspaceSidebarOpen,
		width: workspaceSidebarWidth,
		setWidth: setWorkspaceSidebarWidth,
		isResizing: isWorkspaceSidebarResizing,
		setIsResizing: setWorkspaceSidebarIsResizing,
		isCollapsed: isWorkspaceSidebarCollapsed,
	} = useWorkspaceSidebarStore();

	return (
		<div className="flex flex-col h-full w-full">
			<TopBar />
			<div className="flex flex-1 overflow-hidden">
				{isWorkspaceSidebarOpen === true && (
					<ResizablePanel
						width={workspaceSidebarWidth}
						onWidthChange={setWorkspaceSidebarWidth}
						isResizing={isWorkspaceSidebarResizing}
						onResizingChange={setWorkspaceSidebarIsResizing}
						minWidth={COLLAPSED_WORKSPACE_SIDEBAR_WIDTH}
						maxWidth={MAX_WORKSPACE_SIDEBAR_WIDTH}
						handleSide="right"
						clampWidth={false}
						onDoubleClickHandle={() =>
							setWorkspaceSidebarWidth(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
						}
					>
						<WorkspaceSidebar isCollapsed={isWorkspaceSidebarCollapsed()} />
					</ResizablePanel>
				)}
				<Outlet />
			</div>
		</div>
	);
}
