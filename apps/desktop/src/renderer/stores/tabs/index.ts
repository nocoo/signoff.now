/**
 * Tabs store — Zustand store for mosaic layout pane/tab management.
 *
 * Manages:
 * - Mosaic layout tree (react-mosaic-component MosaicNode)
 * - Per-pane tab lists with active tab tracking
 * - Pane splitting, tab reordering, cross-pane tab moves
 * - Focused pane tracking
 */

import type {
	MosaicDirection,
	MosaicNode,
	MosaicParent,
} from "react-mosaic-component";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MosaicLayout, PaneId, PaneState, Tab } from "./types";

let paneCounter = 0;
function nextPaneId(): PaneId {
	paneCounter += 1;
	return `pane-${paneCounter}`;
}

/** Recursively remove a leaf from the mosaic tree. */
function removeLeaf(
	node: MosaicNode<PaneId>,
	leafId: PaneId,
): MosaicNode<PaneId> | null {
	if (typeof node === "string") {
		return node === leafId ? null : node;
	}

	const parent = node as MosaicParent<PaneId>;
	const first = removeLeaf(parent.first, leafId);
	const second = removeLeaf(parent.second, leafId);

	if (first === null && second === null) return null;
	if (first === null) return second;
	if (second === null) return first;

	return { ...parent, first, second };
}

/** Replace a leaf node in the mosaic tree with a new node. */
function replaceLeaf(
	node: MosaicNode<PaneId>,
	leafId: PaneId,
	replacement: MosaicNode<PaneId>,
): MosaicNode<PaneId> {
	if (typeof node === "string") {
		return node === leafId ? replacement : node;
	}

	const parent = node as MosaicParent<PaneId>;
	return {
		...parent,
		first: replaceLeaf(parent.first, leafId, replacement),
		second: replaceLeaf(parent.second, leafId, replacement),
	};
}

interface TabsState {
	/** Per-pane state keyed by pane ID. */
	panes: Record<PaneId, PaneState>;
	/** Mosaic layout tree. null when no panes exist. */
	layout: MosaicLayout;
	/** Currently focused pane. */
	focusedPaneId: PaneId | null;

	// ── Pane actions ─────────────────────────────────────────
	/** Add a new pane with an initial tab. */
	addPane: (initialTab: Tab) => PaneId;
	/** Remove a pane and clean up layout. */
	removePane: (paneId: PaneId) => void;
	/** Split an existing pane, creating a sibling with a new tab. */
	splitPane: (
		paneId: PaneId,
		direction: MosaicDirection,
		newTab: Tab,
	) => PaneId;
	/** Set the mosaic layout tree directly (for drag-resize). */
	setLayout: (layout: MosaicLayout) => void;
	/** Set focused pane. */
	setFocusedPane: (paneId: PaneId | null) => void;

	// ── Tab actions ──────────────────────────────────────────
	/** Add a tab to a pane (becomes active). */
	addTab: (paneId: PaneId, tab: Tab) => void;
	/** Remove a tab from a pane. */
	removeTab: (paneId: PaneId, tabId: string) => void;
	/** Set the active tab in a pane. */
	setActiveTab: (paneId: PaneId, tabId: string) => void;
	/** Partially update a tab's properties. */
	updateTab: (paneId: PaneId, tabId: string, updates: Partial<Tab>) => void;
	/** Reorder tabs within a pane. */
	reorderTabs: (paneId: PaneId, fromIndex: number, toIndex: number) => void;
	/** Move a tab from one pane to another. */
	moveTabToPane: (srcPaneId: PaneId, tabId: string, dstPaneId: PaneId) => void;

	/** Reset store to initial state (for tests). */
	reset: () => void;
}

const initialState = {
	panes: {} as Record<PaneId, PaneState>,
	layout: null as MosaicLayout,
	focusedPaneId: null as PaneId | null,
};

