/**
 * Tests for the changes Zustand store.
 *
 * TDD: written before implementation.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { useChangesStore } from "./index";

afterEach(() => {
	useChangesStore.getState().reset();
});

describe("changes store", () => {
	it("starts with empty state", () => {
		const state = useChangesStore.getState();
		expect(state.files).toHaveLength(0);
		expect(state.branch).toBeNull();
		expect(state.isLoading).toBe(false);
		expect(state.selectedFilePath).toBeNull();
	});

	it("setFiles updates file list", () => {
		useChangesStore.getState().setFiles([
			{ path: "src/index.ts", status: "modified", staged: true },
			{ path: "src/new.ts", status: "untracked", staged: false },
		]);

		const { files } = useChangesStore.getState();
		expect(files).toHaveLength(2);
		expect(files[0].path).toBe("src/index.ts");
		expect(files[1].staged).toBe(false);
	});

	it("setBranch updates branch info", () => {
		useChangesStore.getState().setBranch("feature/test");
		expect(useChangesStore.getState().branch).toBe("feature/test");
	});

	it("setLoading toggles loading state", () => {
		useChangesStore.getState().setLoading(true);
		expect(useChangesStore.getState().isLoading).toBe(true);
		useChangesStore.getState().setLoading(false);
		expect(useChangesStore.getState().isLoading).toBe(false);
	});

	it("selectFile sets selected file path", () => {
		useChangesStore.getState().selectFile("src/index.ts");
		expect(useChangesStore.getState().selectedFilePath).toBe("src/index.ts");
	});

	it("selectFile with null clears selection", () => {
		useChangesStore.getState().selectFile("src/index.ts");
		useChangesStore.getState().selectFile(null);
		expect(useChangesStore.getState().selectedFilePath).toBeNull();
	});

	it("setDiff stores diff text for a file", () => {
		useChangesStore.getState().setDiff("src/index.ts", "diff text...");
		expect(useChangesStore.getState().diffs["src/index.ts"]).toBe(
			"diff text...",
		);
	});

	it("clearDiffs removes all cached diffs", () => {
		useChangesStore.getState().setDiff("a.ts", "diff a");
		useChangesStore.getState().setDiff("b.ts", "diff b");
		useChangesStore.getState().clearDiffs();
		expect(Object.keys(useChangesStore.getState().diffs)).toHaveLength(0);
	});

	it("stagedFiles getter returns only staged files", () => {
		useChangesStore.getState().setFiles([
			{ path: "staged.ts", status: "modified", staged: true },
			{ path: "unstaged.ts", status: "modified", staged: false },
			{ path: "new.ts", status: "untracked", staged: false },
		]);

		const staged = useChangesStore.getState().getStagedFiles();
		expect(staged).toHaveLength(1);
		expect(staged[0].path).toBe("staged.ts");
	});

	it("unstagedFiles getter returns only unstaged changes", () => {
		useChangesStore.getState().setFiles([
			{ path: "staged.ts", status: "modified", staged: true },
			{ path: "unstaged.ts", status: "modified", staged: false },
			{ path: "new.ts", status: "untracked", staged: false },
		]);

		const unstaged = useChangesStore.getState().getUnstagedFiles();
		expect(unstaged).toHaveLength(2);
	});

	it("reset clears all state", () => {
		useChangesStore
			.getState()
			.setFiles([{ path: "a.ts", status: "modified", staged: true }]);
		useChangesStore.getState().setBranch("main");
		useChangesStore.getState().selectFile("a.ts");
		useChangesStore.getState().setDiff("a.ts", "diff...");

		useChangesStore.getState().reset();

		const state = useChangesStore.getState();
		expect(state.files).toHaveLength(0);
		expect(state.branch).toBeNull();
		expect(state.selectedFilePath).toBeNull();
		expect(Object.keys(state.diffs)).toHaveLength(0);
	});
});
