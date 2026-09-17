import { demoWorkspace } from "@signoff/domain/demo";
import {
	type Project,
	pullReadiness,
	type Workbench,
} from "@signoff/domain/workbench";
import { describe, expect, it, vi } from "vitest";
import {
	authorOptions,
	canScanProject,
	collectorConnection,
	DEFAULT_PULL_FILTER,
	duration,
	nextPullSort,
	projectSummaries,
	pullMetrics,
	pullRows,
	readPullFilter,
	relativeTime,
	repositoryOptions,
	scopePulls,
	visiblePulls,
	writePullFilter,
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
	it("normalizes legacy draft links into the dedicated draft filter", () => {
		expect(readPullFilter(new URLSearchParams("status=draft"))).toMatchObject({
			status: "all",
			draft: "only",
		});
		expect(
			readPullFilter(new URLSearchParams("status=draft&draft=include")),
		).toMatchObject({ status: "all", draft: "include" });
	});
	it("joins PRs to projects and omits snapshots without their project", () => {
		expect(rows).toHaveLength(46);
		expect(rows.find((row) => row.pull.number === 4821)).toMatchObject({
			project: { name: "Core Platform" },
			readiness: { kind: "blocked" },
			progress: { checksPassed: 4, checksTotal: 6 },
		});
		expect(pullRows({ ...snapshot, projects: [] })).toEqual([]);
	});
	it("counts only open PRs in readiness metrics, including drafts", () => {
		expect(pullMetrics(rows)).toEqual({
			open: 36,
			attention: 18,
			running: 6,
			ready: 7,
			draft: 5,
			merged: 6,
			closed: 4,
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
			scans: [],
			metrics: { open: 0 },
		});
	});
	it("deduplicates repository IDs while keeping equally named repositories in different projects", () => {
		expect(repositoryOptions(rows)).toHaveLength(13);
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
	it("excludes drafts by default and combines draft and multiple author filters before counting", () => {
		const defaults = readPullFilter(new URLSearchParams());
		expect(defaults.draft).toBe("exclude");
		expect(defaults.authors).toEqual([]);
		expect(scopePulls(rows, defaults).every(({ pull }) => !pull.draft)).toBe(
			true,
		);
		const included = scopePulls(rows, { ...defaults, draft: "include" });
		expect(included).toHaveLength(46);
		const drafts = scopePulls(rows, { ...defaults, draft: "only" });
		expect(drafts).toHaveLength(5);
		expect(drafts.every(({ pull }) => pull.draft)).toBe(true);
		const selected = scopePulls(rows, {
			...defaults,
			authors: ["ado:maya", "ado:alex"],
		});
		expect(selected.length).toBeGreaterThan(0);
		expect(
			selected.every(
				({ pull, project }) =>
					!pull.draft &&
					project.provider === "ado" &&
					["maya", "alex"].includes(pull.author.id),
			),
		).toBe(true);
		expect(pullMetrics(selected).draft).toBe(0);
		expect(scopePulls(rows, { ...defaults, authors: ["missing"] })).toEqual([]);
	});
	it("keeps same-name author identities distinct across providers", () => {
		const options = authorOptions(rows);
		expect(
			options
				.filter((author) => author.name === "Maya Chen")
				.map((author) => author.id)
				.sort(),
		).toEqual(["ado:maya", "github:maya"]);
		expect(new Set(options.map((author) => author.id)).size).toBe(
			options.length,
		);
	});
	it("round-trips all filters without persisting pagination or PR details", () => {
		const filter = {
			...DEFAULT_PULL_FILTER,
			organization: "github.com",
			projectId: "demo-github-nocoo",
			repository: "signoff.now",
			query: "checks",
			draft: "include" as const,
			authors: ["github:maya", "github:alex"],
			state: "all" as const,
			sort: "updated" as const,
		};
		expect(readPullFilter(writePullFilter(filter))).toEqual(filter);
		expect(writePullFilter(DEFAULT_PULL_FILTER).toString()).toBe("source=demo");
		expect(
			readPullFilter(
				new URLSearchParams(
					"draft=invalid&author=&author=ado%3Amaya&author=ado%3Amaya",
				),
			),
		).toMatchObject({ draft: "exclude", authors: ["ado:maya"] });
	});
	it("filters repository counters without removing empty repository choices", () => {
		const matching = scopePulls(rows, {
			...DEFAULT_PULL_FILTER,
			authors: ["github:maya"],
		});
		const summaries = projectSummaries(snapshot, rows, matching);
		expect(summaries.flatMap((summary) => summary.repositories)).toHaveLength(
			13,
		);
		expect(
			summaries[0]?.repositories.every((repo) => repo.metrics.open === 0),
		).toBe(true);
		expect(
			summaries.find((summary) => summary.project.provider === "github")
				?.metrics.open,
		).toBe(1);
	});
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
			draft: "exclude",
			authors: [],
			query: "core",
			organization: "msdata",
			projectId: "p",
			repository: "r",
			state: "all",
			status: "unknown",
			sort: "oldest",
			sortDirection: "asc",
		});
	});
	it("scopes by project, repository, and meaningful search fields before counting", () => {
		expect(scopePulls(rows, DEFAULT_PULL_FILTER)).toHaveLength(41);
		expect(
			scopePulls(rows, { ...DEFAULT_PULL_FILTER, projectId: "demo-platform" }),
		).toHaveLength(11);
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
		expect(visiblePulls(rows, DEFAULT_PULL_FILTER)).toHaveLength(36);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "merged" }),
		).toHaveLength(6);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "closed" }),
		).toHaveLength(4);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, state: "all" }),
		).toHaveLength(46);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "attention" }),
		).toHaveLength(18);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "ready" }),
		).toHaveLength(7);
		expect(
			visiblePulls(rows, { ...DEFAULT_PULL_FILTER, status: "draft" }),
		).toHaveLength(5);
	});
	it("prioritizes ready PRs and keeps timestamp ties deterministic without mutating input", () => {
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
		).toEqual(["a", "z", "blocked"]);
		expect(
			visiblePulls(input, {
				...DEFAULT_PULL_FILTER,
				sort: "updated",
				sortDirection: "desc",
			}).map((row) => row.pull.id),
		).toEqual(["a", "z", "blocked"]);
		expect(
			visiblePulls(input, { ...DEFAULT_PULL_FILTER, sort: "oldest" }).map(
				(row) => row.pull.id,
			),
		).toEqual(["a", "z", "blocked"]);
		expect(input.map((row) => row.pull.id)).toEqual(["z", "a", "blocked"]);
	});
	it("orders PRs with each owning project's actual merge requirement order", () => {
		const raw = {
			...snapshot.pullRequests[0],
			draft: false,
			state: "open" as const,
			mergeable: "clear" as const,
			coverage: "complete" as const,
			reviewers: [],
			requiredApprovals: 0,
			builds: [],
			policies: [
				{
					id: "ci",
					name: "CI",
					state: "running" as const,
					required: true,
					detail: "Wait for CI",
					owner: "Build owners",
					kind: "build" as const,
				},
			],
		};
		const project: Project = {
			...snapshot.projects[0],
			mergeRequirements: [
				{ id: "ci", name: "CI", kind: "build" },
				{ id: "review", name: "Review", kind: "review" },
			],
			readinessRules: [
				{ gateId: "ci", label: "CI", color: "blue" },
				{ gateId: "review", label: "Review", color: "orange" },
			],
		};
		const earlier = {
			pull: { ...raw, projectId: project.id },
			project,
			readiness: pullReadiness({ ...raw, projectId: project.id }, project),
			progress: rows[0].progress,
		};
		const other: Project = {
			...project,
			id: "other",
			readinessRules: [...project.readinessRules!].reverse(),
		};
		const later = {
			...earlier,
			pull: { ...raw, projectId: other.id },
			project: other,
			readiness: pullReadiness({ ...raw, projectId: other.id }, other),
		};
		expect(visiblePulls([earlier, later], DEFAULT_PULL_FILTER)[0]).toBe(later);
		expect(
			visiblePulls([earlier, later], {
				...DEFAULT_PULL_FILTER,
				sortDirection: "desc",
			})[0],
		).toBe(earlier);
	});

	it("sorts the table columns in both directions and keeps missing checks behind complete progress", () => {
		const a = {
			...rows[0],
			pull: {
				...rows[0].pull,
				id: "a",
				title: "Alpha",
				updatedAt: 10,
				coverage: "complete" as const,
			},
			readiness: { ...rows[0].readiness, action: "Approve" },
			progress: { ...rows[0].progress, checksPassed: 1, checksTotal: 2 },
		};
		const b = {
			...a,
			pull: { ...a.pull, id: "b", title: "Zulu", updatedAt: 20 },
			readiness: { ...a.readiness, action: "Verify" },
			progress: { ...a.progress, checksPassed: 2 },
		};
		for (const sort of ["title", "action", "progress", "updated"] as const) {
			expect(
				visiblePulls([b, a], {
					...DEFAULT_PULL_FILTER,
					sort,
					sortDirection: "asc",
				}).map((row) => row.pull.id),
			).toEqual(["a", "b"]);
			expect(
				visiblePulls([a, b], {
					...DEFAULT_PULL_FILTER,
					sort,
					sortDirection: "desc",
				}).map((row) => row.pull.id),
			).toEqual(["b", "a"]);
		}
		const missing = {
			...b,
			pull: { ...b.pull, id: "missing", checksObservedAt: null },
		};
		expect(
			visiblePulls([missing, a, b], {
				...DEFAULT_PULL_FILTER,
				sort: "progress",
				sortDirection: "desc",
			}).map((row) => row.pull.id),
		).toEqual(["b", "a", "missing"]);
	});
	it("toggles column sorting and round-trips its direction while migrating saved legacy sorts", () => {
		expect(nextPullSort(DEFAULT_PULL_FILTER, "readiness")).toEqual({
			sort: "readiness",
			sortDirection: "desc",
		});
		expect(nextPullSort(DEFAULT_PULL_FILTER, "updated")).toEqual({
			sort: "updated",
			sortDirection: "desc",
		});
		expect(nextPullSort(DEFAULT_PULL_FILTER, "title")).toEqual({
			sort: "title",
			sortDirection: "asc",
		});
		const filter = {
			...DEFAULT_PULL_FILTER,
			...nextPullSort(DEFAULT_PULL_FILTER, "progress"),
		};
		expect(readPullFilter(writePullFilter(filter))).toEqual(filter);
		expect(readPullFilter(new URLSearchParams("sort=attention"))).toMatchObject(
			{ sort: "readiness", sortDirection: "asc" },
		);
		expect(readPullFilter(new URLSearchParams("sort=updated"))).toMatchObject({
			sort: "updated",
			sortDirection: "desc",
		});
		expect(
			readPullFilter(new URLSearchParams("sort=title&direction=invalid")),
		).toMatchObject({ sort: "title", sortDirection: "asc" });
	});
});

describe("live collection presentation", () => {
	it("judges a collector heartbeat at the snapshot time between scheduled refreshes", () => {
		vi.spyOn(Date, "now").mockReturnValue((NOW + 600) * 1000);
		try {
			expect(
				collectorConnection({
					...snapshot,
					fetchedAt: NOW,
					collector: {
						lastSeenAt: NOW - 10,
						state: "ready",
						message: "Connected",
					},
				}).state,
			).toBe("ready");
			expect(
				collectorConnection({
					...snapshot,
					fetchedAt: NOW + 600,
					collector: { lastSeenAt: NOW, state: "ready", message: "Connected" },
				}).state,
			).toBe("offline");
		} finally {
			vi.restoreAllMocks();
		}
	});
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
		const nextJob = {
			...job,
			id: "next-job",
			revision: job.revision + 1,
			state: "failed" as const,
		};
		expect(
			projectSummaries(
				{
					...snapshot,
					collectionJobs: [{ ...job, state: "complete" }, nextJob],
				},
				rows,
			)[0]?.job,
		).toEqual(nextJob);
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
