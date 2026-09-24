import { describe, expect, spyOn, test } from "bun:test";
import { adoPullId, type CollectorClaim } from "@signoff/domain/collection";
import { demoWorkspace, makeDemoPulls } from "@signoff/domain/demo";
import { makeWatchRef } from "@signoff/domain/monitoring";
import { type AdoAvatarClient, AdoError } from "../ado/client.ts";
import type { CollectionClient } from "./client.ts";
import {
	collectionError,
	runAvatarCollection,
	runCollectionOnce,
	watchCollections,
} from "./run.ts";

const time = Math.floor(Date.now() / 1000);
const demo = demoWorkspace(time);
const project = {
	...demo.projects[0]!,
	source: "cli" as const,
	repositories: [],
};
const rawPull = demo.pullRequests.find((p) => p.projectId === project.id)!;
const pull = {
	...rawPull,
	id: adoPullId(project.id, rawPull.repository.id, String(rawPull.number)),
};
const claim: CollectorClaim = {
	project,
	leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
	targets: [pull],
	scope: [pull.repository.id],
	observation: {
		id: "observation",
		source: "cli",
		ref: makeWatchRef(project, pull.repository, pull.number),
		pullId: pull.id,
		active: true,
		generation: 1,
		addedAt: time,
		stoppedAt: null,
		stopReason: null,
	},
	job: {
		id: "job",
		projectId: project.id,
		revision: 1,
		kind: "details",
		pullIds: [pull.id],
		state: "running",
		requestedAt: time,
		startedAt: time,
		updatedAt: time,
		completedAt: null,
		completedPulls: 0,
		totalPulls: null,
		message: "",
	},
};

