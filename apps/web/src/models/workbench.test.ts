import { demoWorkspace } from "@signoff/domain/demo";
import type { Workbench } from "@signoff/domain/workbench";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PULL_FILTER,
	duration,
	projectSummaries,
	pullMetrics,
	pullRows,
	readPullFilter,
	relativeTime,
	repositoryOptions,
	scopePulls,
	visiblePulls,
} from "./workbench";

const NOW = 1_800_000_000;
const snapshot: Workbench = {
	...demoWorkspace(NOW),
	demoMode: true,
	fetchedAt: NOW,
	truncated: false,
};
const rows = pullRows(snapshot);

describe("workbench projections", () => {
	it("joins PRs to projects and omits snapshots without their project", () => {
		expect(rows).toHaveLength(38);
		expect(rows.find((row) => row.pull.number === 4821)).toMatchObject({
			project: { name: "Core Platform" },
			readiness: { kind: "blocked" },
			progress: { checksPassed: 4, checksTotal: 6 },
		});
		expect(pullRows({ ...snapshot, projects: [] })).toEqual([]);
	});
	it("counts only open PRs in readiness metrics, including drafts", () => {
		expect(pullMetrics(rows)).toEqual({
			open: 30,
			attention: 15,
			running: 5,
			ready: 6,
			draft: 4,
			merged: 5,
			closed: 3,
		});
		expect(pullMetrics([])).toEqual({
			open: 0,
			attention: 0,
			running: 0,
			ready: 0,
			draft: 0,
			merged: 0,
			closed: 0,
		});
	});
	it("summarizes each project independently with its repositories and scan history", () => {
		const summaries = projectSummaries(snapshot, rows);
		expect(summaries[0]).toMatchObject({
			project: { id: "demo-platform" },
			total: 12,
			metrics: {
				open: 11,
				attention: 6,
				running: 2,
				ready: 2,
				draft: 1,
				merged: 1,
				closed: 0,
			},
		});
		expect(summaries[0]?.repositories.map((repo) => repo.name)).toEqual([
			"api-gateway",
			"identity-service",
			"platform-sdk",
		]);
		expect(summaries[0]?.scans.map((scan) => scan.projectId)).toEqual([
			"demo-platform",
		]);
		const empty = projectSummaries(
			{ ...snapshot, pullRequests: [], scans: [] },
			[],
		);
		expect(empty[0]).toMatchObject({
			total: 0,
			repositories: [],
			scans: [],
			metrics: { open: 0 },
		});
	});
	it("deduplicates repository IDs while keeping equally named repositories in different projects", () => {
		expect(repositoryOptions(rows)).toHaveLength(12);
		expect(
			repositoryOptions(rows, "demo-commerce").map((repo) => repo.name),
		).toEqual(["billing-api", "checkout", "orders"]);
		expect(repositoryOptions(rows, "missing")).toEqual([]);
		const a = {
			...rows[0],
			pull: { ...rows[0].pull, repository: { id: "a", name: "services" } },
			project: { ...rows[0].project, name: "Alpha" },
		};
		const z = {
			...a,
			pull: { ...a.pull, repository: { id: "z", name: "services" } },
			project: { ...a.project, name: "Zulu" },
		};
		expect(repositoryOptions([z, a, a]).map((repo) => repo.id)).toEqual([
			"a",
			"z",
		]);
	});
});

