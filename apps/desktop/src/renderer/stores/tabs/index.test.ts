/**
 * Tests for the tabs/pane Zustand store.
 *
 * TDD: written before the store implementation.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { MosaicParent } from "react-mosaic-component";
import { useTabsStore } from "./index";
import type { PaneId, Tab } from "./types";
import { TabType } from "./types";

function makeTab(overrides: Partial<Tab> & { id: string }): Tab {
	return {
		label: "Test Tab",
		type: TabType.Welcome,
		isDirty: false,
		...overrides,
	};
}

/** Reset store between tests. */
afterEach(() => {
	useTabsStore.getState().reset();
});

// ─── Pane lifecycle ──────────────────────────────────────────────

describe("pane lifecycle", () => {
	it("starts with no panes and null layout", () => {
		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(0);
		expect(layout).toBeNull();
	});

	it("addPane creates a new pane with a tab and sets layout", () => {
		const tab = makeTab({ id: "t1", label: "Welcome" });
		useTabsStore.getState().addPane(tab);

		const { panes, layout } = useTabsStore.getState();
		const paneIds = Object.keys(panes);
		expect(paneIds).toHaveLength(1);

		const pane = panes[paneIds[0]];
		expect(pane.tabs).toHaveLength(1);
		expect(pane.tabs[0].id).toBe("t1");
		expect(pane.activeTabId).toBe("t1");
		// First pane: layout is just the pane id (leaf node)
		expect(layout).toBe(paneIds[0]);
	});

	it("addPane with two panes creates a mosaic parent node", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		useTabsStore.getState().addPane(tab2);

		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(2);
		// Layout should be a parent node with direction
		expect(layout).not.toBeNull();
		expect(typeof layout).toBe("object");
		const parent = layout as MosaicParent<PaneId>;
		expect(parent.direction).toBe("row");
		expect(parent.first).toBeDefined();
		expect(parent.second).toBeDefined();
	});

	it("removePane removes pane and updates layout", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		useTabsStore.getState().addPane(tab2);

		const paneIds = Object.keys(useTabsStore.getState().panes);
		useTabsStore.getState().removePane(paneIds[0]);

		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(1);
		// With one pane left, layout collapses to leaf
		expect(layout).toBe(paneIds[1]);
	});

	it("removePane last pane resets to null layout", () => {
		const tab = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(tab);

		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().removePane(paneId);

		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(0);
		expect(layout).toBeNull();
	});
});

// ─── Tab lifecycle ───────────────────────────────────────────────

describe("tab lifecycle", () => {
	it("addTab appends tab to specified pane", () => {
		const initial = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(initial);

		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		const newTab = makeTab({ id: "t2", label: "Second" });
		useTabsStore.getState().addTab(paneId, newTab);

		const pane = useTabsStore.getState().panes[paneId];
		expect(pane.tabs).toHaveLength(2);
		expect(pane.tabs[1].id).toBe("t2");
		// New tab becomes active
		expect(pane.activeTabId).toBe("t2");
	});

	it("removeTab removes tab from pane", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });
		useTabsStore.getState().addPane(tab1);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().addTab(paneId, tab2);

		useTabsStore.getState().removeTab(paneId, "t1");

		const pane = useTabsStore.getState().panes[paneId];
		expect(pane.tabs).toHaveLength(1);
		expect(pane.tabs[0].id).toBe("t2");
	});

	it("removeTab activates next tab when active tab is removed", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });
		const tab3 = makeTab({ id: "t3" });

		useTabsStore.getState().addPane(tab1);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().addTab(paneId, tab2);
		useTabsStore.getState().addTab(paneId, tab3);

		// Active is t3 (last added). Remove t3 → should activate t2
		useTabsStore.getState().removeTab(paneId, "t3");
		expect(useTabsStore.getState().panes[paneId].activeTabId).toBe("t2");
	});

	it("removeTab activates previous tab if last tab removed", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().addTab(paneId, tab2);

		// Active is t2. Remove t2 → should activate t1
		useTabsStore.getState().removeTab(paneId, "t2");
		expect(useTabsStore.getState().panes[paneId].activeTabId).toBe("t1");
	});

	it("removeTab removes pane when last tab is removed", () => {
		const tab = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];

		useTabsStore.getState().removeTab(paneId, "t1");

		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(0);
		expect(layout).toBeNull();
	});

	it("setActiveTab changes active tab in a pane", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().addTab(paneId, tab2);

		// Active is t2 (last added). Switch to t1
		useTabsStore.getState().setActiveTab(paneId, "t1");
		expect(useTabsStore.getState().panes[paneId].activeTabId).toBe("t1");
	});

	it("updateTab updates tab properties", () => {
		const tab = makeTab({ id: "t1", label: "Old" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];

		useTabsStore.getState().updateTab(paneId, "t1", {
			label: "New",
			isDirty: true,
		});

		const updated = useTabsStore.getState().panes[paneId].tabs[0];
		expect(updated.label).toBe("New");
		expect(updated.isDirty).toBe(true);
		// Type unchanged
		expect(updated.type).toBe(TabType.Welcome);
	});
});

