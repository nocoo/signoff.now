/**
 * Tests for the active workspace store.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	type ActiveWorkspace,
	useActiveWorkspaceStore,
} from "./active-workspace";

const MOCK_WORKSPACE: ActiveWorkspace = {
	id: "ws-1",
	projectId: "proj-1",
	workspacePath: "/home/user/repos/my-project",
	branch: "main",
	name: "Main Workspace",
};

describe("useActiveWorkspaceStore", () => {
	afterEach(() => {
		useActiveWorkspaceStore.getState().reset();
	});

	test("starts with null active workspace", () => {
		expect(useActiveWorkspaceStore.getState().activeWorkspace).toBeNull();
	});

	test("sets active workspace", () => {
		useActiveWorkspaceStore.getState().setActiveWorkspace(MOCK_WORKSPACE);
		expect(useActiveWorkspaceStore.getState().activeWorkspace).toEqual(
			MOCK_WORKSPACE,
		);
	});

	test("clears active workspace", () => {
		useActiveWorkspaceStore.getState().setActiveWorkspace(MOCK_WORKSPACE);
		useActiveWorkspaceStore.getState().setActiveWorkspace(null);
		expect(useActiveWorkspaceStore.getState().activeWorkspace).toBeNull();
	});

	test("reset clears active workspace", () => {
		useActiveWorkspaceStore.getState().setActiveWorkspace(MOCK_WORKSPACE);
		useActiveWorkspaceStore.getState().reset();
		expect(useActiveWorkspaceStore.getState().activeWorkspace).toBeNull();
	});
});
