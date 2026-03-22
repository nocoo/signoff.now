/**
 * MosaicLayout — tiling window manager for the main content area.
 *
 * Uses react-mosaic-component to render a tree of resizable panes,
 * each containing a TabBar and the active tab's content.
 *
 * Integrates with the tabs Zustand store for state management.
 */

import type { MosaicBranch } from "react-mosaic-component";
import { Mosaic, MosaicWindow } from "react-mosaic-component";
import { useTabsStore } from "../../stores/tabs";
import type { PaneId } from "../../stores/tabs/types";
import { PaneContent } from "./PaneContent";
import { TabBar } from "./TabBar";

import "react-mosaic-component/react-mosaic-component.css";
import "./mosaic-theme.css";

function PaneTile({ paneId }: { paneId: PaneId }) {
	const pane = useTabsStore((s) => s.panes[paneId]);
	const setFocusedPane = useTabsStore((s) => s.setFocusedPane);

	if (!pane) return null;

	const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pane focus tracking requires mouse/focus events on container
		<div
			className="flex h-full flex-col"
			onFocus={() => setFocusedPane(paneId)}
			onMouseDown={() => setFocusedPane(paneId)}
		>
			<TabBar paneId={paneId} tabs={pane.tabs} activeTabId={pane.activeTabId} />
			<div className="flex-1 overflow-auto">
				<PaneContent tab={activeTab} />
			</div>
		</div>
	);
}

export function MosaicLayout() {
	const layout = useTabsStore((s) => s.layout);
	const setLayout = useTabsStore((s) => s.setLayout);

	if (layout === null) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">No open panes</p>
			</div>
		);
	}

	return (
		<Mosaic<PaneId>
			renderTile={(id: PaneId, path: MosaicBranch[]) => (
				<MosaicWindow<PaneId>
					path={path}
					title=""
					toolbarControls={<span />}
					renderPreview={() => <div className="bg-primary/10" />}
				>
					<PaneTile paneId={id} />
				</MosaicWindow>
			)}
			value={layout}
			onChange={(newLayout) => setLayout(newLayout ?? null)}
			resize="DISABLED"
			className={
				document.documentElement.classList.contains("light")
					? "mosaic-theme-light"
					: "mosaic-theme-dark"
			}
		/>
	);
}
