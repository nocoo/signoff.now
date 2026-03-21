/**
 * Tab and pane types for the mosaic layout.
 *
 * Each pane in the mosaic tree holds an ordered list of tabs.
 * A tab represents a content view (terminal, editor, diff, etc.).
 */

import type { MosaicNode } from "react-mosaic-component";

/** Discriminated union of tab content types. */
export enum TabType {
	Terminal = "terminal",
	Editor = "editor",
	Diff = "diff",
	Welcome = "welcome",
}

/** A single tab within a pane. */
export interface Tab {
	/** Unique tab ID (uuid). */
	id: string;
	/** Display label for the tab bar. */
	label: string;
	/** Content type determines what renders in the tab body. */
	type: TabType;
	/** Whether the tab has unsaved changes. */
	isDirty: boolean;
	/**
	 * Opaque payload specific to the tab type.
	 * E.g. { filePath } for editor, { sessionId } for terminal.
	 */
	data?: Record<string, unknown>;
}

/** State of a single pane in the mosaic grid. */
export interface PaneState {
	/** Ordered list of tabs in this pane. */
	tabs: Tab[];
	/** ID of the currently active tab (must be in tabs[]). */
	activeTabId: string | null;
}

/** Pane ID used as MosaicKey — a string like "pane-1". */
export type PaneId = string;

/** The mosaic layout tree using pane IDs as keys. */
export type MosaicLayout = MosaicNode<PaneId> | null;
