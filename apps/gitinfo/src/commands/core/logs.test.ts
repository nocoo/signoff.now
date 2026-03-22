import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectLogs,
	getCommitFrequency,
	getConventionalTypes,
	getFirstCommitDate,
	getLastCommit,
	getTotalCommits,
	getTotalMerges,
} from "./logs.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getTotalCommits", () => {
	it("returns commit count", async () => {
		const exec = mockExec({
			"git rev-list --count HEAD": { stdout: "42" },
		});
		expect(await getTotalCommits(exec, CWD, true)).toBe(42);
	});

	it("returns 0 in empty repo", async () => {
		const exec = mockExec({});
		expect(await getTotalCommits(exec, CWD, false)).toBe(0);
	});

	it("returns 0 on command failure", async () => {
		const exec = mockExec({
			"git rev-list --count HEAD": { stdout: "", exitCode: 128 },
		});
		expect(await getTotalCommits(exec, CWD, true)).toBe(0);
	});
});

describe("getTotalMerges", () => {
	it("returns merge commit count", async () => {
		const exec = mockExec({
			"git rev-list --merges --count HEAD": { stdout: "7" },
		});
		expect(await getTotalMerges(exec, CWD, true)).toBe(7);
	});

	it("returns 0 in empty repo", async () => {
		const exec = mockExec({});
		expect(await getTotalMerges(exec, CWD, false)).toBe(0);
	});

	it("returns 0 on command failure", async () => {
		const exec = mockExec({
			"git rev-list --merges --count HEAD": { stdout: "", exitCode: 128 },
		});
		expect(await getTotalMerges(exec, CWD, true)).toBe(0);
	});
});

describe("getFirstCommitDate", () => {
	it("returns date of root commit", async () => {
		const exec = mockExec({
			"git rev-list --max-parents=0 HEAD": { stdout: "abc123" },
			"git log abc123 -1 --format=%aI": {
				stdout: "2024-01-15T10:30:00+00:00",
			},
		});
		expect(await getFirstCommitDate(exec, CWD, true)).toBe(
			"2024-01-15T10:30:00+00:00",
		);
	});

	it("returns null in empty repo", async () => {
		const exec = mockExec({});
		expect(await getFirstCommitDate(exec, CWD, false)).toBeNull();
	});

	it("returns null when rev-list fails", async () => {
		const exec = mockExec({
			"git rev-list --max-parents=0 HEAD": { stdout: "", exitCode: 128 },
		});
		expect(await getFirstCommitDate(exec, CWD, true)).toBeNull();
	});
});

