/**
 * SidebarToggle — button to collapse/expand the workspace sidebar.
 */

import { Button } from "@signoff/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { PanelLeft } from "lucide-react";
import { useWorkspaceSidebarStore } from "../../stores/workspace-sidebar-state";

export function SidebarToggle() {
	const toggleOpen = useWorkspaceSidebarStore((s) => s.toggleOpen);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground"
					onClick={toggleOpen}
				>
					<PanelLeft className="h-4 w-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
		</Tooltip>
	);
}
