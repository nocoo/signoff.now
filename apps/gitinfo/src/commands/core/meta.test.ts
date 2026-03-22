import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectMeta,
	deriveRepoName,
	getCurrentBranch,
	getDefaultBranch,
	getFirstCommitAuthorDate,
	getGitVersion,
	getHead,
	getHeadShort,
	getIsShallow,
	getRemotes,
} from "./meta.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getGitVersion", () => {
	it("extracts version string", async () => {
		const exec = mockExec({
			"git --version": { stdout: "git version 2.43.0" },
		});
		expect(await getGitVersion(exec)).toBe("2.43.0");
	});
});

describe("deriveRepoName", () => {
	it("extracts from SSH origin URL", () => {
		const remotes = [
			{
				name: "origin",
				fetchUrl: "git@github.com:org/my-repo.git",
				pushUrls: [],
			},
		];
		expect(deriveRepoName("/home/user/code", remotes)).toBe("my-repo");
	});

	it("extracts from HTTPS origin URL", () => {
		const remotes = [
			{
				name: "origin",
				fetchUrl: "https://github.com/org/my-repo.git",
				pushUrls: [],
			},
		];
		expect(deriveRepoName("/home/user/code", remotes)).toBe("my-repo");
	});

	it("falls back to directory basename", () => {
		expect(deriveRepoName("/home/user/my-project", [])).toBe("my-project");
	});

	it("handles URL without .git suffix", () => {
		const remotes = [
			{
				name: "origin",
				fetchUrl: "https://github.com/org/repo-name",
				pushUrls: [],
			},
		];
		expect(deriveRepoName("/x", remotes)).toBe("repo-name");
	});
});

describe("getHead", () => {
	it("returns SHA when hasHead", async () => {
		const exec = mockExec({
			"git rev-parse HEAD": { stdout: "abc123def456" },
		});
		expect(await getHead(exec, CWD, true)).toBe("abc123def456");
	});

	it("returns null in empty repo", async () => {
		const exec = mockExec({});
		expect(await getHead(exec, CWD, false)).toBeNull();
	});
});

describe("getHeadShort", () => {
	it("returns short SHA", async () => {
		const exec = mockExec({
			"git rev-parse --short HEAD": { stdout: "abc123d" },
		});
		expect(await getHeadShort(exec, CWD, true)).toBe("abc123d");
	});

	it("returns null in empty repo", async () => {
		expect(await getHeadShort(mockExec({}), CWD, false)).toBeNull();
	});
});

describe("getCurrentBranch", () => {
	it("returns branch name", async () => {
		const exec = mockExec({
			"git symbolic-ref --short HEAD": { stdout: "main" },
		});
		expect(await getCurrentBranch(exec, CWD)).toBe("main");
	});

	it("returns null when detached HEAD", async () => {
		const exec = mockExec({
			"git symbolic-ref --short HEAD": { stdout: "", exitCode: 128 },
		});
		expect(await getCurrentBranch(exec, CWD)).toBeNull();
	});
});

describe("getDefaultBranch", () => {
	it("returns default branch name", async () => {
		const exec = mockExec({
			"git symbolic-ref refs/remotes/origin/HEAD": {
				stdout: "refs/remotes/origin/main",
			},
		});
		expect(await getDefaultBranch(exec, CWD)).toBe("main");
	});

	it("returns null when no remote", async () => {
		const exec = mockExec({
			"git symbolic-ref refs/remotes/origin/HEAD": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getDefaultBranch(exec, CWD)).toBeNull();
	});
});

describe("getRemotes", () => {
	it("parses fetch and push URLs", async () => {
		const exec = mockExec({
			"git remote -v": {
				stdout: [
					"origin\tgit@github.com:org/repo.git (fetch)",
					"origin\tgit@github.com:org/repo.git (push)",
				].join("\n"),
			},
		});
		const remotes = await getRemotes(exec, CWD);
		expect(remotes).toEqual([
			{
				name: "origin",
				fetchUrl: "git@github.com:org/repo.git",
				pushUrls: ["git@github.com:org/repo.git"],
			},
		]);
	});

	it("returns empty array when no remotes", async () => {
		const exec = mockExec({ "git remote -v": { stdout: "" } });
		expect(await getRemotes(exec, CWD)).toEqual([]);
	});

	it("handles multiple remotes", async () => {
		const exec = mockExec({
			"git remote -v": {
				stdout: [
					"origin\thttps://github.com/org/repo.git (fetch)",
					"origin\thttps://github.com/org/repo.git (push)",
					"upstream\thttps://github.com/other/repo.git (fetch)",
					"upstream\thttps://github.com/other/repo.git (push)",
				].join("\n"),
			},
		});
		const remotes = await getRemotes(exec, CWD);
		expect(remotes).toHaveLength(2);
		expect(remotes[0]?.name).toBe("origin");
		expect(remotes[1]?.name).toBe("upstream");
	});
});

describe("getIsShallow", () => {
	it("returns true for shallow repo", async () => {
		const exec = mockExec({
			"git rev-parse --is-shallow-repository": { stdout: "true" },
		});
		expect(await getIsShallow(exec, CWD)).toBe(true);
	});

	it("returns false for non-shallow repo", async () => {
		const exec = mockExec({
			"git rev-parse --is-shallow-repository": { stdout: "false" },
		});
		expect(await getIsShallow(exec, CWD)).toBe(false);
	});
});

describe("getFirstCommitAuthorDate", () => {
	it("returns date of root commit", async () => {
		const exec = mockExec({
			"git rev-list --max-parents=0 HEAD": { stdout: "abc123" },
			"git log abc123 -1 --format=%aI": {
				stdout: "2024-01-15T10:30:00+00:00",
			},
		});
		expect(await getFirstCommitAuthorDate(exec, CWD, true)).toBe(
			"2024-01-15T10:30:00+00:00",
		);
	});

	it("returns null in empty repo", async () => {
		expect(await getFirstCommitAuthorDate(mockExec({}), CWD, false)).toBeNull();
	});
});

describe("collectMeta", () => {
	it("collects full meta section", async () => {
		const exec = mockExec({
			"git --version": { stdout: "git version 2.43.0" },
			"git rev-parse HEAD": { stdout: "abcdef1234567890" },
			"git rev-parse --short HEAD": { stdout: "abcdef1" },
			"git symbolic-ref --short HEAD": { stdout: "main" },
			"git symbolic-ref refs/remotes/origin/HEAD": {
				stdout: "refs/remotes/origin/main",
			},
			"git remote -v": {
				stdout:
					"origin\thttps://github.com/org/my-repo.git (fetch)\norigin\thttps://github.com/org/my-repo.git (push)",
			},
			"git rev-parse --is-shallow-repository": { stdout: "false" },
			"git rev-list --max-parents=0 HEAD": { stdout: "root123" },
			"git log root123 -1 --format=%aI": {
				stdout: "2024-01-01T00:00:00+00:00",
			},
		});

		const meta = await collectMeta(exec, CWD, true);
		expect(meta.gitVersion).toBe("2.43.0");
		expect(meta.repoRoot).toBe(CWD);
		expect(meta.repoName).toBe("my-repo");
		expect(meta.head).toBe("abcdef1234567890");
		expect(meta.headShort).toBe("abcdef1");
		expect(meta.currentBranch).toBe("main");
		expect(meta.defaultBranch).toBe("main");
		expect(meta.isShallow).toBe(false);
		expect(meta.firstCommitAuthorDate).toBe("2024-01-01T00:00:00+00:00");
	});
});