describe("getLastCommit", () => {
	it("parses last commit fields", async () => {
		const exec = mockExec({
			"git log -1 --format=%H%n%h%n%aN <%aE>%n%aI%n%s": {
				stdout: [
					"abc123def456789",
					"abc123d",
					"Alice <alice@example.com>",
					"2025-06-01T12:00:00+00:00",
					"feat: add logs collector",
				].join("\n"),
			},
		});
		const commit = await getLastCommit(exec, CWD, true);
		expect(commit).toEqual({
			sha: "abc123def456789",
			shaShort: "abc123d",
			author: "Alice <alice@example.com>",
			date: "2025-06-01T12:00:00+00:00",
			subject: "feat: add logs collector",
		});
	});

	it("returns null in empty repo", async () => {
		const exec = mockExec({});
		expect(await getLastCommit(exec, CWD, false)).toBeNull();
	});

	it("returns null on command failure", async () => {
		const exec = mockExec({
			"git log -1 --format=%H%n%h%n%aN <%aE>%n%aI%n%s": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getLastCommit(exec, CWD, true)).toBeNull();
	});

	it("returns null when output has insufficient lines", async () => {
		const exec = mockExec({
			"git log -1 --format=%H%n%h%n%aN <%aE>%n%aI%n%s": {
				stdout: "abc123\nshort",
			},
		});
		expect(await getLastCommit(exec, CWD, true)).toBeNull();
	});
});

describe("getCommitFrequency", () => {
	it("counts commits by day, hour, and month", async () => {
		const exec = mockExec({
			"git log --format=%ad --date=format:%a --since=1 year ago HEAD": {
				stdout: "Mon\nTue\nMon\nFri",
			},
			"git log --format=%ad --date=format:%H --since=1 year ago HEAD": {
				stdout: "09\n14\n09\n22",
			},
			"git log --format=%ad --date=format:%Y-%m --since=1 year ago HEAD": {
				stdout: "2025-01\n2025-01\n2025-03\n2025-03",
			},
		});
		const freq = await getCommitFrequency(exec, CWD, true);
		expect(freq).toEqual({
			byDayOfWeek: { Mon: 2, Tue: 1, Fri: 1 },
			byHour: { "09": 2, "14": 1, "22": 1 },
			byMonth: { "2025-01": 2, "2025-03": 2 },
		});
	});

	it("returns zero-value in empty repo", async () => {
		const exec = mockExec({});
		expect(await getCommitFrequency(exec, CWD, false)).toEqual({
			byDayOfWeek: {},
			byHour: {},
			byMonth: {},
		});
	});

	it("returns empty maps when no commits in last year", async () => {
		const exec = mockExec({
			"git log --format=%ad --date=format:%a --since=1 year ago HEAD": {
				stdout: "",
			},
			"git log --format=%ad --date=format:%H --since=1 year ago HEAD": {
				stdout: "",
			},
			"git log --format=%ad --date=format:%Y-%m --since=1 year ago HEAD": {
				stdout: "",
			},
		});
		const freq = await getCommitFrequency(exec, CWD, true);
		expect(freq).toEqual({
			byDayOfWeek: {},
			byHour: {},
			byMonth: {},
		});
	});
});

describe("getConventionalTypes", () => {
	it("counts conventional commit types", async () => {
		const exec = mockExec({
			"git log --format=%s -n 1000 HEAD": {
				stdout: [
					"feat: add feature",
					"fix: resolve bug",
					"feat(core): another feature",
					"chore!: breaking change",
					"not conventional",
					"fix: another fix",
				].join("\n"),
			},
		});
		const types = await getConventionalTypes(exec, CWD, true);
		expect(types).toEqual({ feat: 2, fix: 2, chore: 1 });
	});

	it("returns zero-value in empty repo", async () => {
		const exec = mockExec({});
		expect(await getConventionalTypes(exec, CWD, false)).toEqual({});
	});

	it("returns empty object when no conventional commits", async () => {
		const exec = mockExec({
			"git log --format=%s -n 1000 HEAD": {
				stdout: "just a message\nanother message",
			},
		});
		const types = await getConventionalTypes(exec, CWD, true);
		expect(types).toEqual({});
	});

	it("returns undefined on command failure", async () => {
		const exec = mockExec({
			"git log --format=%s -n 1000 HEAD": { stdout: "", exitCode: 128 },
		});
		expect(await getConventionalTypes(exec, CWD, true)).toBeUndefined();
	});
});

describe("collectLogs", () => {
	const baseMocks: Record<string, MockResponse> = {
		"git rev-list --count HEAD": { stdout: "100" },
		"git rev-list --merges --count HEAD": { stdout: "10" },
		"git rev-list --max-parents=0 HEAD": { stdout: "root123" },
		"git log root123 -1 --format=%aI": {
			stdout: "2024-01-01T00:00:00+00:00",
		},
		"git log -1 --format=%H%n%h%n%aN <%aE>%n%aI%n%s": {
			stdout: [
				"deadbeef12345678",
				"deadbee",
				"Bob <bob@test.com>",
				"2025-12-01T08:00:00+00:00",
				"docs: update readme",
			].join("\n"),
		},
	};

	const slowMocks: Record<string, MockResponse> = {
		"git log --format=%ad --date=format:%a --since=1 year ago HEAD": {
			stdout: "Mon\nTue",
		},
		"git log --format=%ad --date=format:%H --since=1 year ago HEAD": {
			stdout: "10\n14",
		},
		"git log --format=%ad --date=format:%Y-%m --since=1 year ago HEAD": {
			stdout: "2025-06\n2025-06",
		},
		"git log --format=%s -n 1000 HEAD": {
			stdout: "feat: a\nfix: b\nfeat: c",
		},
	};

	it("collects instant fields without slow", async () => {
		const exec = mockExec(baseMocks);
		const logs = await collectLogs(exec, CWD, true, false);
		expect(logs.totalCommits).toBe(100);
		expect(logs.totalMerges).toBe(10);
		expect(logs.firstCommitDate).toBe("2024-01-01T00:00:00+00:00");
		expect(logs.lastCommit).toEqual({
			sha: "deadbeef12345678",
			shaShort: "deadbee",
			author: "Bob <bob@test.com>",
			date: "2025-12-01T08:00:00+00:00",
			subject: "docs: update readme",
		});
		expect(logs.commitFrequency).toBeUndefined();
		expect(logs.conventionalTypes).toBeUndefined();
	});

	it("includes slow fields when requested", async () => {
		const exec = mockExec({ ...baseMocks, ...slowMocks });
		const logs = await collectLogs(exec, CWD, true, true);
		expect(logs.totalCommits).toBe(100);
		expect(logs.commitFrequency).toEqual({
			byDayOfWeek: { Mon: 1, Tue: 1 },
			byHour: { "10": 1, "14": 1 },
			byMonth: { "2025-06": 2 },
		});
		expect(logs.conventionalTypes).toEqual({ feat: 2, fix: 1 });
	});

	it("handles empty repo", async () => {
		const exec = mockExec({});
		const logs = await collectLogs(exec, CWD, false, false);
		expect(logs.totalCommits).toBe(0);
		expect(logs.totalMerges).toBe(0);
		expect(logs.firstCommitDate).toBeNull();
		expect(logs.lastCommit).toBeNull();
	});

	it("handles empty repo with slow tier", async () => {
		const exec = mockExec({});
		const logs = await collectLogs(exec, CWD, false, true);
		expect(logs.totalCommits).toBe(0);
		expect(logs.commitFrequency).toEqual({
			byDayOfWeek: {},
			byHour: {},
			byMonth: {},
		});
		expect(logs.conventionalTypes).toEqual({});
	});
});
