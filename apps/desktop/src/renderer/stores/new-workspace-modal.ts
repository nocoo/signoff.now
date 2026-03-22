/**
 * New workspace modal store — manages open/close state and pre-selected project.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface NewWorkspaceModalState {
	/** Whether the modal is currently open. */
	isOpen: boolean;
	/** Pre-filled project ID when opening from a project context. */
	preselectedProjectId: string | null;

	/** Open the modal, optionally pre-selecting a project. */
	open: (projectId?: string) => void;
	/** Close the modal and clear state. */
	close: () => void;
}

export const useNewWorkspaceModalStore = create<NewWorkspaceModalState>()(
	devtools(
		(set) => ({
			isOpen: false,
			preselectedProjectId: null,

			open: (projectId) =>
				set({
					isOpen: true,
					preselectedProjectId: projectId ?? null,
				}),

			close: () => set({ isOpen: false, preselectedProjectId: null }),
		}),
		{ name: "NewWorkspaceModalStore" },
	),
);