function setup() {
	const events: string[] = [];
	const api: CollectionClient = {
		claimAvatars: async () => [],
		publishAvatar: async () => ({}),
		failAvatar: async () => ({}),
		recordNetwork: async () => ({}),
		tickAi: async () => {
			events.push("ai");
		},
		job: async () => claim.job,
		schedule: async (kind) => ({
			kind,
			cooldownSeconds: 300,
			lastCompletedAt: null,
			roundId: null,
			requested: false,
			foregroundUntil: 0,
			totalJobs: 0,
			completedJobs: 0,
		}),
		load: async () => ({
			...demo,
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		}),
		createProject: async (body) => ({ ...project, ...body }),
		patchProject: async (p, body) => ({ ...p, ...body }),
		enqueue: async () => claim.job,
		heartbeat: async () => {
			events.push("heartbeat");
		},
		claim: async () => {
			events.push("claim");
			return claim;
		},
		progress: async () => {
			events.push("progress");
		},
		upload: async () => {
			events.push("upload");
		},
		repositories: async (_lease, repos) => {
			events.push("plan");
			return repos.map((r) => ({
				repository_id: r.id,
				state: "queued" as const,
			}));
		},
		publish: async (_lease, _repo, state) => {
			events.push("publish");
			return { ...claim.job, state };
		},
		repositoryFail: async (_lease, repo) => {
			events.push(`repo-fail:${repo}`);
		},
		complete: async () => {
			events.push("complete");
			return { ...claim.job, state: "complete" };
		},
		fail: async (_lease, kind) => {
			events.push(`fail:${kind}`);
		},
	};
	const ado: AdoAvatarClient = {
		getAvatar: async () => ({
			contentType: "image/png",
			bytes: new Uint8Array([1]),
		}),
		get: async () => ({}),
		getPage: async () => ({ data: {}, continuationToken: null }),
		post: async () => ({}),
		invalidateToken: () => {
			events.push("invalidate");
		},
		checkAuth: async () => {
			events.push("auth");
		},
	};
	const log = {
		info: (s: string) => events.push(s),
		warn: (s: string) => events.push(s),
		error: (s: string) => events.push(s),
	};
	return {
		api,
		ado,
		makeAdo: () => {
			events.push("provider");
			return ado;
		},
		log,
		events,
	};
}
const collected = async () => ({
	pulls: [pull],
	state: "complete" as const,
	message: "Collected",
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("saved-task executor", () => {
	test("a slow auth check does not backdate the watched PR collection clock", async () => {
		const deps = setup();
		let clock = time * 1000;
		const timer = spyOn(Date, "now").mockImplementation(() => clock);
		try {
			deps.ado.checkAuth = async () => {
				clock += 60000;
			};
			const result = await runCollectionOnce({
				...deps,
				collect: async ({ now }) => {
					expect(now).toBe(time + 60);
					return collected();
				},
			});
			expect(result.state).toBe("complete");
		} finally {
			timer.mockRestore();
		}
	});
	test("publishes collected merge requirement definitions with the watched snapshot", async () => {
		const deps = setup();
		const requirements = [
			{
				id: "config-42",
				name: "Required validation",
				kind: "build" as const,
				definitionId: "ci",
			},
		];
		let saved: unknown;
		deps.api.publish = async (
			_lease,
			_repo,
			state,
			_count,
			_message,
			gates,
		) => {
			saved = gates;
			return { ...claim.job, state };
		};
		await runCollectionOnce({
			...deps,
			collect: async () => ({
				...(await collected()),
				mergeRequirements: requirements,
			}),
		});
		expect(saved).toEqual(requirements);
	});
	test("an empty claim never constructs the provider or checks login", async () => {
		const deps = setup();
		deps.api.claim = async () => null;
		expect(await runCollectionOnce({ ...deps, collect: collected })).toEqual({
			processed: false,
			state: "idle",
		});
		expect(deps.events).toEqual([]);
	});
	test("claims before authentication and refreshes only the complete watched identity", async () => {
		const deps = setup();
		const result = await runCollectionOnce({
			...deps,
			collect: async (opts) => {
				expect(
					deps.events
						.filter((event) => ["claim", "provider", "auth"].includes(event))
						.slice(0, 3),
				).toEqual(["claim", "provider", "auth"]);
				expect(opts.targets).toEqual([
					{ id: pull.id, number: pull.number, repository: pull.repository },
				]);
				return collected();
			},
		});
		expect(result).toEqual({ processed: true, state: "complete" });
		expect(deps.events.indexOf("upload")).toBeLessThan(
			deps.events.indexOf("publish"),
		);
		expect(deps.events).not.toContain("complete");
	});
	test("a pending first result refreshes directly using the provider repo ID", async () => {
		const deps = setup();
		deps.api.claim = async () => ({
			...claim,
			targets: [],
			observation: { ...claim.observation!, pullId: null },
		});
		await runCollectionOnce({
			...deps,
			collect: async (opts) => {
				expect(opts.targets?.[0]?.id).toBe(pull.id);
				return collected();
			},
		});
		expect(deps.events).toContain("publish");
	});
	test.each([
		"unauthenticated",
		"forbidden",
		"not_found",
		"server",
		"bad_response",
	] as const)("records %s without replacing cached facts", async (kind) => {
		const deps = setup();
		deps.ado.checkAuth = async () => {
			throw new AdoError(kind, "Provider unavailable");
		};
		const result = await runCollectionOnce({ ...deps, collect: collected });
		expect(result.state).toBe(
			kind === "unauthenticated" ? "auth_required" : "failed",
		);
		expect(deps.events).not.toContain("upload");
		expect(deps.events.includes("invalidate")).toBe(kind === "unauthenticated");
	});
	test("preserves partial completion and monotonic progress", async () => {
		const deps = setup();
		const progress: number[] = [];
		deps.api.progress = async (_lease, done) => {
			progress.push(done);
		};
		const result = await runCollectionOnce({
			...deps,
			collect: async (opts) => {
				await opts.onProgress?.(2, 3);
				await opts.onProgress?.(1, 3);
				return { pulls: [pull], state: "partial", message: "Missing timeline" };
			},
		});
		expect(result.state).toBe("partial");
		expect(progress).toEqual([0, 2, 2, 2]);
	});
	test("lost progress lease prevents all publication even when reporting failure also fails", async () => {
		const deps = setup();
		deps.api.progress = async () => {
			throw {
				status: 409,
				body: { error: "Lease changed" },
				message: "HTTP 409",
			};
		};
		deps.api.fail = async () => {
			throw new Error("Worker offline");
		};
		await runCollectionOnce({
			...deps,
			collect: async (opts) => {
				await opts.onProgress?.(1, 1);
				return collected();
			},
		});
		expect(deps.events).not.toContain("upload");
		expect(deps.events).not.toContain("publish");
		expect(deps.events.some((e) => e.includes("lease changed"))).toBe(true);
	});
	test("a lost background lease stops provider calls after the in-flight request", async () => {
		const deps = setup();
		const pending = deferred<unknown>();
		const renewalFailed = deferred<void>();
		let gets = 0;
		deps.ado.get = async () => {
			gets++;
			return pending.promise;
		};
		deps.api.progress = async () => {
			if (!gets) return;
			renewalFailed.resolve();
			throw new Error("Lease lost");
		};
		const run = runCollectionOnce({
			...deps,
			keepAliveMs: 2,
			collect: async (opts) => {
				await opts.client.get("https://dev.azure.com/org/first");
				await opts.client.get("https://dev.azure.com/org/second");
				return collected();
			},
		});
		await renewalFailed.promise;
		pending.resolve({});
		await run;
		expect(gets).toBe(1);
		expect(deps.events).not.toContain("publish");
	});
	test("long-running collection renews both the task and daemon heartbeat", async () => {
		const deps = setup();
		const reported = deferred<void>();
		deps.api.progress = async () => {
			deps.events.push("progress");
			reported.resolve();
		};
		await runCollectionOnce({
			...deps,
			keepAliveMs: 2,
			collect: async () => {
				await reported.promise;
				return collected();
			},
		});
		expect(deps.events).toContain("heartbeat");
		expect(deps.events).toContain("publish");
	});
	test("shutdown or upload errors keep the previous snapshot", async () => {
		for (const shutdown of [false, true]) {
			const deps = setup();
			const controller = new AbortController();
			deps.api.upload = async () => {
				throw new Error("Upload interrupted");
			};
			await runCollectionOnce({
				...deps,
				signal: controller.signal,
				collect: async () => {
					if (shutdown) controller.abort();
					return collected();
				},
			});
			expect(deps.events).not.toContain("publish");
		}
	});
	test("malformed refresh claims fail before collection", async () => {
		const deps = setup();
		deps.api.claim = async () => ({ ...claim, observation: undefined });
		expect(
			(await runCollectionOnce({ ...deps, collect: collected })).state,
		).toBe("failed");
		expect(deps.events).not.toContain("upload");
	});
});

describe("explicit repository discovery", () => {
	test("each repository uses its own current observation time after a slow earlier repository", async () => {
		const deps = discovery();
		let clock = time * 1000;
		const timer = spyOn(Date, "now").mockImplementation(() => clock);
		try {
			deps.api.claim = async () => ({
				...claim,
				targets: [],
				observation: undefined,
				scope: [],
				repositories: [
					{ id: "first", name: "first", projectExternalId: "project-guid" },
					{ id: "late", name: "late", projectExternalId: "project-guid" },
				],
				job: { ...claim.job, kind: "list", pullIds: [] },
			});
			deps.ado.getPage = async (url) => {
				if (url.includes("/first/")) {
					clock += 600000;
					return { data: { value: [] }, continuationToken: null };
				}
				return {
					data: {
						value: [
							{
								pullRequestId: 999,
								status: "active",
								title: "Created during discovery",
								creationDate: new Date((time + 300) * 1000).toISOString(),
								repository: {
									id: "late",
									name: "late",
									project: { id: "project-guid", name: project.projectKey },
								},
							},
						],
					},
					continuationToken: null,
				};
			};
			let observedAt = 0;
			deps.api.upload = async (_claim, pulls) => {
				observedAt = pulls[0]?.observedAt ?? 0;
			};
			expect((await runCollectionOnce(deps)).state).toBe("complete");
			expect(observedAt).toBe(time + 600);
		} finally {
			timer.mockRestore();
		}
	});
	test("resumes a frozen repository plan without enumerating newly registered repositories", async () => {
		const deps = discovery();
		deps.api.claim = async () => ({
			...claim,
			targets: [],
			observation: undefined,
			scope: ["empty"],
			repositories: [
				{ id: "empty", name: "empty", projectExternalId: "project-guid" },
			],
			job: { ...claim.job, kind: "list", pullIds: [] },
		});
		let calls = 0;
		deps.ado.getPage = async (url) => {
			expect(url).toContain("/empty/pullrequests");
			calls++;
			return { data: { value: [] }, continuationToken: null };
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(calls).toBe(1);
	});
	test("passes the worker cache boundary to provider discovery", async () => {
		const deps = discovery();
		const claimTask = deps.api.claim;
		deps.api.claim = async (...args) => ({
			...(await claimTask(...args))!,
			discoverySince: time - 30 * 86400,
			discoveryCachedBefore: time - 86400,
		});
		deps.api.repositories = async () => [
			{ repository_id: "empty", state: "queued" },
			{ repository_id: "broken", state: "queued" },
		];
		const original = deps.ado.getPage;
		const calls: URL[] = [];
		deps.ado.getPage = async (value) => {
			if (!value.includes("/pullrequests")) return original(value);
			calls.push(new URL(value));
			const repositoryId = new URL(value).pathname
				.split("/repositories/")[1]!
				.split("/")[0]!;
			return {
				data: {
					value: [
						{
							pullRequestId: 1,
							title: "Cached PR",
							status: "completed",
							creationDate: new Date((time - 2 * 86400) * 1000).toISOString(),
							repository: {
								id: repositoryId,
								name: repositoryId,
								project: { id: "project-guid", name: "Project" },
							},
						},
					],
				},
				continuationToken: "older-cached-page",
			};
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(calls).toHaveLength(2);
		expect(calls[0]?.searchParams.get("searchCriteria.minTime")).toBe(
			new Date((time - 30 * 86400) * 1000).toISOString(),
		);
		expect(calls[1]?.searchParams.has("searchCriteria.minTime")).toBe(true);
	});
	function discovery() {
		const deps = setup();
		deps.api.claim = async () => ({
			...claim,
			targets: [],
			observation: undefined,
			scope: [],
			job: { ...claim.job, kind: "list", pullIds: [] },
		});
		deps.ado.getPage = async (url) => {
			if (url.includes("/pullrequests")) {
				if (url.includes("/broken/"))
					throw new AdoError("forbidden", "403 repository access");
				expect(url).toContain("searchCriteria.status=all");
				return { data: { value: [] }, continuationToken: null };
			}
			return {
				data: {
					value: [
						{
							id: "empty",
							name: "empty",
							project: { id: "project-guid", name: project.projectKey },
						},
						{
							id: "broken",
							name: "broken",
							project: { id: "project-guid", name: project.projectKey },
						},
					],
				},
				continuationToken: null,
			};
		};
		return deps;
	}
	test("publishes each completed repository and retains partial failure", async () => {
		const deps = discovery();
		deps.api.complete = async () => ({ ...claim.job, state: "partial" });
		expect((await runCollectionOnce(deps)).state).toBe("partial");
		expect(deps.events).toContain("publish");
		expect(deps.events).toContain("repo-fail:broken");
	});
	test("a reclaimed task skips repositories already finished", async () => {
		const deps = discovery();
		deps.api.repositories = async () => [
			{ repository_id: "empty", state: "succeeded" },
			{ repository_id: "broken", state: "failed" },
		];
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(deps.events).not.toContain("publish");
		expect(deps.events).not.toContain("repo-fail:broken");
	});
	test("authentication failure during discovery pauses the task", async () => {
		const deps = discovery();
		const getPage = deps.ado.getPage;
		deps.ado.getPage = async (url) => {
			if (url.includes("/pullrequests"))
				throw new AdoError("unauthenticated", "Expired");
			return getPage(url);
		};
		expect((await runCollectionOnce(deps)).state).toBe("auth_required");
		expect(deps.events).not.toContain("complete");
	});
});

describe("sample and daemon orchestration", () => {
	test("task logs correlate the lane, repository, PR and completion", async () => {
		const deps = setup();
		await runCollectionOnce({ ...deps, collect: collected });
		const task = `[checks] ${project.organization}/${project.projectKey}/${pull.repository.name} #${pull.number} job=${claim.job.id.slice(0, 8)}`;
		expect(deps.events).toContain(`${task} started`);
		expect(
			deps.events.some((event) => event.startsWith(`${task} complete `)),
		).toBe(true);
	});

	test("daemon schedules project discovery and complete watched PR checks without a status lane", async () => {
		const deps = setup();
		const controller = new AbortController();
		const lanes: string[] = [];
		const scheduled: string[] = [];
		const originalSchedule = deps.api.schedule;
		deps.api.schedule = async (kind, lane) => {
			scheduled.push(lane!);
			return originalSchedule(kind, lane);
		};
		deps.api.claim = async (_kind, _job, lane) => {
			lanes.push(lane ?? "checks");
			if (lanes.length === 3) controller.abort();
			return null;
		};
		await watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async () => {},
		});
		expect(lanes.sort((a, b) => a.localeCompare(b))).toEqual([
			"checks",
			"checks",
			"discover",
		]);
		expect(scheduled.sort((a, b) => a.localeCompare(b))).toEqual([
			"checks",
			"discover",
		]);
		expect(deps.events.filter((event) => event === "heartbeat")).toHaveLength(
			1,
		);
	});

	test("idle claims back off to fifteen seconds and reset after processing work", async () => {
		const deps = setup();
		const controller = new AbortController();
		const release = deferred<void>();
		const sleeps: number[] = [];
		let discoveries = 0;
		let now = 0;
		const clock = spyOn(Date, "now").mockImplementation(() => now);
		const heartbeats: number[] = [];
		deps.api.heartbeat = async () => {
			heartbeats.push(now);
		};
		deps.api.tickAi = () => release.promise;
		deps.api.claimAvatars = async () => {
			await release.promise;
			return [];
		};
		deps.api.claim = async (_kind, _job, lane) => {
			if (lane === "checks") await release.promise;
			else if (++discoveries === 7)
				return {
					...claim,
					project: { ...project, source: "demo" },
				};
			return null;
		};
		try {
			await watchCollections({
				...deps,
				signal: controller.signal,
				sleep: async (ms) => {
					sleeps.push(ms);
					now += ms;
					if (sleeps.length === 7) {
						controller.abort();
						release.resolve();
					}
				},
			});
		} finally {
			clock.mockRestore();
		}
		expect(sleeps).toEqual([3000, 6000, 12000, 15000, 15000, 15000, 3000]);
		expect(heartbeats).toEqual([0, 21000, 36000, 51000, 66000]);
		expect(discoveries).toBe(8);
		expect(deps.events).toContain("publish");
	});

	test("failed shared heartbeats retry without caching the failure", async () => {
		const deps = setup();
		const controller = new AbortController();
		const release = deferred<void>();
		let heartbeats = 0;
		let claims = 0;
		deps.api.tickAi = () => release.promise;
		deps.api.claimAvatars = async () => {
			await release.promise;
			return [];
		};
		deps.api.heartbeat = async () => {
			if (++heartbeats === 1) throw Error("Worker unavailable");
		};
		deps.api.claim = async () => {
			if (++claims === 3) {
				controller.abort();
				release.resolve();
			}
			return null;
		};
		const sleeps: number[] = [];
		await watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		});
		expect(heartbeats).toBe(2);
		expect(sleeps).toEqual([10000, 10000, 10000]);
	});

	test("daemon inference stays independent of collection and waits for its in-flight tick on shutdown", async () => {
		const deps = setup();
		const controller = new AbortController();
		const inference = deferred<void>();
		const collections = deferred<void>();
		let ticks = 0,
			claims = 0;
		deps.api.tickAi = async () => {
			ticks++;
			await inference.promise;
		};
		deps.api.claim = async () => {
			if (++claims === 3) collections.resolve();
			return null;
		};
		const running = watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async () => {
				await inference.promise;
			},
		});
		await collections.promise;
		expect(ticks).toBe(1);
		controller.abort();
		inference.resolve();
		await running;
		expect(ticks).toBe(1);
	});
	test("inference transport failures back off and do not stop collection", async () => {
		const deps = setup();
		const controller = new AbortController();
		const release = deferred<void>();
		const claimed = deferred<void>();
		const delays: number[] = [];
		deps.api.tickAi = async () => {
			throw Error("Inference unavailable");
		};
		deps.api.claim = async () => {
			claimed.resolve();
			return null;
		};
		const running = watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async (ms) => {
				delays.push(ms);
				await release.promise;
			},
		});
		await claimed.promise;
		expect(delays).toContain(10000);
		controller.abort();
		release.resolve();
		await running;
	});

	test("Sample discovery keeps ID scope when another repository name equals that ID", async () => {
		const deps = setup();
		deps.api.claim = async () => ({
			...claim,
			project: { ...project, source: "demo" },
			job: { ...claim.job, kind: "list" },
		});
		deps.api.load = async () => ({
			...demo,
			pullRequests: [
				{
					...pull,
					id: "other-pull",
					repository: { id: "other-id", name: pull.repository.id },
				},
				pull,
			],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		const planned: string[] = [];
		const original = deps.api.repositories;
		deps.api.repositories = async (lease, repos) => {
			planned.push(...repos.map((repo) => repo.id));
			return original(lease, repos);
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(planned).toEqual([pull.repository.id]);
		expect(deps.events).not.toContain("provider");
	});
	test("sample discovery publishes complete enumeration even when cached checks are partial", async () => {
		const deps = setup();
		deps.api.claim = async () => ({
			...claim,
			project: { ...project, source: "demo" },
			scope: [],
			job: { ...claim.job, kind: "list" },
		});
		deps.api.load = async () => ({
			...demo,
			demoMode: true,
			fetchedAt: time,
			truncated: false,
			pullRequests: [{ ...pull, coverage: "partial" }],
		});
		let published: string | undefined;
		deps.api.publish = async (_lease, _repo, state) => {
			published = state;
			return { ...claim.job, state };
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(published).toBe("complete");
	});
	test("sample catalogue discovery registers repositories and leaves PRs to child tasks", async () => {
		const deps = setup();
		deps.api.claim = async () => ({
			...claim,
			project: { ...project, source: "demo" },
			scope: [],
			job: { ...claim.job, kind: "list", catalogueOnly: true },
		});
		const registered: string[] = [];
		deps.api.repositories = async (_lease, repos) => {
			registered.push(...repos.map((repo) => repo.id));
			return [];
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect(registered).toContain(pull.repository.id);
		expect(deps.events).not.toContain("upload");
		expect(deps.events).not.toContain("publish");
		expect(deps.events).toContain("complete");
	});
	test("sample repository discovery fills an uncached repository after a sibling published", async () => {
		const deps = setup();
		const sampleProject = { ...project, source: "demo" as const };
		const generated = makeDemoPulls(sampleProject, time);
		const [first, second] = [...new Set(generated.map((p) => p.repository.id))];
		deps.api.claim = async () => ({
			...claim,
			project: sampleProject,
			scope: [second!],
			job: { ...claim.job, kind: "list" },
		});
		deps.api.load = async () => ({
			...demo,
			demoMode: true,
			fetchedAt: time,
			truncated: false,
			pullRequests: generated.filter((p) => p.repository.id === first),
		});
		const uploaded: string[] = [];
		deps.api.upload = async (_lease, pulls) => {
			uploaded.push(...pulls.map((p) => p.repository.id));
		};
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		expect([...new Set(uploaded)]).toEqual([second!]);
	});
	test("sample discovery and refresh never initialize Azure", async () => {
		for (const details of [false, true]) {
			const deps = setup();
			deps.api.claim = async () => ({
				...claim,
				project: { ...project, source: "demo" },
				targets: [pull],
				scope: [],
				job: { ...claim.job, kind: details ? "details" : "list" },
			});
			expect((await runCollectionOnce(deps)).processed).toBe(true);
			expect(deps.events).not.toContain("provider");
			expect(deps.events).toContain("publish");
		}
	});
	test("sample generation handles first discovery and rejects an unknown sample PR", async () => {
		const deps = setup();
		deps.api.load = async () => ({
			...demo,
			pullRequests: [],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		deps.api.claim = async () => ({
			...claim,
			project: { ...project, source: "demo" },
			scope: [],
			job: { ...claim.job, kind: "list" },
		});
		expect((await runCollectionOnce(deps)).state).toBe("complete");
		deps.api.claim = async () => ({
			...claim,
			project: { ...project, source: "demo" },
			targets: [],
		});
		expect((await runCollectionOnce(deps)).state).toBe("failed");
	});
	test("idle daemon maintains health without touching providers", async () => {
		const deps = setup();
		const controller = new AbortController();
		deps.api.claim = async () => null;
		await watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async (ms) => {
				expect([3000, 10000, 60000]).toContain(ms);
				controller.abort();
			},
		});
		expect(deps.events).toContain("heartbeat");
		expect(deps.events).not.toContain("provider");
	});
	test("two claimed projects progress independently and shut down after in-flight work", async () => {
		const deps = setup();
		const controller = new AbortController();
		const release = deferred<void>();
		const secondFinished = deferred<void>();
		let n = 0;
		deps.api.claim = async () =>
			n++ < 2
				? {
						...claim,
						project: { ...project, id: `project-${n}` },
						job: { ...claim.job, id: `job-${n}` },
					}
				: null;
		deps.api.publish = async (lease) => {
			if (lease.job.id === "job-2") secondFinished.resolve();
			return { ...claim.job, state: "complete" };
		};
		const waiting = watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async () => {
				await release.promise;
			},
			collect: async (opts) => {
				if (opts.project.id === "project-1") await release.promise;
				return collected();
			},
		});
		await secondFinished.promise;
		controller.abort();
		release.resolve();
		await waiting;
		expect(n).toBeGreaterThanOrEqual(2);
	});
	test("authentication and service errors back off without spinning", async () => {
		for (const auth of [false, true]) {
			const deps = setup();
			const controller = new AbortController();
			const sleeps: number[] = [];
			const aiWait = deferred<void>();
			deps.api.tickAi = () => aiWait.promise;
			deps.api.claimAvatars = async () => {
				await aiWait.promise;
				return [];
			};
			if (auth)
				deps.ado.checkAuth = async () => {
					throw new AdoError("unauthenticated", "Run az login");
				};
			else
				deps.api.schedule = async () => {
					throw new Error("Worker unavailable");
				};
			await watchCollections({
				...deps,
				signal: controller.signal,
				sleep: async (ms) => {
					sleeps.push(ms);
					controller.abort();
					aiWait.resolve();
				},
			});
			expect(sleeps).toContain(auth ? 3000 : 10000);
			expect(deps.events).not.toContain("upload");
		}
	});
});

test("normalizes provider, HTTP and unknown failures without exposing stacks", () => {
	for (const kind of [
		"not_found",
		"rate_limited",
		"bad_response",
		"bad_request",
		"result_too_large",
		"forbidden",
		"server",
	] as const)
		expect(collectionError(new AdoError(kind, "Read failed"))).toEqual({
			kind:
				kind === "not_found" || kind === "forbidden"
					? kind
					: kind === "rate_limited" || kind === "server"
						? "unavailable"
						: "invalid_data",
			message: "Read failed",
		});
	for (const error of ["Lease changed", { message: "Lease changed" }])
		expect(
			collectionError({ status: 409, body: { error }, message: "HTTP 409" })
				.message,
		).toBe("Lease changed");
	expect(
		collectionError({ status: 503, body: "HTML", message: "HTTP 503" }).message,
	).toBe("HTTP 503");
	expect(collectionError("broken")).toEqual({
		kind: "invalid_data",
		message: "Collection failed",
	});
});

describe("background avatar collection", () => {
	const task = {
		source: "cli" as const,
		url: "https://dev.azure.com/acme/_api/_common/identityImage?id=alice",
		organization: "acme",
		leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
	};
	test("an idle cache never initializes provider authentication", async () => {
		const deps = setup();
		expect(
			await runAvatarCollection({
				...deps,
				makeAdo: () => {
					throw Error("Unexpected provider work");
				},
			}),
		).toBe(0);
	});
	test("publishes successful images and schedules failure without losing other tasks", async () => {
		const deps = setup();
		const failed: string[] = [];
		const published: string[] = [];
		deps.api.claimAvatars = async () => [
			task,
			{ ...task, url: task.url.replace("alice", "bob") },
		];
		deps.ado.getAvatar = async (url) => {
			if (url.endsWith("alice")) throw new AdoError("server", "Unavailable");
			return { contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) };
		};
		deps.api.publishAvatar = async (image) => {
			published.push(image.url);
			return {};
		};
		deps.api.failAvatar = async (image) => {
			failed.push(image.url);
			return {};
		};
		expect(await runAvatarCollection(deps)).toBe(2);
		expect(failed).toEqual([task.url]);
		expect(published).toEqual([task.url.replace("alice", "bob")]);
		expect(deps.events).not.toContain("claim");
	});
});
