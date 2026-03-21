/**
 * Changes store — Zustand store for git changes state.
 *
 * Manages:
 * - List of changed files with staged/unstaged status
 * - Current branch info
 * - Selected file for diff viewing
 * - Cached diff text per file
 * - Loading state
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ChangedFile {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "untracked";
	staged: boolean;
}

interface ChangesState {
	/** List of changed files. */
	files: ChangedFile[];
	/** Current branch name. */
	branch: string | null;
	/** Whether a refresh is in progress. */
	isLoading: boolean;
	/** Currently selected file for diff viewing. */
	selectedFilePath: string | null;
	/** Cached diff text keyed by file path. */
	diffs: Record<string, string>;

	// Actions
	setFiles: (files: ChangedFile[]) => void;
	setBranch: (branch: string | null) => void;
	setLoading: (loading: boolean) => void;
	selectFile: (filePath: string | null) => void;
	setDiff: (filePath: string, diff: string) => void;
	clearDiffs: () => void;

	// Computed-like getters
	getStagedFiles: () => ChangedFile[];
	getUnstagedFiles: () => ChangedFile[];

	/** Reset to initial state. */
	reset: () => void;
}

const initialState = {
	files: [] as ChangedFile[],
	branch: null as string | null,
	isLoading: false,
	selectedFilePath: null as string | null,
	diffs: {} as Record<string, string>,
};

export const useChangesStore = create<ChangesState>()(
	devtools(
		(set, get) => ({
			...initialState,

			setFiles(files: ChangedFile[]) {
				set({ files });
			},

			setBranch(branch: string | null) {
				set({ branch });
			},

			setLoading(loading: boolean) {
				set({ isLoading: loading });
			},

			selectFile(filePath: string | null) {
				set({ selectedFilePath: filePath });
			},

			setDiff(filePath: string, diff: string) {
				set((state) => ({
					diffs: { ...state.diffs, [filePath]: diff },
				}));
			},

			clearDiffs() {
				set({ diffs: {} });
			},

			getStagedFiles() {
				return get().files.filter((f) => f.staged);
			},

			getUnstagedFiles() {
				return get().files.filter((f) => !f.staged);
			},

			reset() {
				set({ ...initialState, files: [], diffs: {} });
			},
		}),
		{ name: "changes-store" },
	),
);
