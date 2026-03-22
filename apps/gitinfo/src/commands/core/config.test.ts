import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import { createMockFsReader } from "../../executor/mock-fs-reader.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectConfig,
	getGitDirSizeKiB,
	getHooks,
	getLocalConfig,
	getObjectStats,
	getWorktreeCount,
} from "./config.ts";

const CWD = "/repo";
const GIT_DIR = "/repo/.git";
const REPO_ROOT = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getGitDirSizeKiB", () => {
	it("returns size from FsReader.dirSizeKiB", async () => {
		const fs = createMockFsReader({
			sizes: new Map([[GIT_DIR, 4096]]),
		});
		expect(await getGitDirSizeKiB(fs, GIT_DIR)).toBe(4096);
	});

	it("returns 0 for unknown path", async () => {
		const fs = createMockFsReader();
		expect(await getGitDirSizeKiB(fs, GIT_DIR)).toBe(0);
	});
});

describe("getObjectStats", () => {
	it("parses count-objects -v output", async () => {
		const exec = mockExec({
			"git count-objects -v": {
				stdout: [
					"count: 42",
					"size: 168",
					"in-pack: 1234",
					"packs: 3",
					"size-pack: 5678",
					"prune-packable: 0",
					"garbage: 0",
					"size-garbage: 0",
				].join("\n"),
			},
		});
		const stats = await getObjectStats(exec, CWD);
		expect(stats).toEqual({
			count: 42,
			size: 168,
			inPack: 1234,
			packs: 3,
			sizePackKiB: 5678,
			prunePackable: 0,
			garbage: 0,
			sizeGarbageKiB: 0,
		});
	});

	it("returns zero stats on command failure", async () => {
		const exec = mockExec({
			"git count-objects -v": { stdout: "", exitCode: 128 },
		});
		const stats = await getObjectStats(exec, CWD);
		expect(stats.count).toBe(0);
		expect(stats.inPack).toBe(0);
	});

	it("handles partial output", async () => {
		const exec = mockExec({
			"git count-objects -v": {
				stdout: "count: 10\npacks: 2\n",
			},
		});
		const stats = await getObjectStats(exec, CWD);
		expect(stats.count).toBe(10);
		expect(stats.packs).toBe(2);
		expect(stats.size).toBe(0);
	});
});

describe("getWorktreeCount", () => {
	it("counts worktree entries from porcelain output", async () => {
		const exec = mockExec({
			"git worktree list --porcelain -z": {
				stdout:
					"worktree /repo\0HEAD abc123\0branch refs/heads/main\0\0worktree /repo2\0HEAD def456\0branch refs/heads/feature\0\0",
			},
		});
		expect(await getWorktreeCount(exec, CWD)).toBe(2);
	});

	it("returns 0 on empty output", async () => {
		const exec = mockExec({
			"git worktree list --porcelain -z": { stdout: "" },
		});
		expect(await getWorktreeCount(exec, CWD)).toBe(0);
	});

	it("returns single worktree for basic repo", async () => {
		const exec = mockExec({
			"git worktree list --porcelain -z": {
				stdout: "worktree /repo\0HEAD abc123\0branch refs/heads/main\0\0",
			},
		});
		expect(await getWorktreeCount(exec, CWD)).toBe(1);
	});

	it("returns 0 on command failure", async () => {
		const exec = mockExec({
			"git worktree list --porcelain -z": { stdout: "", exitCode: 128 },
		});
		expect(await getWorktreeCount(exec, CWD)).toBe(0);
	});
});

