import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import { createMockFsReader } from "../../executor/mock-fs-reader.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectStatus,
	getRepoState,
	getStashCount,
	parseStatus,
} from "./status.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("parseStatus", () => {
	it("parses staged and modified files", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout: `1 M. N... 100644 100644 100644 abc123 def456 file.ts\0`,
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.staged).toHaveLength(1);
		expect(result.staged[0]?.path).toBe("file.ts");
		expect(result.staged[0]?.indexStatus).toBe("M");
		expect(result.modified).toHaveLength(0);
	});

	it("parses untracked files", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout: "? new-file.ts\0",
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.untracked).toEqual(["new-file.ts"]);
	});

	it("parses modified (worktree) files", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout: "1 .M N... 100644 100644 100644 abc123 def456 changed.ts\0",
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.staged).toHaveLength(0);
		expect(result.modified).toHaveLength(1);
		expect(result.modified[0]?.workTreeStatus).toBe("M");
	});

	it("parses rename entries with source path", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout:
					"2 R. N... 100644 100644 100644 abc123 def456 R100 new.ts\0old.ts\0",
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.staged).toHaveLength(1);
		expect(result.staged[0]?.path).toBe("new.ts");
		expect(result.staged[0]?.sourcePath).toBe("old.ts");
		expect(result.staged[0]?.renameScore).toBe(100);
	});

	it("parses conflicted entries", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout:
					"u UU N... 100644 100644 100644 100644 abc123 def456 ghi789 conflict.ts\0",
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.conflicted).toEqual(["conflict.ts"]);
	});

	it("skips ignored entries", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout: "! ignored-file.log\0",
			},
		});
		const result = await parseStatus(exec, CWD);
		expect(result.staged).toEqual([]);
		expect(result.modified).toEqual([]);
		expect(result.untracked).toEqual([]);
	});

	it("returns empty results on error", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": { stdout: "", exitCode: 128 },
		});
		const result = await parseStatus(exec, CWD);
		expect(result.staged).toEqual([]);
		expect(result.untracked).toEqual([]);
	});
});

describe("getStashCount", () => {
	it("counts stash entries", async () => {
		const exec = mockExec({
			"git stash list": {
				stdout: "stash@{0}: WIP on main\nstash@{1}: WIP on feature",
			},
		});
		expect(await getStashCount(exec, CWD)).toBe(2);
	});

	it("returns 0 when no stashes", async () => {
		const exec = mockExec({ "git stash list": { stdout: "" } });
		expect(await getStashCount(exec, CWD)).toBe(0);
	});
});

describe("getRepoState", () => {
	it("returns clean when no state files exist", async () => {
		const fs = createMockFsReader({ exists: new Map() });
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("clean");
	});

	it("returns merge when MERGE_HEAD exists", async () => {
		const fs = createMockFsReader({
			exists: new Map([["/repo/.git/MERGE_HEAD", true]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("merge");
	});

	it("returns rebase-interactive when rebase-merge exists", async () => {
		const fs = createMockFsReader({
			exists: new Map([["/repo/.git/rebase-merge", true]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("rebase-interactive");
	});

	it("returns cherry-pick when CHERRY_PICK_HEAD exists", async () => {
		const fs = createMockFsReader({
			exists: new Map([["/repo/.git/CHERRY_PICK_HEAD", true]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("cherry-pick");
	});

	it("returns bisect when BISECT_LOG exists", async () => {
		const fs = createMockFsReader({
			exists: new Map([["/repo/.git/BISECT_LOG", true]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("bisect");
	});

	it("returns revert when REVERT_HEAD exists", async () => {
		const fs = createMockFsReader({
			exists: new Map([["/repo/.git/REVERT_HEAD", true]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		expect(await getRepoState(fs, gitPath)).toBe("revert");
	});
});

describe("collectStatus", () => {
	it("combines all status fields", async () => {
		const exec = mockExec({
			"git status --porcelain=v2 -z": {
				stdout: "? untracked.ts\0",
			},
			"git stash list": { stdout: "stash@{0}: WIP\n" },
		});
		const fs = createMockFsReader({ exists: new Map() });
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const status = await collectStatus(exec, fs, CWD, gitPath);
		expect(status.untracked).toEqual(["untracked.ts"]);
		expect(status.stashCount).toBe(1);
		expect(status.repoState).toBe("clean");
	});
});
