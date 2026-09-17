import { describe, expect, spyOn, test } from "bun:test";
import type { CollectorClaim } from "@signoff/domain/collection";
import { demoWorkspace } from "@signoff/domain/demo";
import { AdoError, type AdoPagedClient } from "../ado/client.ts";
import type { CollectionClient } from "./client.ts";
import {
	collectionError,
	registerRepositories,
	runCollectionOnce,
	syncCollections,
	watchCollections,
} from "./run.ts";

const time = 1_789_632_000;
const demo = demoWorkspace(time);
const project = {
	...demo.projects[0]!,
	source: "cli" as const,
	repositories: ["api-gateway"],
};
const claim: CollectorClaim = {
	project,
	leaseToken: "6135303f-09e3-4d29-b7aa-9f09a958c8a8",
	job: {
		id: "job",
		projectId: project.id,
		revision: 1,
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
const scan = {
	id: "scan",
	projectId: project.id,
	source: "cli" as const,
	state: "complete" as const,
	startedAt: time,
	completedAt: time,
	pullRequestCount: 1,
	advancedStages: 0,
	message: "Collected",
};

function setup() {
	const events: string[] = [];
	const api: CollectionClient = {
		job: async () => claim.job,
		schedule: async (kind) => ({
			kind,
			cooldownSeconds: kind === "list" ? 120 : 300,
			lastCompletedAt: null,
			roundId: null,
			requested: false,
			foregroundUntil: 0,
			totalJobs: 0,
			completedJobs: 0,
		}),
		load: async () => ({
			projects: [project],
			pullRequests: [],
			scans: [],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		}),
		createProject: async (body) => {
			events.push(`create:${body.organization}`);
			return { ...project, ...body };
		},
		patchProject: async (p, body) => {
			events.push(`patch:${body.repositories?.join(",")}`);
			return { ...p, ...body };
		},
		enqueue: async () => {
			events.push("enqueue");
			return claim.job;
		},
		heartbeat: async (state) => {
			events.push(`heartbeat:${state}`);
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
		complete: async () => {
			events.push("complete");
			return scan;
		},
		fail: async (_job, kind) => {
			events.push(`fail:${kind}`);
		},
	};
	const ado: AdoPagedClient = {
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
	return { api, ado, log, events };
}

describe("real collector orchestration", () => {
	test("continues list discovery while a detail job is still running without overlapping either lane", async () => {
		const deps = setup();
		const controller = new AbortController();
		let releaseDetails!: () => void;
		let completedLists!: () => void;
		const detailsPending = new Promise<void>((resolve) => {
			releaseDetails = resolve;
		});
		const listsDone = new Promise<void>((resolve) => {
			completedLists = resolve;
		});
		let lists = 0;
		let details = 0;
		const lanes: (string | undefined)[] = [];
		deps.api.claim = async (kind) => {
			lanes.push(kind);
			if (kind === "details")
				return details++ === 0
					? { ...claim, job: { ...claim.job, id: "details", kind } }
					: null;
			return lists++ < 3
				? {
						...claim,
						targets: [],
						job: { ...claim.job, id: "list", kind: "list", pullIds: [] },
					}
				: null;
		};
		deps.api.complete = async (job) => {
			if (job.job.id === "list" && lists === 3) completedLists();
			return scan;
		};
		const busy = { list: 0, details: 0 };
		const maxima = { list: 0, details: 0 };
		const watching = watchCollections({
			...deps,
			signal: controller.signal,
			sleep: async () => {
				controller.abort();
			},
			collect: async (opts) => {
				const kind = opts.targets?.length === 0 ? "list" : "details";
				busy[kind]++;
				maxima[kind] = Math.max(maxima[kind], busy[kind]);
				if (kind === "details") await detailsPending;
				busy[kind]--;
				return { pulls: [], state: "complete", message: "done" };
			},
		});
		await listsDone;
		expect(busy.details).toBe(1);
		expect(maxima).toEqual({ list: 1, details: 1 });
		expect(lanes).toContain("list");
		expect(lanes).toContain("details");
		controller.abort();
		releaseDetails();
		await watching;
	});
	test("backs off expired login and transport failures instead of spinning either queue", async () => {
		for (const auth of [true, false]) {
			const deps = setup();
			const controller = new AbortController();
			const sleeps: number[] = [];
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
				},
				collect: async () => {
					throw new Error("must not collect");
				},
			});
			expect(sleeps).toContain(auth ? 15_000 : 10_000);
			expect(deps.events).not.toContain("upload");
		}
	});
	test("keeps transport, authorization and malformed data failures distinct", () => {
		for (const kind of [
			"not_found",
			"rate_limited",
			"bad_response",
			"bad_request",
			"result_too_large",
		] as const) {
			expect(collectionError(new AdoError(kind, "Read failed"))).toEqual({
				kind:
					kind === "not_found"
						? "not_found"
						: kind === "rate_limited"
							? "unavailable"
							: "invalid_data",
				message: "Read failed",
			});
		}
		expect(
			collectionError({
				status: 409,
				body: { error: "Lease changed" },
				message: "HTTP 409",
			}),
		).toEqual({ kind: "unavailable", message: "Lease changed" });
		expect(
			collectionError({ status: 503, body: "HTML", message: "HTTP 503" }),
		).toEqual({ kind: "unavailable", message: "HTTP 503" });
		expect(collectionError("broken")).toEqual({
			kind: "invalid_data",
			message: "Collection failed",
		});
	});
	test("does not claim work when Azure CLI returns malformed login data", async () => {
		const deps = setup();
		deps.ado.checkAuth = async () => {
			throw new AdoError("bad_response", "Invalid token output");
		};
		expect(
			await runCollectionOnce({
				...deps,
				collect: async () => {
					throw new Error("must not collect");
				},
			}),
		).toEqual({ processed: false, state: "failed" });
		expect(deps.events).toContain("heartbeat:error");
		expect(deps.events).not.toContain("claim");
	});
	test("lost lease during progress aborts publication even if reporting failure also fails", async () => {
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
		const result = await runCollectionOnce({
			...deps,
			collect: async (opts) => {
				await opts.onProgress?.(1, 3);
				return {
					pulls: [],
					state: "complete",
					message: "Unexpected completion",
				};
			},
		});
		expect(result.state).toBe("failed");
		expect(
			deps.events.some((event) => event.includes("lease will expire")),
		).toBe(true);
		expect(deps.events).not.toContain("upload");
		expect(deps.events).not.toContain("complete");
	});
	test("a background keepalive failure prevents publication after collection finishes", async () => {
		const deps = setup();
		deps.api.progress = async () => {
			throw new Error("Lease unavailable");
		};
		const result = await runCollectionOnce({
			...deps,
			keepAliveMs: 5,
			collect: async () => {
				await new Promise((resolve) => setTimeout(resolve, 15));
				return { pulls: [], state: "complete", message: "Collected" };
			},
		});
		expect(result.state).toBe("failed");
		expect(deps.events).not.toContain("complete");
	});
	test("reports partial completion honestly and sends monotonic progress", async () => {
		const deps = setup();
		const progress: number[] = [];
		deps.api.progress = async (_lease, done) => {
			progress.push(done);
		};
		deps.api.complete = async (_lease, state) => ({ ...scan, state });
		expect(
			(
				await runCollectionOnce({
					...deps,
					collect: async (opts) => {
						await opts.onProgress?.(2, 3);
						await opts.onProgress?.(1, 3);
						return { pulls: [], state: "partial", message: "Missing timeline" };
					},
				})
			).state,
		).toBe("partial");
		expect(progress).toEqual([2, 2]);
	});
	test("keeps leases alive and publishes only after collection and every upload", async () => {
		const deps = setup();
		const result = await runCollectionOnce({
			...deps,
			keepAliveMs: 5,
			collect: async (opts) => {
				await opts.onProgress?.(1, 1);
				await new Promise((resolve) => setTimeout(resolve, 15));
				expect(deps.events).not.toContain("complete");
				return {
					pulls: [demo.pullRequests[0]!],
					state: "complete",
					message: "Collected 1 PR",
				};
			},
		});
		expect(result.state).toBe("complete");
		expect(deps.events.filter((e) => e === "progress").length).toBeGreaterThan(
			1,
		);
		expect(deps.events.indexOf("upload")).toBeLessThan(
			deps.events.indexOf("complete"),
		);
	});
	test("an expired session does not claim, collect or overwrite prior snapshots", async () => {
		const deps = setup();
		deps.ado.checkAuth = async () => {
			throw new AdoError("unauthenticated", "Run az login");
		};
		const result = await runCollectionOnce({
			...deps,
			collect: async () => {
				throw new Error("must not collect");
			},
		});
		expect(result.state).toBe("auth_required");
		expect(deps.events).toContain("heartbeat:auth_required");
		expect(deps.events).not.toContain("claim");
		expect(deps.events).not.toContain("upload");
	});
	test("records distinct permission and mid-scan auth failures without publishing", async () => {
		for (const kind of ["forbidden", "unauthenticated", "server"] as const) {
			const deps = setup();
			await runCollectionOnce({
				...deps,
				collect: async () => {
					throw new AdoError(kind, "Cannot read checks");
				},
			});
			expect(deps.events).toContain(
				`fail:${kind === "unauthenticated" ? "auth_required" : kind === "server" ? "unavailable" : kind}`,
			);
			expect(deps.events).not.toContain("complete");
		}
	});
	test("upload failure preserves the previous snapshot and an idle queue does no work", async () => {
		const deps = setup();
		deps.api.upload = async () => {
			throw new Error("Upload interrupted");
		};
		await runCollectionOnce({
			...deps,
			collect: async () => ({
				pulls: [],
				state: "partial",
				message: "partial",
			}),
		});
		expect(deps.events).toContain("fail:invalid_data");
		expect(deps.events).not.toContain("complete");
		deps.api.claim = async () => null;
		expect(
			(
				await runCollectionOnce({
					...deps,
					collect: async () => {
						throw new Error("must not collect");
					},
				})
			).processed,
		).toBe(false);
	});
	test("registers scoped URLs idempotently and never narrows an existing all-repository project", async () => {
		const deps = setup();
		await registerRepositories(deps.api, [
			"https://dev.azure.com/neworg/Project/_git/repo",
		]);
		expect(deps.events).toContain("create:neworg");
		await registerRepositories(deps.api, [
			`https://dev.azure.com/${project.organization}/${project.projectKey}/_git/api-gateway`,
		]);
		expect(deps.events.filter((e) => e.startsWith("patch"))).toHaveLength(0);
		await registerRepositories(deps.api, [
			`https://dev.azure.com/${project.organization}/${project.projectKey}/_git/other`,
		]);
		expect(deps.events).toContain("patch:api-gateway,other");
		deps.api.load = async () => ({
			projects: [{ ...project, repositories: [] }],
			pullRequests: [],
			scans: [],
			demoMode: false,
			fetchedAt: time,
			truncated: false,
		});
		const before = deps.events.length;
		await registerRepositories(deps.api, [
			`https://dev.azure.com/${project.organization}/${project.projectKey}/_git/other`,
		]);
		expect(deps.events.length).toBe(before);
	});
	test("explicit sync queues a full scan despite a paused automatic detail job", async () => {
		const deps = setup();
		let full = { ...claim.job, state: "queued" as typeof claim.job.state };
		let collected = 0;
		deps.api.job = async () => full;
		deps.api.load = async () => ({
			projects: [
				{ ...project, lastScannedAt: time },
				{ ...project, id: "paused", enabled: false },
				{ ...project, id: "demo", source: "demo" },
				{ ...project, id: "github", provider: "github" },
				{ ...project, id: "unselected" },
			],
			collectionJobs: [
				{
					...claim.job,
					id: "paused-details",
					state: "queued",
					kind: "details",
					roundId: "round",
				},
				full,
			],
			pullRequests: [],
			scans: [],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		deps.api.enqueue = async (p) => {
			expect(p.id).toBe(project.id);
			deps.events.push("enqueue");
			return full;
		};
		deps.api.claim = async (_kind, jobId) => {
			expect(jobId).toBe(full.id);
			return claim;
		};
		deps.api.complete = async () => {
			full = { ...full, state: "complete" };
			return scan;
		};
		expect(
			await syncCollections({
				...deps,
				projectIds: [project.id, "paused", "demo", "github"],
				collect: async ({ targets }) => {
					expect(targets).toBeUndefined();
					collected++;
					return { pulls: [], state: "complete", message: "done" };
				},
			}),
		).toBe(true);
		expect(collected).toBe(1);
		expect(deps.events.filter((e) => e === "enqueue")).toHaveLength(1);
	});
	test("sync waits through an idle claim until its full scan can run or another collector publishes it", async () => {
		for (const ownedElsewhere of [false, true]) {
			const deps = setup();
			const load = deps.api.load;
			let state: typeof claim.job.state = "queued";
			let released = false;
			let collected = 0;
			deps.api.job = async () => ({ ...claim.job, state });
			deps.api.load = async () => ({
				...(await load()),
				collectionJobs: [{ ...claim.job, state }],
			});
			deps.api.claim = async () => (released && !ownedElsewhere ? claim : null);
			deps.api.complete = async () => {
				state = "complete";
				return scan;
			};
			const sleep = spyOn(Bun, "sleep").mockImplementation(async (ms) => {
				expect(ms).toBe(3000);
				expect(released).toBe(false);
				released = true;
				if (ownedElsewhere) state = "partial";
			});
			try {
				expect(
					await syncCollections({
						...deps,
						collect: async () => {
							collected++;
							return { pulls: [], state: "complete", message: "done" };
						},
					}),
				).toBe(true);
			} finally {
				sleep.mockRestore();
			}
			expect(released).toBe(true);
			expect(collected).toBe(ownedElsewhere ? 0 : 1);
		}
	});
	test("sync never treats missing, failed or auth-required target work as a successful idle queue", async () => {
		for (const state of ["failed", "auth_required", null] as const) {
			const deps = setup();
			const load = deps.api.load;
			deps.api.load = async () => ({
				...(await load()),
				collectionJobs: state ? [{ ...claim.job, state }] : [],
			});
			deps.api.claim = async () => null;
			deps.api.job = async () => {
				if (state === null) throw new Error("Collection job not found");
				return { ...claim.job, state };
			};
			const result = syncCollections({
				...deps,
				collect: async () => {
					throw new Error("No collection should run");
				},
			});
			if (state === null)
				await expect(result).rejects.toThrow("Collection job not found");
			else expect(await result).toBe(false);
		}
	});
	test("sync stops with a failure on expired authentication and succeeds with no eligible projects", async () => {
		const deps = setup();
		deps.ado.checkAuth = async () => {
			throw new AdoError("unauthenticated", "Run az login");
		};
		const opts = {
			...deps,
			collect: async () => ({
				pulls: [],
				state: "complete" as const,
				message: "done",
			}),
		};
		expect(await syncCollections(opts)).toBe(false);
		expect(await syncCollections({ ...opts, projectIds: [] })).toBe(true);
	});
	test("validates every URL before writes and never silently converts a demo project", async () => {
		const deps = setup();
		await expect(
			registerRepositories(deps.api, [
				"https://dev.azure.com/neworg/Project/_git/repo",
				"https://github.com/acme/repo",
			]),
		).rejects.toBeInstanceOf(Error);
		expect(deps.events).toEqual([]);
		deps.api.load = async () => ({
			...demo,
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		await expect(
			registerRepositories(deps.api, [
				`https://dev.azure.com/${project.organization}/${project.projectKey}/_git/api-gateway`,
			]),
		).rejects.toThrow(/demo project/);
		expect(deps.events).toEqual([]);
	});
});
