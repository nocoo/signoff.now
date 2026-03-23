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

	test("starts with null activeProjectId", () => {
		expect(useActiveWorkspaceStore.getState().activeProjectId).toBeNull();
	});

	test("starts with overview as default activePageId", () => {
		expect(useActiveWorkspaceStore.getState().activePageId).toBe("overview");
	});

	test("starts with null expandedProjectId", () => {
		expect(useActiveWorkspaceStore.getState().expandedProjectId).toBeNull();
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

	test("sets activeProjectId", () => {
		useActiveWorkspaceStore.getState().setActiveProjectId("proj-1");
		expect(useActiveWorkspaceStore.getState().activeProjectId).toBe("proj-1");
	});

	test("clears activeProjectId", () => {
		useActiveWorkspaceStore.getState().setActiveProjectId("proj-1");
		useActiveWorkspaceStore.getState().setActiveProjectId(null);
		expect(useActiveWorkspaceStore.getState().activeProjectId).toBeNull();
	});

	test("sets activePageId", () => {
		useActiveWorkspaceStore.getState().setActivePageId("contributors");
		expect(useActiveWorkspaceStore.getState().activePageId).toBe(
			"contributors",
		);
	});

	test("resets activePageId to overview when project changes", () => {
		useActiveWorkspaceStore.getState().setActivePageId("branches");
		expect(useActiveWorkspaceStore.getState().activePageId).toBe("branches");
		useActiveWorkspaceStore.getState().setActiveProjectId("proj-2");
		expect(useActiveWorkspaceStore.getState().activePageId).toBe("overview");
	});

	test("sets expandedProjectId", () => {
		useActiveWorkspaceStore.getState().setExpandedProjectId("proj-1");
		expect(useActiveWorkspaceStore.getState().expandedProjectId).toBe("proj-1");
	});

	test("clears expandedProjectId", () => {
		useActiveWorkspaceStore.getState().setExpandedProjectId("proj-1");
		useActiveWorkspaceStore.getState().setExpandedProjectId(null);
		expect(useActiveWorkspaceStore.getState().expandedProjectId).toBeNull();
	});

	test("reset clears all state", () => {
		useActiveWorkspaceStore.getState().setActiveWorkspace(MOCK_WORKSPACE);
		useActiveWorkspaceStore.getState().setActiveProjectId("proj-1");
		useActiveWorkspaceStore.getState().setActivePageId("files");
		useActiveWorkspaceStore.getState().setExpandedProjectId("proj-2");
		useActiveWorkspaceStore.getState().reset();
		expect(useActiveWorkspaceStore.getState().activeWorkspace).toBeNull();
		expect(useActiveWorkspaceStore.getState().activeProjectId).toBeNull();
		expect(useActiveWorkspaceStore.getState().activePageId).toBe("overview");
		expect(useActiveWorkspaceStore.getState().expandedProjectId).toBeNull();
	});
});
