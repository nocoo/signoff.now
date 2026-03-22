/**
 * TabBar — horizontal tab strip for a mosaic pane.
 *
 * Renders a list of tabs with:
 * - Click to activate
 * - Close button per tab
 * - Dirty indicator
 * - DnD-kit sortable for reordering (future)
 */

import { FileText, Terminal, X } from "lucide-react";
import { useTabsStore } from "../../stores/tabs";
import type { PaneId, Tab } from "../../stores/tabs/types";
import { TabType } from "../../stores/tabs/types";

function TabIcon({ type }: { type: TabType }) {
	switch (type) {
		case TabType.Terminal:
			return <Terminal className="h-3.5 w-3.5" />;
		default:
			return <FileText className="h-3.5 w-3.5" />;
	}
}

export function TabBar({
	paneId,
	tabs,
	activeTabId,
}: {
	paneId: PaneId;
	tabs: Tab[];
	activeTabId: string | null;
}) {
	const { setActiveTab, removeTab } = useTabsStore();

	return (
		<div className="flex h-8 items-center gap-0 overflow-x-auto border-b border-border bg-sidebar">
			{tabs.map((tab) => {
				const isActive = tab.id === activeTabId;
				return (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(paneId, tab.id)}
						className={`group flex h-full items-center gap-1.5 border-r border-border px-3 text-xs ${
							isActive
								? "bg-background text-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
						}`}
					>
						<TabIcon type={tab.type} />
						<span className="max-w-[120px] truncate">
							{tab.label}
							{tab.isDirty && <span className="ml-0.5 text-amber-500">●</span>}
						</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								removeTab(paneId, tab.id);
							}}
							className="ml-1 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
						>
							<X className="h-3 w-3" />
						</button>
					</button>
				);
			})}
		</div>
	);
}
