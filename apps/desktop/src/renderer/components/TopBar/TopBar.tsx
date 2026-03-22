/**
 * TopBar — app title bar with sidebar toggle and window controls.
 *
 * Height: h-10 (40px) matching --app-region-height.
 * Entire bar uses .drag class for window dragging.
 * Interactive children use .no-drag to remain clickable.
 */

import { trpc } from "../../lib/trpc";
import { SidebarToggle } from "./SidebarToggle";
import { WindowControls } from "./WindowControls";

export function TopBar() {
	const { data: platformData } = trpc.config.getPlatform.useQuery();
	const isMac = platformData?.platform === "darwin";

	return (
		<div className="drag flex h-10 shrink-0 items-center border-b border-border bg-sidebar">
			{/* macOS traffic light padding — hiddenInset places lights at x:15 */}
			{isMac && <div className="w-[70px] shrink-0" />}

			<div className="no-drag flex items-center px-2">
				<SidebarToggle />
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Window controls — Windows/Linux only */}
			{!isMac && (
				<div className="no-drag">
					<WindowControls />
				</div>
			)}
		</div>
	);
}
