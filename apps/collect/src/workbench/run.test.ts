import { describe, expect, test } from "bun:test";
import type { CollectorClaim } from "@signoff/domain/collection";
import { demoWorkspace } from "@signoff/domain/demo";
import { AdoError, type AdoPagedClient } from "../ado/client.ts";
import type { CollectionClient } from "./client.ts";
import {
	collectionError,
	queueDueProjects,
	registerRepositories,
	runCollectionOnce,
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
	test("schedules only enabled real projects that are due and have no current job", async () => {
		const deps = setup();
		const p = { ...project, lastScannedAt: time - 500 };
		deps.api.load = async () => ({
			projects: [
				p,
				{ ...p, id: "paused", enabled: false },
				{ ...p, id: "demo", source: "demo" },
			],
			pullRequests: [],
			scans: [],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		expect(await queueDueProjects(deps.api, 120, time)).toBe(1);
		deps.api.load = async () => ({
			projects: [p],
			collectionJobs: [claim.job],
			pullRequests: [],
			scans: [],
			demoMode: true,
			fetchedAt: time,
			truncated: false,
		});
		expect(await queueDueProjects(deps.api, 120, time)).toBe(0);
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
	test("respects retry intervals, explicit project selection and stale job revisions", async () => {
		const deps = setup();
		const data = {
			projects: [{ ...project, lastScannedAt: null }],
			pullRequests: [],
			scans: [],
			demoMode: false,
			fetchedAt: time,
			truncated: false,
			collectionJobs: [
				{ ...claim.job, state: "failed" as const, completedAt: time - 10 },
			],
		};
		deps.api.load = async () => data;
		expect(await queueDueProjects(deps.api, 120, time)).toBe(0);
		data.collectionJobs[0]!.completedAt = time - 200;
		expect(
			await queueDueProjects(deps.api, 120, time, ["different-project"]),
		).toBe(0);
		expect(await queueDueProjects(deps.api, 120, time, [project.id])).toBe(1);
		deps.api.load = async () => ({
			...data,
			collectionJobs: [
				{ ...claim.job, revision: project.revision - 1, updatedAt: time - 300 },
			],
		});
		expect(await queueDueProjects(deps.api, 120, time)).toBe(1);
	});
});