describe("URL filters and review queue", () => {
	it("uses defaults and rejects unknown enum values from shared URLs", () => {
		expect(readPullFilter(new URLSearchParams())).toEqual(DEFAULT_PULL_FILTER);
		expect(
			readPullFilter(
				new URLSearchParams("state=invalid&status=invalid&sort=invalid"),
			),
		).toEqual(DEFAULT_PULL_FILTER);
		expect(
			readPullFilter(
				new URLSearchParams(
					"q=core&project=p&repo=r&state=all&status=unknown&sort=oldest",
				),
			),
		).toEqual({
			query: "core",
			projectId: "p",
			repository: "r",
			state: "all",
			status: "unknown",
			sort: "oldest",
		});
	});
	it("scopes by project, repository, and meaningful search fields before counting", () => {
		expect(scopePulls(rows, DEFAULT_PULL_FILTER)).toHaveLength(38);
		expect(
			scopePulls(rows, { ...DEFAULT_PULL_FILTER, projectId: "demo-platform" }),
		).toHaveLength(12);
		expect(
			scopePulls(rows, {
				...DEFAULT_PULL_FILTER,
				projectId: "demo-platform",
				repository: "demo-platform-api-gateway",
			}),
		).toHaveLength(4);
		expect(
			scopePulls(rows, {
				...DEFAULT_PULL_FILTER,
				projectId: "demo-mobile",
				repository: "demo-platform-api-gateway",
			}),
		).toEqual([]);
		for (const query of [
			" #4821 ",
			"TOKEN REFRESH",
			"regression test",
			"Maya Chen",
			"api-gateway",
			"Core Platform",
		]) {
			expect(
				scopePulls(rows, { ...DEFAULT_PULL_FILTER, query }).some(
					(row) => row.pull.number === 4821,
				),
			).toBe(true);
		}
		expect(
			scopePulls(rows, {
				...DEFAULT_PULL_FILTER,
				query: "resolve conflicts",
			}).map((row) => row.pull.number),
		).toEqual([4824]);
		expect(
			scopePulls(rows, { ...DEFAULT_PULL_FILTER, query: "not-a-real-query" }),
		).toEqual([]);
	});
	it("keeps terminal states out of the default queue and supports exact readiness filters", () => {
		expect(visiblePulls(rows, DEFAULT_PULL_FILTER)).toHaveLength(30);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "merged" }),
		).toHaveLength(5);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "closed" }),
		).toHaveLength(3);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "all" }),
		).toHaveLength(38);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "attention" }),
		).toHaveLength(15);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "ready" }),
		).toHaveLength(6);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "draft" }),
		).toHaveLength(4);
	});
	it("prioritizes blockers and keeps timestamp ties deterministic without mutating input", () => {
		const blocked = {
			...rows[0],
			pull: { ...rows[0].pull, id: "blocked", updatedAt: 20, createdAt: 20 },
		};
		const ready = rows.find((row) => row.readiness.kind === "ready") ?? rows[0];
		const a = {
			...ready,
			pull: { ...ready.pull, id: "a", updatedAt: 40, createdAt: 10 },
		};
		const z = { ...a, pull: { ...a.pull, id: "z" } };
		const input = [z, a, blocked];
		expect(
			visiblePulls(input, DEFAULT_PULL_FILTER).map((row) => row.pull.id),
		).toEqual(["blocked", "a", "z"]);
		expect(
			visiblePulls(input, { ...DEFAULT_PULL_FILTER, sort: "updated" }).map(
				(row) => row.pull.id,
			),
		).toEqual(["a", "z", "blocked"]);
		expect(
			visiblePulls(input, { ...DEFAULT_PULL_FILTER, sort: "oldest" }).map(
				(row) => row.pull.id,
			),
		).toEqual(["a", "z", "blocked"]);
		expect(input.map((row) => row.pull.id)).toEqual(["z", "a", "blocked"]);
	});
});

describe("scan and stage time labels", () => {
	it("handles missing, recent, older, and future timestamps", () => {
		expect(relativeTime(null, NOW)).toBe("Never scanned");
		for (const [age, label] of [
			[-100, "just now"],
			[59, "just now"],
			[60, "1m ago"],
			[3599, "59m ago"],
			[3600, "1h ago"],
			[86400, "1d ago"],
		] as const)
			expect(relativeTime(NOW - age, NOW)).toBe(label);
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		expect(relativeTime(NOW - 120)).toBe("2m ago");
		vi.restoreAllMocks();
	});
	it("does not turn missing or queued durations into elapsed work", () => {
		expect(duration(null)).toBe("—");
		expect(duration(0)).toBe("0s");
		expect(duration(59)).toBe("59s");
		expect(duration(60)).toBe("1m 0s");
		expect(duration(125)).toBe("2m 5s");
	});
});
