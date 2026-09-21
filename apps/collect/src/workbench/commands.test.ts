import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { presentReadiness } from "@signoff/domain/ai-readiness";
import { demoWorkspace } from "@signoff/domain/demo";
import { makeWatchRef, referenceLinks } from "@signoff/domain/monitoring";
import { pullProgress, pullRequirements } from "@signoff/domain/workbench";
import { Command } from "commander";
import { registerWorkbenchCommands } from "./commands";

const now = 1_789_632_000;
const demo = demoWorkspace(now);
const project = { ...demo.projects[0]!, source: "cli" as const };
const pull = { ...demo.pullRequests[0]!, state: "open" as const, draft: false };
const ref = makeWatchRef(project, pull.repository, pull.number);
const iso = (n: number) => new Date(n * 1000).toISOString();
const projectDto = {
	...project,
	source: "live",
	createdAt: iso(project.createdAt),
	updatedAt: iso(project.updatedAt),
	lastScannedAt: null,
	key: project.projectKey,
	url: referenceLinks(ref).project.url,
};
const readiness = presentReadiness("not_watched");
const pullDto = {
	...pull,
	provider: "ado",
	...referenceLinks(ref),
	project: projectDto,
	url: ref.url,
	createdAt: iso(pull.createdAt),
	updatedAt: iso(pull.updatedAt),
	mergedAt: null,
	publishedAt: iso(now),
	activity: [],
	author: { ...pull.author, key: "author-key" },
	observation: null,
	freshness: {
		listObservedAt: iso(now),
		checksObservedAt: iso(now),
		checksValidity: "valid",
		ageSeconds: { list: 0, checks: 0 },
		clockSkew: false,
	},
	readiness,
	checks: pullProgress(pull),
	requirements: pullRequirements(pull, project),
	content: { state: "complete", missing: [] },
};
const envelope = {
	schemaVersion: 1,
	source: "live",
	dataRevision: "1",
	generatedAt: iso(now),
	coverage: { state: "complete", missing: [] },
};
const page = { limit: 100, total: 0, nextCursor: null };
const catalog = { ...envelope, data: [], projects: [projectDto], page };
const list = {
	...envelope,
	data: [pullDto],
	page: { ...page, total: 1 },
	authors: [],
	metrics: {
		open: 1,
		draft: 0,
		onTrack: 0,
		unknown: 0,
		error: 0,
		attention: 1,
		merged: 0,
		closed: 0,
	},
};
const observation = {
	id: "watch-one",
	source: "live",
	ref,
	pullId: pull.id,
	active: true,
	generation: 3,
	addedAt: iso(now),
	stoppedAt: null,
	stopReason: null,
	pull: null,
};
const status = {
	schemaVersion: 1,
	source: "live",
	generatedAt: iso(now),
	connection: { state: "ready", lastSeenAt: iso(now), message: "Idle" },
	queue: { running: 0, queued: 0, authRequired: 0 },
	watching: 0,
	pendingFirstResult: 0,
	detailCooldownSeconds: 300,
	listCooldownSeconds: 600,
	discovery: "scheduled",
	jobs: [],
	rounds: [],
};
const job = {
	id: "job-one",
	source: "live",
	kind: "refresh",
	state: "queued",
	projectId: project.id,
	projectRevision: 1,
	scope: [pull.repository.id],
	reason: null,
	error: null,
	message: "Queued",
	requestedAt: iso(now),
	updatedAt: iso(now),
	startedAt: null,
	completedAt: null,
	notBefore: iso(now),
	progress: { completed: 0, total: 1 },
	observation: { id: observation.id, generation: 3 },
	repositories: [],
};
let stdout: string;
let stderr: string;
let calls: { url: URL; method: string; body: Record<string, unknown> | null }[];
let reply: (
	url: URL,
	body: Record<string, unknown> | null,
	method: string,
) => Response;
let restore: { mockRestore: () => void }[];
beforeEach(() => {
	stdout = "";
	stderr = "";
	calls = [];
	process.exitCode = 0;
	reply = () => Response.json({ jobs: [] });
	restore = [
		spyOn(process.stdout, "write").mockImplementation((chunk) => {
			stdout += String(chunk);
			return true;
		}),
		spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderr += String(chunk);
			return true;
		}),
		spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: string | URL | Request, init?: RequestInit) => {
					const url = new URL(String(input));
					const body = init?.body ? JSON.parse(String(init.body)) : null;
					const method = init?.method ?? "GET";
					calls.push({ url, body, method });
					expect(url.hostname).toBe("127.0.0.1");
					expect(init?.redirect).toBe("error");
					return reply(url, body, method);
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		),
	];
});
afterEach(() => {
	for (const spy of restore) spy.mockRestore();
	process.exitCode = 0;
});
async function cli(...args: string[]) {
	const program = new Command().name("signoff").exitOverride();
	registerWorkbenchCommands(program);
	await program.parseAsync(["--api-base", "http://127.0.0.1:37042", ...args], {
		from: "user",
	});
}

