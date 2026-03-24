/**
 * WorkspaceLayout — wraps content area + right sidebar.
 *
 * Matches superset's WorkspaceLayout pattern:
 * - Content area (flex-1) with MosaicLayout
 * - Right sidebar with ResizablePanel (handleSide="left")
 */

import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	useSidebarStore,
} from "../../stores/sidebar-state";
import { MosaicLayout } from "../MosaicLayout";
import { ResizablePanel } from "../ResizablePanel";
import { RightSidebar } from "./RightSidebar";

export function WorkspaceLayout() {
	const isSidebarOpen = useSidebarStore((s) => s.isSidebarOpen);
	const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
	const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth);
	const isResizing = useSidebarStore((s) => s.isResizing);
	const setIsResizing = useSidebarStore((s) => s.setIsResizing);

	return (
		<div className="flex min-w-0 flex-1 h-full overflow-hidden">
			{/* Main content area */}
			<div className="flex-1 min-w-0 overflow-hidden">
				<MosaicLayout />
			</div>

			{/* Right sidebar — files and changes */}
			{isSidebarOpen && (
				<ResizablePanel
					width={sidebarWidth}
					onWidthChange={setSidebarWidth}
					isResizing={isResizing}
					onResizingChange={setIsResizing}
					minWidth={MIN_SIDEBAR_WIDTH}
					maxWidth={MAX_SIDEBAR_WIDTH}
					handleSide="left"
					onDoubleClickHandle={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
				>
					<RightSidebar />
				</ResizablePanel>
			)}
		</div>
	);
}
