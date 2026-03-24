/**
 * Active workspace store — tracks which workspace, project, and dashboard page
 * are currently selected.
 *
 * Drives the main content area: file explorer, editor tabs, terminal sessions.
 * Persists the active workspace ID to the server via tRPC on change.
 *
 * Also tracks:
 * - activeProjectId: which project's dashboard to show (set on project click)
 * - activePageId: which dashboard page to render (set on page click in sidebar)
 * - expandedProjectId: which project's page subtree is expanded in the sidebar
 *   (lifted from component-local useState for cross-component visibility)
 */

import { create } from "zustand";

/** Dashboard page identifiers for the sidebar page list. */
export type DashboardPage =
	| "overview"
	| "contributors"
	| "activity"
	| "branches"
	| "files"
	| "tags"
	| "pull-requests";

export interface ActiveWorkspace {
	/** Workspace ID (from DB). */
	id: string;
	/** Parent project ID. */
	projectId: string;
	/** Absolute path to the project's main repository. */
	workspacePath: string;
	/** Git branch name. */
	branch: string;
	/** Display name. */
	name: string;
}

interface ActiveWorkspaceState {
	/** Currently active workspace, or null if none selected. */
	activeWorkspace: ActiveWorkspace | null;
	/** Which project's dashboard to show (independent of workspace). */
	activeProjectId: string | null;
	/** Which dashboard page to render in the main content area. */
	activePageId: DashboardPage;
	/** Which project's page subtree is expanded in the sidebar. */
	expandedProjectId: string | null;
	/** Set the active workspace. */
	setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
	/** Set the active project for dashboard display. Resets page to overview. */
	setActiveProjectId: (id: string | null) => void;
	/** Set the active dashboard page. */
	setActivePageId: (page: DashboardPage) => void;
	/** Set the expanded project in the sidebar tree. */
	setExpandedProjectId: (id: string | null) => void;
	/** Reset store to initial state (for tests). */
	reset: () => void;
}

export const useActiveWorkspaceStore = create<ActiveWorkspaceState>((set) => ({
	activeWorkspace: null,
	activeProjectId: null,
	activePageId: "overview",
	expandedProjectId: null,
	setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
	setActiveProjectId: (id) =>
		set({ activeProjectId: id, activePageId: "overview" }),
	setActivePageId: (page) => set({ activePageId: page }),
	setExpandedProjectId: (id) => set({ expandedProjectId: id }),
	reset: () =>
		set({
			activeWorkspace: null,
			activeProjectId: null,
			activePageId: "overview",
			expandedProjectId: null,
		}),
}));