export const useTabsStore = create<TabsState>()(
	devtools(
		(set, get) => ({
			...initialState,

			addPane(initialTab: Tab): PaneId {
				const paneId = nextPaneId();
				const pane: PaneState = {
					tabs: [initialTab],
					activeTabId: initialTab.id,
				};

				set((state) => {
					const newPanes = { ...state.panes, [paneId]: pane };
					let newLayout: MosaicLayout;

					if (state.layout === null) {
						newLayout = paneId;
					} else {
						newLayout = {
							direction: "row",
							first: state.layout,
							second: paneId,
							splitPercentage: 50,
						};
					}

					return { panes: newPanes, layout: newLayout };
				});

				return paneId;
			},

			removePane(paneId: PaneId): void {
				set((state) => {
					const { [paneId]: _removed, ...remainingPanes } = state.panes;
					let newLayout: MosaicLayout = null;

					if (state.layout !== null) {
						const result = removeLeaf(state.layout, paneId);
						newLayout = result ?? null;
					}

					const newFocusedPaneId =
						state.focusedPaneId === paneId ? null : state.focusedPaneId;

					return {
						panes: remainingPanes,
						layout: newLayout,
						focusedPaneId: newFocusedPaneId,
					};
				});
			},

			splitPane(
				paneId: PaneId,
				direction: MosaicDirection,
				newTab: Tab,
			): PaneId {
				const newPaneId = nextPaneId();
				const newPane: PaneState = {
					tabs: [newTab],
					activeTabId: newTab.id,
				};

				set((state) => {
					const newPanes = { ...state.panes, [newPaneId]: newPane };
					const splitNode: MosaicParent<PaneId> = {
						direction,
						first: paneId,
						second: newPaneId,
						splitPercentage: 50,
					};

					let newLayout: MosaicLayout;
					if (state.layout === null || state.layout === paneId) {
						newLayout = splitNode;
					} else {
						newLayout = replaceLeaf(state.layout, paneId, splitNode);
					}

					return { panes: newPanes, layout: newLayout };
				});

				return newPaneId;
			},

			setLayout(layout: MosaicLayout): void {
				set({ layout });
			},

			setFocusedPane(paneId: PaneId | null): void {
				set({ focusedPaneId: paneId });
			},

			addTab(paneId: PaneId, tab: Tab): void {
				set((state) => {
					const pane = state.panes[paneId];
					if (!pane) return state;
					return {
						panes: {
							...state.panes,
							[paneId]: {
								...pane,
								tabs: [...pane.tabs, tab],
								activeTabId: tab.id,
							},
						},
					};
				});
			},

			removeTab(paneId: PaneId, tabId: string): void {
				const state = get();
				const pane = state.panes[paneId];
				if (!pane) return;

				const newTabs = pane.tabs.filter((t) => t.id !== tabId);

				if (newTabs.length === 0) {
					// Remove the whole pane
					get().removePane(paneId);
					return;
				}

				let newActiveTabId = pane.activeTabId;
				if (pane.activeTabId === tabId) {
					// Find the tab that was removed
					const removedIndex = pane.tabs.findIndex((t) => t.id === tabId);
					// Prefer the tab at the same index, or the last tab
					const nextIndex = Math.min(removedIndex, newTabs.length - 1);
					newActiveTabId = newTabs[nextIndex].id;
				}

				set((current) => ({
					panes: {
						...current.panes,
						[paneId]: {
							...current.panes[paneId],
							tabs: newTabs,
							activeTabId: newActiveTabId,
						},
					},
				}));
			},

			setActiveTab(paneId: PaneId, tabId: string): void {
				set((state) => {
					const pane = state.panes[paneId];
					if (!pane) return state;
					return {
						panes: {
							...state.panes,
							[paneId]: { ...pane, activeTabId: tabId },
						},
					};
				});
			},

			updateTab(paneId: PaneId, tabId: string, updates: Partial<Tab>): void {
				set((state) => {
					const pane = state.panes[paneId];
					if (!pane) return state;
					return {
						panes: {
							...state.panes,
							[paneId]: {
								...pane,
								tabs: pane.tabs.map((t) =>
									t.id === tabId ? { ...t, ...updates } : t,
								),
							},
						},
					};
				});
			},

			reorderTabs(paneId: PaneId, fromIndex: number, toIndex: number): void {
				set((state) => {
					const pane = state.panes[paneId];
					if (!pane) return state;

					const tabs = [...pane.tabs];
					const [moved] = tabs.splice(fromIndex, 1);
					tabs.splice(toIndex, 0, moved);

					return {
						panes: {
							...state.panes,
							[paneId]: { ...pane, tabs },
						},
					};
				});
			},

			moveTabToPane(srcPaneId: PaneId, tabId: string, dstPaneId: PaneId): void {
				const state = get();
				const srcPane = state.panes[srcPaneId];
				const dstPane = state.panes[dstPaneId];
				if (!srcPane || !dstPane) return;

				const tab = srcPane.tabs.find((t) => t.id === tabId);
				if (!tab) return;

				// Remove from source
				get().removeTab(srcPaneId, tabId);
				// Add to destination
				get().addTab(dstPaneId, tab);
			},

			reset(): void {
				paneCounter = 0;
				set({ ...initialState, panes: {} });
			},
		}),
		{ name: "tabs-store" },
	),
);

export type { MosaicLayout, PaneId, PaneState, Tab, TabType } from "./types";
