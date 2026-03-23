/**
 * Active workspace store — tracks which workspace and project are currently selected.
 *
 * Drives the main content area: file explorer, editor tabs, terminal sessions.
 * Persists the active workspace ID to the server via tRPC on change.
 *
 * Also tracks:
 * - activeProjectId: which project's dashboard to show (set on project click)
 * - expandedProjectId: which project's workspace subtree is expanded in the sidebar
 *   (lifted from component-local useState for cross-component visibility)
 */

import { create } from "zustand";

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
	/** Which project's workspace subtree is expanded in the sidebar. */
	expandedProjectId: string | null;
	/** Set the active workspace. */
	setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
	/** Set the active project for dashboard display. */
	setActiveProjectId: (id: string | null) => void;
	/** Set the expanded project in the sidebar tree. */
	setExpandedProjectId: (id: string | null) => void;
	/** Reset store to initial state (for tests). */
	reset: () => void;
}

export const useActiveWorkspaceStore = create<ActiveWorkspaceState>((set) => ({
	activeWorkspace: null,
	activeProjectId: null,
	expandedProjectId: null,
	setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
	setActiveProjectId: (id) => set({ activeProjectId: id }),
	setExpandedProjectId: (id) => set({ expandedProjectId: id }),
	reset: () =>
		set({
			activeWorkspace: null,
			activeProjectId: null,
			expandedProjectId: null,
		}),
}));
