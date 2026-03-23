/**
 * SidebarToggle — button to collapse/expand the workspace sidebar.
 *
 * Uses toggleCollapsed to switch between:
 * - Expanded view (220-400px) with project/workspace tree
 * - Collapsed icon-only view (52px)
 *
 * This is preferred over toggleOpen (which hides sidebar completely)
 * because it keeps the sidebar accessible and consistent with the
 * internal collapse button in WorkspaceSidebar.
 */

import { Button } from "@signoff/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { PanelLeft } from "lucide-react";
import { useWorkspaceSidebarStore } from "../../stores/workspace-sidebar-state";

export function SidebarToggle() {
	const toggleCollapsed = useWorkspaceSidebarStore((s) => s.toggleCollapsed);
	const isCollapsed = useWorkspaceSidebarStore((s) => s.isCollapsed());

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground"
					onClick={toggleCollapsed}
					data-testid="sidebar-toggle-btn"
				>
					<PanelLeft className="h-4 w-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
			</TooltipContent>
		</Tooltip>
	);
}
