/**
 * Active workspace store — tracks which workspace is currently selected.
 *
 * Drives the main content area: file explorer, editor tabs, terminal sessions.
 * Persists the active workspace ID to the server via tRPC on change.
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
	/** Set the active workspace. */
	setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
	/** Reset store to initial state (for tests). */
	reset: () => void;
}

export const useActiveWorkspaceStore = create<ActiveWorkspaceState>((set) => ({
	activeWorkspace: null,
	setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
	reset: () => set({ activeWorkspace: null }),
}));
