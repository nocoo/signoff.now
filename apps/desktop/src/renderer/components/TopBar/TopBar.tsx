/**
 * TopBar — app title bar with sidebar toggle and window controls.
 *
 * Height: h-12 (48px) matching superset reference.
 * Entire bar uses .drag class for window dragging.
 * Interactive children use .no-drag to remain clickable.
 */

import { trpc } from "../../lib/trpc";
import { SidebarToggle } from "./SidebarToggle";
import { WindowControls } from "./WindowControls";

export function TopBar() {
	const { data: platformData } = trpc.config.getPlatform.useQuery();
	// Default to Mac layout while loading to avoid overlap with traffic lights
	const isMac =
		platformData === undefined || platformData?.platform === "darwin";

	return (
		<div className="drag gap-2 h-12 w-full flex items-center justify-between bg-muted/45 border-b border-border relative">
			{/* Left zone — sidebar toggle + future controls */}
			<div
				className="flex items-center gap-1.5 h-full"
				style={{ paddingLeft: isMac ? "88px" : "16px" }}
			>
				<SidebarToggle />
			</div>

			{/* Center zone — placeholder for search bar */}
			<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
				{/* SearchBarTrigger will go here */}
			</div>

			{/* Right zone — window controls + future buttons */}
			<div className="flex items-center gap-3 h-full pr-4 shrink-0">
				{!isMac && <WindowControls />}
			</div>
		</div>
	);
}
