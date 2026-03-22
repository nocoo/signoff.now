/**
 * Dashboard layout — the main app shell.
 *
 * Top bar + three-column layout:
 * 0. TopBar — drag handle, sidebar toggle, window controls
 * 1. Workspace sidebar (left) — project/workspace list, collapsible to 52px
 * 2. Content sidebar (middle-left) — tabs/changes mode, resizable 200-500px
 * 3. Main content area (right) — where the active workspace content renders
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NewWorkspaceModal } from "../../components/NewWorkspaceModal";
import { ContentSidebar } from "../../components/Sidebar/ContentSidebar";
import { WorkspaceSidebar } from "../../components/Sidebar/WorkspaceSidebar";
import { TopBar } from "../../components/TopBar";

export const Route = createFileRoute("/_dashboard")({
	component: DashboardLayout,
});

function DashboardLayout() {
	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<TopBar />

			<div className="flex flex-1 overflow-hidden">
				{/* Left: workspace/project list */}
				<WorkspaceSidebar />

				{/* Middle-left: tabs/changes sidebar */}
				<ContentSidebar />

				{/* Main content area */}
				<main className="flex flex-1 flex-col overflow-hidden">
					<Outlet />
				</main>
			</div>

			<NewWorkspaceModal />
		</div>
	);
}
