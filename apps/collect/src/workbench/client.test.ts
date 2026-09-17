import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "@signoff/domain/demo";
import {
	collectionApiBase,
	collectionChunks,
	createCollectionClient,
} from "./client.ts";

describe("local collection API client", () => {
	test("schedules and claims the two independent queues explicitly", async () => {
		const calls: { url: string; body: unknown }[] = [];
		const api = createCollectionClient({
			fetchImpl: async (url, init) => {
				const body = init?.body ? JSON.parse(String(init.body)) : undefined;
				calls.push({ url: String(url), body });
				return Response.json(
					String(url).includes("/schedule")
						? {
								kind: body.kind,
								cooldownSeconds: 120,
								lastCompletedAt: null,
								roundId: null,
								requested: false,
								foregroundUntil: 0,
								completedJobs: 0,
								totalJobs: 0,
							}
						: null,
				);
			},
		});
		await api.schedule("list");
		await api.schedule("details");
		expect(await api.claim("list")).toBeNull();
		expect(await api.claim("details")).toBeNull();
		expect(await api.claim(undefined, "manual-full")).toBeNull();
		expect(
			calls.map(
				(call) => new URL(call.url).pathname + new URL(call.url).search,
			),
		).toEqual([
			"/api/collector/schedule",
			"/api/collector/schedule",
			"/api/collector/claim?kind=list",
			"/api/collector/claim?kind=details",
			"/api/collector/claim?jobId=manual-full",
		]);
		expect(calls.slice(0, 2).map((call) => call.body)).toEqual([
			{ kind: "list" },
			{ kind: "details" },
		]);
	});
	test("refuses a remote upload target and URLs carrying credentials", () => {
		expect(collectionApiBase()).toBe("http://127.0.0.1:37042");
		expect(collectionApiBase("http://localhost:37042/")).toBe(
			"http://localhost:37042",
		);
		expect(collectionApiBase("http://[::1]:37042")).toBe("http://[::1]:37042");
		for (const value of [
			"https://dev.azure.com/acme",
			"http://localhost.evil.test",
			"http://user:secret@localhost:37042",
			"http://:secret@localhost:37042",
			"http://localhost:37042/path",
			"http://localhost:37042/?token=x",
			"http://localhost:37042/#token",
			"ftp://localhost/",
		])
			expect(() => collectionApiBase(value)).toThrow();
	});
	test("chunks by count and payload size, and rejects one oversized PR", () => {
		const pull = demoWorkspace(1_789_632_000).pullRequests[0]!;
		expect(
			collectionChunks(Array(41).fill(pull)).map((items) => items.length),
		).toEqual([20, 20, 1]);
		expect(
			collectionChunks([
				{ ...pull, description: "a".repeat(300_000) },
				{ ...pull, description: "b".repeat(300_000) },
			]),
		).toHaveLength(2);
		expect(() =>
			collectionChunks([{ ...pull, description: "a".repeat(600_000) }]),
		).toThrow(/too large/);
		expect(collectionChunks([])).toEqual([]);
		expect(
			collectionChunks([
				{ ...pull, description: "界".repeat(100_000) },
				{ ...pull, description: "界".repeat(100_000) },
			]),
		).toHaveLength(2);
	});
	test("sends only normalized snapshot data and lease to the loopback Worker", async () => {
		const calls: Array<{
			path: string;
			method: string;
			body: unknown;
			headers: Headers;
		}> = [];
		const api = createCollectionClient({
			fetchImpl: async (url, init) => {
				calls.push({
					path: new URL(String(url)).pathname,
					method: init?.method ?? "GET",
					body: init?.body ? JSON.parse(String(init.body)) : null,
					headers: new Headers(init?.headers),
				});
				return Response.json(null);
			},
		});
		expect(await api.claim()).toBeNull();
		await api.heartbeat("ready", "Azure session verified");
		const claim = {
			job: { id: "job" },
			leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
		};
		const pulls = demoWorkspace(1_789_632_000).pullRequests.slice(0, 21);
		await api.upload(claim, pulls);
		expect(calls.map((c) => [c.path, c.method])).toEqual([
			["/api/collector/claim", "POST"],
			["/api/collector/heartbeat", "POST"],
			["/api/collector/jobs/job/batch", "POST"],
			["/api/collector/jobs/job/batch", "POST"],
		]);
		expect(calls[2]?.body).toMatchObject({
			leaseToken: claim.leaseToken,
			pulls: pulls.slice(0, 20),
		});
		expect(calls.every((c) => !c.headers.has("authorization"))).toBe(true);
	});
	test("validates the full project, queue and publication wire contracts", async () => {
		const now = 1_789_632_000;
		const data = {
			...demoWorkspace(now),
			demoMode: false,
			fetchedAt: now,
			truncated: false,
		};
		const project = {
			...data.projects[0]!,
			id: "project / 1",
			source: "cli" as const,
		};
		const job = {
			id: "job / 1",
			projectId: project.id,
			revision: project.revision,
			state: "running" as const,
			requestedAt: now,
			startedAt: now,
			updatedAt: now,
			completedAt: null,
			completedPulls: 0,
			totalPulls: null,
			message: "",
		};
		const claim = {
			project,
			job,
			leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
		};
		const scan = { ...data.scans[0]!, source: "cli" as const };
		const replies = [
			data,
			project,
			{ ...project, owner: "New owner" },
			job,
			claim,
			job,
			scan,
			{},
			job,
		];
		const calls: Array<{ path: string; method: string; body: any }> = [];
		const api = createCollectionClient({
			fetchImpl: async (url, init) => {
				calls.push({
					path: new URL(url).pathname,
					method: init?.method ?? "GET",
					body: init?.body ? JSON.parse(String(init.body)) : null,
				});
				return Response.json(replies.shift());
			},
		});
		expect((await api.load()).pullRequests).toHaveLength(46);
		const draft = {
			provider: "ado" as const,
			name: "Core",
			organization: "acme",
			projectKey: "Core",
			repositories: ["api"],
			description: "",
			owner: "Maintainers",
			enabled: true,
		};
		expect(await api.createProject(draft)).toEqual(project);
		expect(
			(await api.patchProject(project, { owner: "New owner" })).owner,
		).toBe("New owner");
		expect(await api.enqueue(project)).toEqual(job);
		const lease = await api.claim();
		expect(lease).toEqual(claim);
		await api.progress(claim, 3, 8, "Collecting");
		expect(await api.complete(claim, "complete", 8, "Published")).toEqual(scan);
		await api.fail(claim, "auth_required", "x".repeat(1500));
		expect(await api.job(job.id)).toEqual(job);
		expect(calls.map((call) => call.method)).toEqual([
			"GET",
			"POST",
			"PATCH",
			"POST",
			"POST",
			"POST",
			"POST",
			"POST",
			"GET",
		]);
		expect(calls[2]).toMatchObject({
			path: "/api/projects/project%20%2F%201",
			body: { revision: project.revision, owner: "New owner" },
		});
		expect(calls[3]).toMatchObject({
			path: "/api/projects/project%20%2F%201/scan",
			body: { revision: project.revision },
		});
		expect(calls[5]).toMatchObject({
			path: "/api/collector/jobs/job%20%2F%201/progress",
			body: { leaseToken: claim.leaseToken, completedPulls: 3, totalPulls: 8 },
		});
		expect(calls[6]?.body).toEqual({
			leaseToken: claim.leaseToken,
			state: "complete",
			pullRequestCount: 8,
			message: "Published",
		});
		expect(calls[7]?.body.message).toHaveLength(1000);
		expect(calls[8]?.path).toBe("/api/collector/jobs/job%20%2F%201");
	});
	test("rejects malformed successful responses and propagates Worker errors", async () => {
		const malformed = createCollectionClient({
			fetchImpl: async () => Response.json({ pulls: [] }),
		});
		await expect(malformed.load()).rejects.toBeInstanceOf(Error);
		await expect(malformed.claim()).rejects.toBeInstanceOf(Error);
		await expect(malformed.job("missing")).rejects.toBeInstanceOf(Error);
		const unavailable = createCollectionClient({
			fetchImpl: async () =>
				Response.json({ error: "Lease no longer active" }, { status: 409 }),
		});
		await expect(unavailable.heartbeat("error")).rejects.toMatchObject({
			status: 409,
			body: { error: "Lease no longer active" },
		});
	});
});
