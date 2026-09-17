import { demoWorkspace } from "@signoff/domain/demo";
import type { Workbench } from "@signoff/domain/workbench";
import { describe, expect, it, vi } from "vitest";
import {
	canScanProject,
	collectorConnection,
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
	it("keeps repository statistics separate across ADO organizations and includes configured empty repositories", () => {
		const meetings = {
			...snapshot.projects[0],
			id: "meetings",
			name: "Meeting workspace",
			organization: "msdata",
			projectKey: "Vienna",
			repositories: ["online-meetings", "empty-repo"],
		};
		const whiteboard = {
			...meetings,
			id: "whiteboard",
			name: "Whiteboard workspace",
			organization: "intentional",
			projectKey: "intent",
			repositories: ["whiteboard-app"],
		};
		const input = pullRows({
			...snapshot,
			projects: [meetings, whiteboard],
			pullRequests: [
				{
					...snapshot.pullRequests[0],
					id: "meeting-open",
					projectId: meetings.id,
					repository: { id: "shared-id", name: "online-meetings" },
					state: "open",
				},
				{
					...snapshot.pullRequests[0],
					id: "meeting-merged",
					projectId: meetings.id,
					repository: { id: "shared-id", name: "online-meetings" },
					state: "merged",
				},
				{
					...snapshot.pullRequests[0],
					id: "whiteboard-open",
					projectId: whiteboard.id,
					repository: { id: "shared-id", name: "whiteboard-app" },
					state: "open",
				},
			],
		});
		const summaries = repositoryOptions(input, "", [meetings, whiteboard]);
		expect(summaries.map((repo) => repo.name)).toEqual([
			"empty-repo",
			"online-meetings",
			"whiteboard-app",
		]);
		expect(new Set(summaries.map((repo) => repo.key)).size).toBe(3);
		expect(summaries[0]).toMatchObject({
			project: { organization: "msdata", projectKey: "Vienna" },
			total: 0,
			metrics: { open: 0 },
		});
		expect(summaries[1]).toMatchObject({
			total: 2,
			metrics: { open: 1, attention: 1, merged: 1 },
		});
		expect(summaries[2]).toMatchObject({
			total: 1,
			metrics: { open: 1, merged: 0 },
		});
		expect(
			scopePulls(input, {
				...DEFAULT_PULL_FILTER,
				organization: "MSDATA",
				projectId: meetings.id,
				repository: "shared-id",
			}).map(({ pull }) => pull.id),
		).toEqual(["meeting-open", "meeting-merged"]);
		expect(
			scopePulls(input, {
				...DEFAULT_PULL_FILTER,
				organization: "intentional",
				projectId: meetings.id,
			}),
		).toEqual([]);
		expect(
			scopePulls(input, {
				...DEFAULT_PULL_FILTER,
				projectId: meetings.id,
				repository: "ONLINE-MEETINGS",
			}),
		).toHaveLength(2);
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
					"q=core&org=MSDATA&project=p&repo=r&state=all&status=unknown&sort=oldest",
				),
			),
		).toEqual({
			source: "demo",
			query: "core",
			organization: "msdata",
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

describe("live collection presentation", () => {
	it("defaults to real data when available and never mixes live and sample sources", () => {
		expect(readPullFilter(new URLSearchParams(), true).source).toBe("cli");
		expect(readPullFilter(new URLSearchParams("source=all"), true).source).toBe(
			"cli",
		);
		expect(readPullFilter(new URLSearchParams("source=invalid")).source).toBe(
			"demo",
		);
		expect(
			readPullFilter(new URLSearchParams("source=demo"), true).source,
		).toBe("demo");
		const live = {
			...rows[0],
			project: { ...rows[0].project, source: "cli" as const },
		};
		expect(
			scopePulls([...rows, live], { ...DEFAULT_PULL_FILTER, source: "cli" }),
		).toEqual([live]);
	});
	it("distinguishes an expired login from an offline collector", () => {
		expect(collectorConnection(snapshot, NOW).state).toBe("offline");
		expect(
			collectorConnection(
				{
					...snapshot,
					collector: {
						lastSeenAt: NOW,
						state: "auth_required",
						message: "Run az login",
					},
				},
				NOW,
			),
		).toMatchObject({ state: "auth_required", message: "Run az login" });
		expect(
			collectorConnection(
				{
					...snapshot,
					collector: { lastSeenAt: NOW - 100, state: "ready", message: "" },
				},
				NOW,
			).state,
		).toBe("offline");
		expect(
			collectorConnection(
				{
					...snapshot,
					collector: { lastSeenAt: NOW, state: "ready", message: "" },
				},
				NOW,
			).state,
		).toBe("ready");
	});
	it("queues live scans independently of demo mode and disables duplicate active jobs", () => {
		const project = { ...snapshot.projects[0], source: "cli" as const };
		expect(canScanProject(project, { ...snapshot, demoMode: false })).toBe(
			true,
		);
		expect(canScanProject({ ...project, enabled: false }, snapshot)).toBe(
			false,
		);
		expect(
			canScanProject(snapshot.projects[0], { ...snapshot, demoMode: false }),
		).toBe(false);
		const job = {
			id: "job",
			projectId: project.id,
			revision: project.revision,
			state: "running" as const,
			requestedAt: NOW,
			startedAt: NOW,
			updatedAt: NOW,
			completedAt: null,
			completedPulls: 3,
			totalPulls: 10,
			message: "Collecting",
		};
		const active = { ...snapshot, collectionJobs: [job] };
		expect(canScanProject(project, active)).toBe(false);
		expect(
			canScanProject({ ...project, revision: project.revision + 1 }, active),
		).toBe(true);
		expect(projectSummaries(active, rows)[0]?.job).toEqual(job);
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