// ─── Layout management ───────────────────────────────────────────

describe("layout management", () => {
	it("setLayout updates the mosaic layout tree", () => {
		useTabsStore.getState().setLayout("pane-1");
		expect(useTabsStore.getState().layout).toBe("pane-1");
	});

	it("splitPane creates two panes from one", () => {
		const tab = makeTab({ id: "t1", label: "Original" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];

		const newTab = makeTab({ id: "t2", label: "Split" });
		useTabsStore.getState().splitPane(paneId, "row", newTab);

		const { panes, layout } = useTabsStore.getState();
		expect(Object.keys(panes)).toHaveLength(2);

		const parent = layout as MosaicParent<PaneId>;
		expect(parent.direction).toBe("row");
		// Original pane should be first, new pane second
		expect(parent.first).toBe(paneId);
		expect(typeof parent.second).toBe("string");
		// New pane has the split tab
		const newPaneId = parent.second as PaneId;
		expect(panes[newPaneId].tabs[0].id).toBe("t2");
	});

	it("splitPane column direction", () => {
		const tab = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];

		const newTab = makeTab({ id: "t2" });
		useTabsStore.getState().splitPane(paneId, "column", newTab);

		const { layout } = useTabsStore.getState();
		const parent = layout as MosaicParent<PaneId>;
		expect(parent.direction).toBe("column");
	});
});

// ─── Tab reordering ──────────────────────────────────────────────

describe("tab reordering", () => {
	it("reorderTabs moves tab within same pane", () => {
		const tab1 = makeTab({ id: "t1", label: "First" });
		const tab2 = makeTab({ id: "t2", label: "Second" });
		const tab3 = makeTab({ id: "t3", label: "Third" });

		useTabsStore.getState().addPane(tab1);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().addTab(paneId, tab2);
		useTabsStore.getState().addTab(paneId, tab3);

		// Move first tab to last position
		useTabsStore.getState().reorderTabs(paneId, 0, 2);

		const tabs = useTabsStore.getState().panes[paneId].tabs;
		expect(tabs[0].id).toBe("t2");
		expect(tabs[1].id).toBe("t3");
		expect(tabs[2].id).toBe("t1");
	});

	it("moveTabToPane moves tab from one pane to another", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		useTabsStore.getState().addPane(tab2);

		const paneIds = Object.keys(useTabsStore.getState().panes);
		const [srcPane, dstPane] = paneIds;

		// Add extra tab so source pane doesn't auto-remove
		const extraTab = makeTab({ id: "t-extra" });
		useTabsStore.getState().addTab(srcPane, extraTab);

		useTabsStore.getState().moveTabToPane(srcPane, "t1", dstPane);

		expect(
			useTabsStore.getState().panes[srcPane].tabs.map((t) => t.id),
		).toEqual(["t-extra"]);
		expect(
			useTabsStore.getState().panes[dstPane].tabs.map((t) => t.id),
		).toEqual(["t2", "t1"]);
	});

	it("moveTabToPane removes source pane if it becomes empty", () => {
		const tab1 = makeTab({ id: "t1" });
		const tab2 = makeTab({ id: "t2" });

		useTabsStore.getState().addPane(tab1);
		useTabsStore.getState().addPane(tab2);

		const paneIds = Object.keys(useTabsStore.getState().panes);
		const [srcPane, dstPane] = paneIds;

		useTabsStore.getState().moveTabToPane(srcPane, "t1", dstPane);

		// Source pane should be removed
		expect(useTabsStore.getState().panes[srcPane]).toBeUndefined();
		expect(Object.keys(useTabsStore.getState().panes)).toHaveLength(1);
	});
});

// ─── Focused pane ────────────────────────────────────────────────

describe("focused pane", () => {
	it("tracks which pane is focused", () => {
		expect(useTabsStore.getState().focusedPaneId).toBeNull();

		const tab = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];

		useTabsStore.getState().setFocusedPane(paneId);
		expect(useTabsStore.getState().focusedPaneId).toBe(paneId);
	});

	it("clears focused pane when pane is removed", () => {
		const tab = makeTab({ id: "t1" });
		useTabsStore.getState().addPane(tab);
		const paneId = Object.keys(useTabsStore.getState().panes)[0];
		useTabsStore.getState().setFocusedPane(paneId);

		useTabsStore.getState().removePane(paneId);
		expect(useTabsStore.getState().focusedPaneId).toBeNull();
	});
});