describe("getHooks", () => {
	it("reads hooks from default gitPath when core.hooksPath is not set", async () => {
		const exec = mockExec({
			"git config core.hooksPath": { stdout: "", exitCode: 1 },
		});
		const fs = createMockFsReader({
			files: new Map([
				["/repo/.git/hooks", ["pre-commit", "pre-push", "commit-msg.sample"]],
			]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const hooks = await getHooks(exec, fs, CWD, REPO_ROOT, gitPath);
		expect(hooks).toEqual(["pre-commit", "pre-push"]);
	});

	it("reads hooks from absolute core.hooksPath", async () => {
		const exec = mockExec({
			"git config core.hooksPath": { stdout: "/custom/hooks" },
		});
		const fs = createMockFsReader({
			files: new Map([
				["/custom/hooks", ["pre-commit", "applypatch-msg.sample"]],
			]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const hooks = await getHooks(exec, fs, CWD, REPO_ROOT, gitPath);
		expect(hooks).toEqual(["pre-commit"]);
	});

	it("resolves relative core.hooksPath against repoRoot", async () => {
		const exec = mockExec({
			"git config core.hooksPath": { stdout: ".githooks" },
		});
		const fs = createMockFsReader({
			files: new Map([["/repo/.githooks", ["pre-push"]]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const hooks = await getHooks(exec, fs, CWD, REPO_ROOT, gitPath);
		expect(hooks).toEqual(["pre-push"]);
	});

	it("returns empty array when hooks directory is empty", async () => {
		const exec = mockExec({
			"git config core.hooksPath": { stdout: "", exitCode: 1 },
		});
		const fs = createMockFsReader({
			files: new Map([["/repo/.git/hooks", []]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const hooks = await getHooks(exec, fs, CWD, REPO_ROOT, gitPath);
		expect(hooks).toEqual([]);
	});

	it("filters out all .sample files", async () => {
		const exec = mockExec({
			"git config core.hooksPath": { stdout: "", exitCode: 1 },
		});
		const fs = createMockFsReader({
			files: new Map([
				[
					"/repo/.git/hooks",
					[
						"pre-commit.sample",
						"pre-push.sample",
						"commit-msg.sample",
						"post-merge",
					],
				],
			]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;
		const hooks = await getHooks(exec, fs, CWD, REPO_ROOT, gitPath);
		expect(hooks).toEqual(["post-merge"]);
	});
});

describe("getLocalConfig", () => {
	it("parses NUL-delimited config entries", async () => {
		const exec = mockExec({
			"git config --local --list -z": {
				stdout: "user.name\nJohn Doe\0user.email\njohn@example.com\0",
			},
		});
		const config = await getLocalConfig(exec, CWD);
		expect(config).toEqual({
			"user.name": ["John Doe"],
			"user.email": ["john@example.com"],
		});
	});

	it("groups multi-value keys", async () => {
		const exec = mockExec({
			"git config --local --list -z": {
				stdout:
					"remote.origin.url\nhttps://github.com/org/repo.git\0remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0remote.origin.url\ngit@github.com:org/repo.git\0",
			},
		});
		const config = await getLocalConfig(exec, CWD);
		expect(config["remote.origin.url"]).toEqual([
			"https://github.com/org/repo.git",
			"git@github.com:org/repo.git",
		]);
		expect(config["remote.origin.fetch"]).toEqual([
			"+refs/heads/*:refs/remotes/origin/*",
		]);
	});

	it("returns empty object on command failure", async () => {
		const exec = mockExec({
			"git config --local --list -z": { stdout: "", exitCode: 128 },
		});
		expect(await getLocalConfig(exec, CWD)).toEqual({});
	});

	it("returns empty object for empty output", async () => {
		const exec = mockExec({
			"git config --local --list -z": { stdout: "" },
		});
		expect(await getLocalConfig(exec, CWD)).toEqual({});
	});
});

describe("collectConfig", () => {
	it("collects all config fields", async () => {
		const exec = mockExec({
			"git count-objects -v": {
				stdout: [
					"count: 10",
					"size: 40",
					"in-pack: 500",
					"packs: 1",
					"size-pack: 200",
					"prune-packable: 0",
					"garbage: 0",
					"size-garbage: 0",
				].join("\n"),
			},
			"git worktree list --porcelain -z": {
				stdout: "worktree /repo\0HEAD abc123\0branch refs/heads/main\0\0",
			},
			"git config core.hooksPath": { stdout: "", exitCode: 1 },
			"git config --local --list -z": {
				stdout: "core.bare\nfalse\0",
			},
		});
		const fs = createMockFsReader({
			sizes: new Map([[GIT_DIR, 2048]]),
			files: new Map([["/repo/.git/hooks", ["pre-commit"]]]),
		});
		const gitPath = async (name: string) => `/repo/.git/${name}`;

		const config = await collectConfig(
			exec,
			fs,
			CWD,
			REPO_ROOT,
			GIT_DIR,
			gitPath,
		);

		expect(config.gitDirSizeKiB).toBe(2048);
		expect(config.objectStats.count).toBe(10);
		expect(config.objectStats.inPack).toBe(500);
		expect(config.worktreeCount).toBe(1);
		expect(config.hooks).toEqual(["pre-commit"]);
		expect(config.localConfig).toEqual({ "core.bare": ["false"] });
	});
});
