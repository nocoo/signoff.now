import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectBranches,
	getCurrentBranchName,
	getLocalBranches,
	getRemoteBranches,
	getTotalLocal,
} from "./branches.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getCurrentBranchName", () => {
	it("returns branch name", async () => {
		const exec = mockExec({
			"git branch --show-current": { stdout: "main" },
		});
		expect(await getCurrentBranchName(exec, CWD)).toBe("main");
	});

	it("returns null when detached HEAD (empty string)", async () => {
		const exec = mockExec({
			"git branch --show-current": { stdout: "" },
		});
		expect(await getCurrentBranchName(exec, CWD)).toBeNull();
	});
});

describe("getLocalBranches", () => {
	it("parses branches with tracking info", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{
					stdout: [
						"main\torigin/main\t\t2025-01-10T12:00:00+00:00",
						"feature\torigin/feature\t[ahead 3]\t2025-01-15T09:30:00+00:00",
						"local-only\t\t\t2025-01-20T14:00:00+00:00",
					].join("\n"),
				},
			"git branch --merged HEAD": {
				stdout: "* main\n  local-only",
			},
		});

		const branches = await getLocalBranches(exec, CWD, true);
		expect(branches).toHaveLength(3);

		expect(branches[0]?.name).toBe("main");
		expect(branches[0]?.upstream).toBe("origin/main");
		expect(branches[0]?.aheadBehind).toEqual({ ahead: 0, behind: 0 });
		expect(branches[0]?.lastCommitDate).toBe("2025-01-10T12:00:00+00:00");
		expect(branches[0]?.isMerged).toBe(true);

		expect(branches[1]?.name).toBe("feature");
		expect(branches[1]?.upstream).toBe("origin/feature");
		expect(branches[1]?.aheadBehind).toEqual({ ahead: 3, behind: 0 });
		expect(branches[1]?.isMerged).toBe(false);

		expect(branches[2]?.name).toBe("local-only");
		expect(branches[2]?.upstream).toBeNull();
		expect(branches[2]?.aheadBehind).toBeNull();
		expect(branches[2]?.isMerged).toBe(true);
	});

	it("returns empty array when no branches (no HEAD)", async () => {
		const exec = mockExec({});
		const branches = await getLocalBranches(exec, CWD, false);
		expect(branches).toEqual([]);
	});

	it("returns empty array when for-each-ref returns empty", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{ stdout: "" },
		});
		const branches = await getLocalBranches(exec, CWD, true);
		expect(branches).toEqual([]);
	});

	it("handles behind tracking status", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{
					stdout: "stale\torigin/stale\t[behind 5]\t2025-01-05T08:00:00+00:00",
				},
			"git branch --merged HEAD": { stdout: "" },
		});

		const branches = await getLocalBranches(exec, CWD, true);
		expect(branches[0]?.aheadBehind).toEqual({ ahead: 0, behind: 5 });
	});

	it("handles diverged tracking status", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{
					stdout:
						"diverged\torigin/diverged\t[ahead 7, behind 3]\t2025-01-05T08:00:00+00:00",
				},
			"git branch --merged HEAD": { stdout: "" },
		});

		const branches = await getLocalBranches(exec, CWD, true);
		expect(branches[0]?.aheadBehind).toEqual({ ahead: 7, behind: 3 });
	});

	it("handles gone upstream", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{
					stdout: "stale\torigin/stale\t[gone]\t2025-01-05T08:00:00+00:00",
				},
			"git branch --merged HEAD": { stdout: "" },
		});

		const branches = await getLocalBranches(exec, CWD, true);
		expect(branches[0]?.aheadBehind).toBeNull();
	});
});

describe("getRemoteBranches", () => {
	it("returns remote branch names", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname:short)%(end) refs/remotes/":
				{
					stdout: "origin/main\norigin/develop\norigin/feature-x",
				},
		});
		const remotes = await getRemoteBranches(exec, CWD);
		expect(remotes).toEqual([
			"origin/main",
			"origin/develop",
			"origin/feature-x",
		]);
	});

	it("skips symbolic refs (empty lines)", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname:short)%(end) refs/remotes/":
				{
					stdout: "\norigin/main\n\norigin/develop",
				},
		});
		const remotes = await getRemoteBranches(exec, CWD);
		expect(remotes).toEqual(["origin/main", "origin/develop"]);
	});

	it("returns empty array when no remotes", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname:short)%(end) refs/remotes/":
				{ stdout: "" },
		});
		const remotes = await getRemoteBranches(exec, CWD);
		expect(remotes).toEqual([]);
	});
});

describe("getTotalLocal", () => {
	it("counts local branches", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short) refs/heads/": {
				stdout: "main\nfeature\nbugfix",
			},
		});
		expect(await getTotalLocal(exec, CWD)).toBe(3);
	});

	it("returns 0 when no branches", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short) refs/heads/": {
				stdout: "",
			},
		});
		expect(await getTotalLocal(exec, CWD)).toBe(0);
	});
});

describe("collectBranches", () => {
	it("combines all branch fields", async () => {
		const exec = mockExec({
			"git branch --show-current": { stdout: "main" },
			"git for-each-ref --format=%(refname:short)%(09)%(upstream:short)%(09)%(upstream:track)%(09)%(committerdate:iso-strict) refs/heads/":
				{
					stdout: "main\torigin/main\t\t2025-01-10T12:00:00+00:00",
				},
			"git branch --merged HEAD": { stdout: "* main" },
			"git for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname:short)%(end) refs/remotes/":
				{
					stdout: "\norigin/main\norigin/develop",
				},
			"git for-each-ref --format=%(refname:short) refs/heads/": {
				stdout: "main",
			},
		});

		const branches = await collectBranches(exec, CWD, true);

		expect(branches.current).toBe("main");
		expect(branches.local).toHaveLength(1);
		expect(branches.local[0]?.name).toBe("main");
		expect(branches.local[0]?.upstream).toBe("origin/main");
		expect(branches.local[0]?.aheadBehind).toEqual({
			ahead: 0,
			behind: 0,
		});
		expect(branches.local[0]?.isMerged).toBe(true);
		expect(branches.remote).toEqual(["origin/main", "origin/develop"]);
		expect(branches.totalLocal).toBe(1);
		expect(branches.totalRemote).toBe(2);
	});
});
