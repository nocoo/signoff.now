/**
 * Tests for the new-workspace-modal Zustand store.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { useNewWorkspaceModalStore } from "./new-workspace-modal";

describe("useNewWorkspaceModalStore", () => {
	afterEach(() => {
		// Reset store between tests
		useNewWorkspaceModalStore.getState().close();
	});

	test("starts closed with no preselection", () => {
		const state = useNewWorkspaceModalStore.getState();
		expect(state.isOpen).toBe(false);
		expect(state.preselectedProjectId).toBeNull();
	});

	test("open() sets isOpen true", () => {
		useNewWorkspaceModalStore.getState().open();
		const state = useNewWorkspaceModalStore.getState();
		expect(state.isOpen).toBe(true);
		expect(state.preselectedProjectId).toBeNull();
	});

	test("open(projectId) pre-selects the project", () => {
		useNewWorkspaceModalStore.getState().open("proj-123");
		const state = useNewWorkspaceModalStore.getState();
		expect(state.isOpen).toBe(true);
		expect(state.preselectedProjectId).toBe("proj-123");
	});

	test("close() resets to initial state", () => {
		useNewWorkspaceModalStore.getState().open("proj-123");
		useNewWorkspaceModalStore.getState().close();
		const state = useNewWorkspaceModalStore.getState();
		expect(state.isOpen).toBe(false);
		expect(state.preselectedProjectId).toBeNull();
	});
});