test("list options preserve repeated scope/author filters and --all buffers every page", async () => {
	reply = (url) =>
		Response.json({
			...list,
			data: url.searchParams.has("cursor") ? [] : list.data,
			page: {
				...page,
				total: 1,
				nextCursor: url.searchParams.has("cursor") ? null : "next",
			},
		});
	await cli(
		"pr",
		"list",
		"--repo",
		referenceLinks(ref).repository.url,
		"--repo",
		"https://github.com/nocoo/signoff.now",
		"--provider",
		"ado",
		"--org",
		project.organization,
		"--project",
		project.projectKey,
		"--state",
		"all",
		"--draft",
		"include",
		"--author",
		"one",
		"--author",
		"two",
		"--watching",
		"--all",
		"--pretty",
	);
	expect(calls).toHaveLength(2);
	expect(calls[0]!.url.searchParams.getAll("author")).toEqual(["one", "two"]);
	expect(calls[0]!.url.searchParams.getAll("repo")).toHaveLength(2);
	expect(JSON.parse(stdout).data).toHaveLength(1);
	expect(stdout).toContain("\n  ");
	expect(stderr).toBe("");
});
test("PR and watch lookup support cached IDs, scoped numbers and URLs", async () => {
	reply = (url) =>
		Response.json(
			url.pathname.includes("observations")
				? { ...envelope, data: observation }
				: { ...envelope, data: pullDto },
		);
	await cli("pr", "get", pull.id);
	await cli(
		"pr",
		"get",
		String(pull.number),
		"--repo",
		referenceLinks(ref).repository.url,
	);
	await cli("pr", "get", ref.url);
	expect(calls[0]!.url.pathname).toContain(encodeURIComponent(pull.id));
	expect(calls[1]!.url.searchParams.get("number")).toBe(String(pull.number));
	stdout = "";
	reply = (_url, _body, method) =>
		Response.json(
			method === "GET"
				? { ...envelope, data: observation }
				: { results: [{ status: "removed", observation }] },
		);
	await cli("watch", "remove", ref.url, pull.id);
	expect(
		calls.filter((c) => c.method === "POST").map((c) => c.body?.items),
	).toEqual([
		[{ id: observation.id, generation: 3 }],
		[{ id: observation.id, generation: 3 }],
	]);
});
test("batch failures retain item results with a nonzero exit and clean structured stderr", async () => {
	reply = () =>
		Response.json({
			results: [
				{ status: "added", observation },
				{
					status: "rejected",
					error: { code: "PR_TERMINAL", message: "Closed", retryable: false },
				},
			],
		});
	await cli("watch", "add", pull.id, "closed-pr");
	expect(process.exitCode).toBe(3);
	expect(JSON.parse(stdout).results).toHaveLength(2);
	expect(JSON.parse(stderr).error.code).toBe("PARTIAL_FAILURE");
	stdout = "";
	stderr = "";
	reply = () =>
		Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	await cli("watch", "remove", pull.id);
	expect(JSON.parse(stdout).results[0].status).toBe("not_found");
	stdout = "";
	reply = () =>
		Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
	await expect(cli("watch", "remove", pull.id)).rejects.toMatchObject({
		status: 503,
	});
	expect(stdout).toBe("");
});
test("cached status, job and observation list need only local GET requests", async () => {
	reply = (url) =>
		Response.json(
			url.pathname.endsWith("collector")
				? status
				: url.pathname.includes("jobs")
					? job
					: { ...envelope, data: [observation], page: { ...page, total: 1 } },
		);
	await cli("status");
	stdout = "";
	await cli("job", "get", "job-one");
	expect(JSON.parse(stdout).id).toBe(job.id);
	stdout = "";
	await cli("watch", "list", "--include-stopped");
	expect(calls.at(-1)?.url.searchParams.get("includeStopped")).toBe("true");
	expect(calls.every((c) => c.method === "GET")).toBe(true);
});
test("batch removal reports a middle ambiguous lookup and continues independent targets", async () => {
	reply = (url, _body, method) => {
		if (url.searchParams.get("pullId") === "ambiguous")
			return Response.json(
				{
					error: {
						code: "REFERENCE_AMBIGUOUS",
						message: "Choose a repository ID",
						retryable: false,
					},
				},
				{ status: 409 },
			);
		return Response.json(
			method === "GET"
				? { ...envelope, data: observation }
				: { results: [{ status: "removed", observation }] },
		);
	};
	await cli("watch", "remove", "first", "ambiguous", "third");
	expect(process.exitCode).toBe(3);
	expect(
		JSON.parse(stdout).results.map((item: { status: string }) => item.status),
	).toEqual(["removed", "rejected", "removed"]);
	expect(JSON.parse(stdout).results[1].error.code).toBe("REFERENCE_AMBIGUOUS");
	expect(JSON.parse(stderr).error.code).toBe("PARTIAL_FAILURE");
	expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
});
test.each([
	400, 422,
])("batch removal keeps malformed item errors separate from service errors (%s)", async (httpStatus) => {
	reply = () => Response.json(null, { status: httpStatus });
	await cli("watch", "remove", "first", "second");
	expect(process.exitCode).toBe(3);
	expect(
		JSON.parse(stdout).results.map(
			(item: { error: { code: string } }) => item.error.code,
		),
	).toEqual(["COMMAND_REJECTED", "COMMAND_REJECTED"]);
	expect(calls).toHaveLength(2);
});
test.each([
	503, 0,
])("batch removal preserves acknowledged receipts before a fatal service error (%s)", async (httpStatus) => {
	reply = (url, _body, method) => {
		if (url.searchParams.get("pullId") === "unavailable") {
			if (!httpStatus) throw new Error("Connection lost");
			return Response.json(
				{ error: { code: "UNAVAILABLE" } },
				{ status: httpStatus },
			);
		}
		return Response.json(
			method === "GET"
				? { ...envelope, data: observation }
				: { results: [{ status: "removed", observation }] },
		);
	};
	await expect(
		cli("watch", "remove", "first", "unavailable", "third"),
	).rejects.toBeTruthy();
	expect(
		JSON.parse(stdout).results.map((item: { status: string }) => item.status),
	).toEqual(["removed"]);
	expect(
		calls.some((call) => call.url.searchParams.get("pullId") === "third"),
	).toBe(false);
});
test("discovery and each refresh form enqueue commands without reading providers", async () => {
	await cli("discover", "--repo", referenceLinks(ref).repository.url);
	await cli("refresh", "--all");
	await cli("refresh", "--pr", ref.url);
	await cli("refresh", "--repo", referenceLinks(ref).repository.url);
	expect(calls.map((c) => c.body?.target)).toEqual([
		undefined,
		{ all: true },
		{ url: ref.url },
		{ repositoryUrl: referenceLinks(ref).repository.url },
	]);
});
test("invalid options fail before requests, including ambiguous scope and unsafe timeouts", async () => {
	for (const args of [
		["pr", "list", "--all", "--cursor", "x"],
		["pr", "list", "--draft", "only", "--state", "merged"],
		["refresh"],
		["refresh", "--all", "--pr", "id"],
		["--timeout", "0s", "status"],
		["--timeout", "6m", "status"],
		["--timeout", "nope", "status"],
		["repo", "add", "https://github.com/nocoo/signoff.now"],
		["--source", "sample", "repo", "add", referenceLinks(ref).repository.url],
	])
		await expect(cli(...args)).rejects.toThrow();
	expect(calls).toHaveLength(0);
	reply = () => Response.json(status);
	await cli("--timeout", "500ms", "status");
	await cli("--timeout", "1m", "status");
});
test("repo registration creates and extends scopes without discovery; aliases queue explicitly", async () => {
	let projects: (typeof projectDto)[] = [];
	reply = (url, body, _method) => {
		if (url.pathname.endsWith("repos"))
			return Response.json({ ...catalog, projects });
		if (url.pathname.includes("projects")) {
			const saved = { ...project, ...body };
			projects = [{ ...projectDto, repositories: saved.repositories }];
			return Response.json(saved);
		}
		return Response.json({ jobs: [] });
	};
	const repositoryUrl = referenceLinks(ref).repository.url;
	await cli("repo", "add", repositoryUrl);
	expect(calls.some((c) => c.url.pathname.includes("discover"))).toBe(false);
	await cli("repo", "add", repositoryUrl);
	expect(calls.at(-1)?.method).toBe("GET");
	await cli("repo", "add", repositoryUrl.replace(/[^/]+$/, "additional"));
	expect(calls.at(-1)?.method).toBe("PATCH");
	await cli("repo", "list");
	await cli("workbench", "sync", "--repo", repositoryUrl);
	expect(calls.at(-1)?.body).toEqual({ source: "live", repositoryUrl });
	await cli("workbench", "sync");
	expect(calls.at(-1)?.body).toEqual({ source: "live", projectId: project.id });
});
test("table output escapes control characters and includes readable PR data", async () => {
	reply = () =>
		Response.json({
			...list,
			data: [{ ...pullDto, title: "Title\n\u001b[31m" }],
		});
	await cli("pr", "list", "--format", "table");
	expect(stdout).toContain("Title  [31m");
	expect(stdout).not.toContain("\u001b");
	stdout = "";
	reply = () =>
		Response.json({
			...envelope,
			data: [observation],
			page: { ...page, total: 1 },
		});
	await cli("watch", "list", "--format", "table");
	expect(stdout).toContain("watching");
	stdout = "";
	reply = () => Response.json(job);
	await cli("job", "get", job.id, "--format", "table");
	expect(stdout).toContain("Queued");
});
test("daemon and its compatibility alias shut down cleanly while an empty watch list stays idle", async () => {
	const listeners = process.listenerCount("SIGTERM");
	reply = (url) => {
		if (url.pathname.endsWith("ai/tick"))
			return Response.json({ processed: false });
		if (url.pathname.endsWith("schedule"))
			return Response.json({
				kind: "details",
				cooldownSeconds: 300,
				lastCompletedAt: null,
				roundId: null,
				requested: false,
				foregroundUntil: 0,
				totalJobs: 0,
				completedJobs: 0,
			});
		if (url.pathname.endsWith("claim")) {
			process.emit("SIGTERM");
			return Response.json(null);
		}
		return Response.json({});
	};
	await cli("daemon");
	await cli("workbench", "watch");
	expect(process.listenerCount("SIGTERM")).toBe(listeners);
	expect(
		calls.every(
			(c) =>
				c.url.pathname.startsWith("/api/collector/") ||
				c.url.pathname === "/api/ai/tick",
		),
	).toBe(true);
	// A shutdown arriving with a claim constructs no Azure process and exits after recording failure.
	const idleReply = reply;
	reply = (url, body, method) => {
		if (!url.pathname.endsWith("claim")) return idleReply(url, body, method);
		process.emit("SIGTERM");
		return Response.json({
			project,
			leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
			observation: { ...observation, source: "cli", addedAt: now },
			scope: [pull.repository.id],
			targets: [pull],
			job: {
				id: job.id,
				projectId: project.id,
				revision: project.revision,
				state: "running",
				kind: "details",
				pullIds: [pull.id],
				requestedAt: now,
				startedAt: now,
				updatedAt: now,
				completedAt: null,
				completedPulls: 0,
				totalPulls: null,
				message: "",
			},
		});
	};
	await cli("daemon");
	expect(stderr).toContain("aborted");
	expect(process.listenerCount("SIGTERM")).toBe(listeners);
});
