import { describe, expect, test } from "bun:test";
import type { Manifest } from "@signoff/domain";
import { serializeJson, sha256Hex } from "../ado/storage.ts";
import type { FsLike } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import {
	ingestNormalized,
	postWithRetry,
	verifyIngestResponse,
} from "./ingest-normalized.ts";

const REPO_ID = "01K0REPO00000000000000000";
const RUN_A = "01JARTFCTA0000000000000000";
const MANIFEST_PATH = ".data/meta/runs/01JCOLLECT.json";
const ART_A = ".data/normalized/a.json";
const ART_B = ".data/normalized/b.json";

const activity = (prId: number) => ({
	type: "pr.merged",
	occurredAt: 1_784_737_800,
	provider: "ado",
	org: "acme",
	project: "Alpha",
	repoId: REPO_ID,
	developerId: "01K0DEV000000000000000000",
	matchedUniqueName: "ada@example.com",
	sourceIds: { prRepoGuid: "11111111-1111-4111-8111-111111111111", prId },
});

function manifest(over: Partial<Manifest["scopes"][number]> = {}): Manifest {
	return {
		schemaVersion: 1,
		collectRunId: "01JCLECT00000000000000000J",
		startedAt: 1_784_737_800,
		scopes: [
			{
				kind: "repo",
				id: REPO_ID,
				field: "prsClosedThrough",
				baseCursor: "2026-07-20T00:00:00.000Z",
				from: "2026-07-19T23:00:00.000Z",
				watermark: "2026-07-26T11:55:00.000Z",
				commitEligible: true,
				status: "pending",
				errors: [],
				artifacts: [
					{
						path: ART_A,
						runId: RUN_A,
						sha256: "x",
						activityCount: 1,
						status: "pending",
					},
				],
				...over,
			},
		],
	};
}

/**
 * Build a harness whose manifest digests match the artifact bytes, the way a
 * real collect run produces them.
 */
async function harness(m: Manifest, artifacts: Record<string, unknown>) {
	const bodies = new Map<string, string>();
	for (const [path, value] of Object.entries(artifacts)) {
		bodies.set(path, serializeJson(value));
	}
	const withDigests: Manifest = {
		...m,
		scopes: await Promise.all(
			m.scopes.map(async (sc) => ({
				...sc,
				artifacts: await Promise.all(
					sc.artifacts.map(async (a) => {
						const text = bodies.get(a.path);
						if (text === undefined) {
							return a;
						}
						const parsed = artifacts[a.path] as { activities: unknown[] };
						return {
							...a,
							sha256: await sha256Hex(text),
							activityCount: parsed.activities.length,
						};
					}),
				),
			})),
		),
	};
	const files = new Map<string, string>([
		[MANIFEST_PATH, JSON.stringify(withDigests)],
		...bodies.entries(),
	]);
	const fs: FsLike = {
		async mkdir() {},
		async writeFile(path, data) {
			files.set(path, data);
		},
		async readFile(path) {
			const v = files.get(path);
			if (v === undefined) {
				throw new Error(`missing ${path}`);
			}
			return v;
		},
		async stat(path) {
			return files.has(path) ? { isDirectory: false } : null;
		},
		async unlink(path) {
			files.delete(path);
		},
	};
	const writeJson = async (path: string, value: unknown) => {
		files.set(path, JSON.stringify(value));
	};
	return { fs, files, writeJson };
}

function okClient(over: Partial<Record<string, unknown>> = {}): PipelineClient {
	return {
		async bootstrap() {
			return {} as never;
		},
		async ingest(body) {
			const b = body as {
				runId: string;
				chunkIndex: number;
				pipelineConfigVersion: number;
				isFinalChunk: boolean;
				activities: unknown[];
			};
			return {
				runId: b.runId,
				chunkIndex: b.chunkIndex,
				pipelineConfigVersion: b.pipelineConfigVersion,
				activities: {
					received: b.activities.length,
					upserted: b.activities.length,
					rejected: 0,
				},
				scores: { affectedDevDays: 1, recomputed: 1 },
				unmatched: { upserted: 0 },
				finalized: b.isFinalChunk,
				...over,
			} as never;
		},
		async recomputeComplete() {
			return {} as never;
		},
	} as PipelineClient;
}

const base = async (m: Manifest, artifacts: Record<string, unknown>) => {
	const h = await harness(m, artifacts);
	return {
		h,
		opts: {
			filePath: ART_A,
			manifestPath: MANIFEST_PATH,
			dataDir: ".data",
			fs: h.fs,
			writeJson: h.writeJson,
			client: okClient(),
			log: { info: () => {}, warn: () => {}, error: () => {} },
			nowSeconds: 1_784_737_800,
			pipelineConfigVersion: 1,
		},
	};
};

describe("verifyIngestResponse", () => {
	const sent = {
		runId: RUN_A,
		chunkIndex: 0,
		pipelineConfigVersion: 1,
		isFinalChunk: true,
	} as never;
	const good = {
		runId: RUN_A,
		chunkIndex: 0,
		pipelineConfigVersion: 1,
		activities: { received: 1, upserted: 1, rejected: 0 },
		scores: { affectedDevDays: 1, recomputed: 1 },
		unmatched: { upserted: 0 },
		finalized: true,
	};

	test("accepts a matching response", () => {
		expect(verifyIngestResponse(good, sent)).toBeNull();
	});

	test("rejects a mismatched run id, chunk or version", () => {
		expect(verifyIngestResponse({ ...good, runId: "other" }, sent)).toContain(
			"runId",
		);
		expect(verifyIngestResponse({ ...good, chunkIndex: 3 }, sent)).toContain(
			"chunkIndex",
		);
		expect(
			verifyIngestResponse({ ...good, pipelineConfigVersion: 2 }, sent),
		).toContain("config version");
	});

	test("rejects any rejected activity", () => {
		// Partial acceptance is not success: the cursor would advance past rows
		// the server never stored.
		expect(
			verifyIngestResponse(
				{ ...good, activities: { received: 2, upserted: 1, rejected: 1 } },
				sent,
			),
		).toContain("rejected 1");
	});

	test("rejects a finalization that does not match the request", () => {
		expect(verifyIngestResponse({ ...good, finalized: false }, sent)).toContain(
			"did not finalize",
		);
		const intermediate = {
			runId: RUN_A,
			chunkIndex: 0,
			pipelineConfigVersion: 1,
			isFinalChunk: false,
		} as never;
		expect(
			verifyIngestResponse({ ...good, finalized: true }, intermediate),
		).toContain("intermediate chunk finalized");
	});

	test("rejects a body of the wrong shape", () => {
		expect(verifyIngestResponse({ nope: true }, sent)).toContain("schema");
	});
});

describe("ingestNormalized", () => {
	test("ingests and advances the cursor when the scope completes", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);

		const cursor = JSON.parse(h.files.get(".data/meta/cursor.json") as string);
		expect(cursor.byRepo[REPO_ID].prsClosedThrough).toBe(
			"2026-07-26T11:55:00.000Z",
		);
		const after = JSON.parse(h.files.get(MANIFEST_PATH) as string);
		expect(after.scopes[0].artifacts[0].status).toBe("complete");
		expect(after.scopes[0].status).toBe("complete");
	});

	test("a scope with a pending sibling artifact does NOT advance the cursor", async () => {
		// The multi-file case: finalizing one file says nothing about the rest.
		const m = manifest({
			artifacts: [
				{
					path: ART_A,
					runId: RUN_A,
					sha256: "x",
					activityCount: 1,
					status: "pending",
				},
				{
					path: ART_B,
					runId: "01JARTFCTB0000000000000000",
					sha256: "y",
					activityCount: 1,
					status: "pending",
				},
			],
		});
		const { h, opts } = await base(m, {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
			[ART_B]: { activities: [activity(2)], unmatched: [] },
		});

		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);

		// Once the sibling lands too, the scope commits.
		expect(await ingestNormalized({ ...opts, filePath: ART_B })).toBe(
			ExitCode.OK,
		);
		expect(h.files.has(".data/meta/cursor.json")).toBe(true);
	});

	test("an ineligible scope ingests but never advances the cursor", async () => {
		const { h, opts } = await base(manifest({ commitEligible: false }), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("an incomplete scope refuses to ingest at all", async () => {
		const { h, opts } = await base(
			manifest({ status: "incomplete", errors: ["page gap"] }),
			{ [ART_A]: { activities: [activity(1)], unmatched: [] } },
		);
		expect(await ingestNormalized(opts)).toBe(ExitCode.CONTRACT);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("a file the manifest does not list is refused", async () => {
		const { opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		// A hand-dropped file must not be able to move a cursor.
		expect(
			await ingestNormalized({
				...opts,
				filePath: ".data/normalized/stray.json",
			}),
		).toBe(ExitCode.CONTRACT);
	});

	test("a missing manifest is a contract error, not a crash", async () => {
		const { opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		expect(
			await ingestNormalized({
				...opts,
				manifestPath: ".data/meta/runs/nope.json",
			}),
		).toBe(ExitCode.CONTRACT);
	});

	test("a server error leaves the cursor and manifest untouched", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const before = h.files.get(MANIFEST_PATH);
		const failing: PipelineClient = {
			...opts.client,
			async ingest() {
				throw Object.assign(new Error("boom"), {
					status: 503,
					__pipeline: true,
				});
			},
		} as PipelineClient;

		const code = await ingestNormalized({ ...opts, client: failing });
		expect(code).not.toBe(ExitCode.OK);
		expect(h.files.get(MANIFEST_PATH)).toBe(before as string);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("a response that fails verification stops before the manifest write", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const before = h.files.get(MANIFEST_PATH);
		const wrong: PipelineClient = {
			...opts.client,
			async ingest() {
				return {
					runId: "someone-elses-run",
					chunkIndex: 0,
					pipelineConfigVersion: 1,
					activities: { received: 1, upserted: 1, rejected: 0 },
					scores: { affectedDevDays: 1, recomputed: 1 },
					unmatched: { upserted: 0 },
					finalized: true,
				} as never;
			},
		} as PipelineClient;

		expect(await ingestNormalized({ ...opts, client: wrong })).toBe(
			ExitCode.CONTRACT,
		);
		expect(h.files.get(MANIFEST_PATH)).toBe(before as string);
	});

	test("a stale watermark does not rewind an ahead cursor", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		await h.writeJson(".data/meta/cursor.json", {
			schemaVersion: 1,
			byRepo: { [REPO_ID]: { prsClosedThrough: "2027-01-01T00:00:00.000Z" } },
			byProject: {},
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);
		const cursor = JSON.parse(h.files.get(".data/meta/cursor.json") as string);
		expect(cursor.byRepo[REPO_ID].prsClosedThrough).toBe(
			"2027-01-01T00:00:00.000Z",
		);
	});

	test("a full_rematch scope sends the mode and clears stale once whole", async () => {
		const calls: unknown[] = [];
		const sent: unknown[] = [];
		const h = await harness(manifest({ fullRematch: true }), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const client = {
			...okClient(),
			async ingest(body: unknown) {
				sent.push(body);
				return okClient().ingest(body as never);
			},
			async recomputeComplete(body: unknown) {
				calls.push(body);
				return {} as never;
			},
		} as PipelineClient;

		expect(
			await ingestNormalized({
				filePath: ART_A,
				manifestPath: MANIFEST_PATH,
				dataDir: ".data",
				fs: h.fs,
				writeJson: h.writeJson,
				client,
				log: { info: () => {}, warn: () => {}, error: () => {} },
				nowSeconds: 1_784_737_800,
				pipelineConfigVersion: 1,
			}),
		).toBe(ExitCode.OK);

		expect((sent[0] as { runMeta: { mode: string } }).runMeta.mode).toBe(
			"full_rematch",
		);
		expect(calls).toHaveLength(1);
	});

	test("a full_rematch scope does NOT clear stale while artifacts are pending", async () => {
		const calls: unknown[] = [];
		const m = manifest({
			fullRematch: true,
			artifacts: [
				{
					path: ART_A,
					runId: RUN_A,
					sha256: "x",
					activityCount: 1,
					status: "pending",
				},
				{
					path: ART_B,
					runId: "01JARTFCTB0000000000000000",
					sha256: "y",
					activityCount: 1,
					status: "pending",
				},
			],
		});
		const h = await harness(m, {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
			[ART_B]: { activities: [activity(2)], unmatched: [] },
		});
		const client = {
			...okClient(),
			async recomputeComplete(body: unknown) {
				calls.push(body);
				return {} as never;
			},
		} as PipelineClient;
		const opts = {
			filePath: ART_A,
			manifestPath: MANIFEST_PATH,
			dataDir: ".data",
			fs: h.fs,
			writeJson: h.writeJson,
			client,
			log: { info: () => {}, warn: () => {}, error: () => {} },
			nowSeconds: 1_784_737_800,
			pipelineConfigVersion: 1,
		};

		await ingestNormalized(opts);
		// Clearing stale here would report fresh scores while file B is missing.
		expect(calls).toHaveLength(0);

		await ingestNormalized({ ...opts, filePath: ART_B });
		expect(calls).toHaveLength(1);
	});

	test("a failed rematch can be retried after the cursor already moved", async () => {
		// The retry path: commitScope is now a no-op, but the run must still
		// reach recompute/complete or scores_stale is stuck forever.
		let attempts = 0;
		const h = await harness(manifest({ fullRematch: true }), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const client = {
			...okClient(),
			async recomputeComplete() {
				attempts++;
				if (attempts === 1) {
					throw new Error("worker unavailable");
				}
				return {} as never;
			},
		} as PipelineClient;
		const opts = {
			filePath: ART_A,
			manifestPath: MANIFEST_PATH,
			dataDir: ".data",
			fs: h.fs,
			writeJson: h.writeJson,
			client,
			log: { info: () => {}, warn: () => {}, error: () => {} },
			nowSeconds: 1_784_737_800,
			pipelineConfigVersion: 1,
		};

		expect(await ingestNormalized(opts)).toBe(ExitCode.SERVER);
		expect(h.files.has(".data/meta/cursor.json")).toBe(true);

		// Same command again: the cursor does not move, but the rematch does.
		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);
		expect(attempts).toBe(2);
	});

	test("a multi-scope rematch waits for every scope, not just this one", async () => {
		const calls: unknown[] = [];
		const m = manifest({ fullRematch: true });
		// A second scope in the same run that has not been ingested yet.
		m.scopes.push({
			...m.scopes[0],
			kind: "project",
			id: "22222222-2222-4222-8222-222222222222",
			field: "wiChangedThrough",
			fullRematch: true,
			artifacts: [
				{
					path: ART_B,
					runId: "01JARTFCTB0000000000000000",
					sha256: "y",
					activityCount: 1,
					status: "pending",
				},
			],
		} as (typeof m.scopes)[number]);

		const h = await harness(m, {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
			[ART_B]: { activities: [activity(2)], unmatched: [] },
		});
		const client = {
			...okClient(),
			async recomputeComplete(body: unknown) {
				calls.push(body);
				return {} as never;
			},
		} as PipelineClient;
		const opts = {
			filePath: ART_A,
			manifestPath: MANIFEST_PATH,
			dataDir: ".data",
			fs: h.fs,
			writeJson: h.writeJson,
			client,
			log: { info: () => {}, warn: () => {}, error: () => {} },
			nowSeconds: 1_784_737_800,
			pipelineConfigVersion: 1,
		};

		await ingestNormalized(opts);
		// scores_stale is global: clearing it now would call the whole instance
		// fresh while another repo is still missing.
		expect(calls).toHaveLength(0);

		await ingestNormalized({ ...opts, filePath: ART_B });
		expect(calls).toHaveLength(1);
	});

	test("an artifact edited after collection is refused", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		// The manifest vouches for bytes, not just a path. Tampering must not be
		// able to certify data that was never collected.
		h.files.set(
			ART_A,
			JSON.stringify({ activities: [activity(999)], unmatched: [] }),
		);
		expect(await ingestNormalized(opts)).toBe(ExitCode.CONTRACT);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("an activity count disagreeing with the manifest is refused", async () => {
		const h = await harness(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		// Same bytes, but the manifest claims a different count: one of the two
		// is wrong and neither can be trusted.
		const m = JSON.parse(h.files.get(MANIFEST_PATH) as string);
		m.scopes[0].artifacts[0].activityCount = 7;
		h.files.set(MANIFEST_PATH, JSON.stringify(m));
		expect(
			await ingestNormalized({
				filePath: ART_A,
				manifestPath: MANIFEST_PATH,
				dataDir: ".data",
				fs: h.fs,
				writeJson: h.writeJson,
				client: okClient(),
				log: { info: () => {}, warn: () => {}, error: () => {} },
				nowSeconds: 1_784_737_800,
				pipelineConfigVersion: 1,
			}),
		).toBe(ExitCode.CONTRACT);
	});

	test("an artifact whose bytes hash correctly but are not JSON", async () => {
		const h = await harness(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		// Digest and count come from the manifest, so make them agree with the
		// corrupt bytes: the JSON parse is then the only thing left to catch it.
		const corrupt = "{ not json";
		const m = JSON.parse(h.files.get(MANIFEST_PATH) as string);
		m.scopes[0].artifacts[0].sha256 = await sha256Hex(corrupt);
		h.files.set(MANIFEST_PATH, JSON.stringify(m));
		h.files.set(ART_A, corrupt);

		expect(
			await ingestNormalized({
				filePath: ART_A,
				manifestPath: MANIFEST_PATH,
				dataDir: ".data",
				fs: h.fs,
				writeJson: h.writeJson,
				client: okClient(),
				log: { info: () => {}, warn: () => {}, error: () => {} },
				nowSeconds: 1_784_737_800,
				pipelineConfigVersion: 1,
			}),
		).toBe(ExitCode.RUNTIME);
	});

	test("a network failure during ingest is a server error", async () => {
		const { h, opts } = await base(manifest(), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const failing = {
			...opts.client,
			async ingest() {
				throw new Error("socket hang up");
			},
		} as PipelineClient;
		expect(await ingestNormalized({ ...opts, client: failing })).toBe(
			ExitCode.SERVER,
		);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("a failing recompute/complete surfaces after the cursor moved", async () => {
		const h = await harness(manifest({ fullRematch: true }), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		const client = {
			...okClient(),
			async recomputeComplete() {
				throw new Error("worker unavailable");
			},
		} as PipelineClient;
		const code = await ingestNormalized({
			filePath: ART_A,
			manifestPath: MANIFEST_PATH,
			dataDir: ".data",
			fs: h.fs,
			writeJson: h.writeJson,
			client,
			log: { info: () => {}, warn: () => {}, error: () => {} },
			nowSeconds: 1_784_737_800,
			pipelineConfigVersion: 1,
		});
		// The data DID land, so the cursor is correct; only stale clearing
		// failed, and the operator must know to retry it.
		expect(code).toBe(ExitCode.SERVER);
		expect(h.files.has(".data/meta/cursor.json")).toBe(true);
	});

	test("an unreadable artifact is a runtime error", async () => {
		const { opts } = await base(manifest(), {});
		expect(await ingestNormalized(opts)).toBe(ExitCode.RUNTIME);
	});

	test("an artifact violating the ingest contract is refused", async () => {
		const { opts } = await base(manifest(), {
			[ART_A]: { activities: [{ type: "nonsense" }], unmatched: [] },
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.CONTRACT);
	});
});

describe("postWithRetry", () => {
	const chunk = { chunkIndex: 0 } as never;
	const silent = { info: () => {}, warn: () => {}, error: () => {} };

	/** Injected so a failing run costs no wall-clock time and delays are observable. */
	function recorder() {
		const delays: number[] = [];
		return {
			delays,
			sleep: async (ms: number) => {
				delays.push(ms);
			},
		};
	}

	test("a first-attempt success neither retries nor sleeps", async () => {
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				return { ok: true };
			},
		} as unknown as PipelineClient;
		const out = await postWithRetry(
			{ client, log: silent, sleep: r.sleep },
			chunk,
		);
		expect(out).toEqual({ response: { ok: true } });
		expect(calls).toBe(1);
		expect(r.delays).toEqual([]);
	});

	test("a 5xx is retried and can succeed on the third attempt", async () => {
		// The cap is 3 attempts, so exactly two backoffs occur. A regression to
		// a single attempt would strand the scope half-ingested.
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				if (calls < 3) {
					throw { status: 503, body: null, message: "HTTP 503" };
				}
				return { ok: true };
			},
		} as unknown as PipelineClient;
		const out = await postWithRetry(
			{ client, log: silent, sleep: r.sleep },
			chunk,
		);
		expect(out).toEqual({ response: { ok: true } });
		expect(calls).toBe(3);
		expect(r.delays).toEqual([100, 200]);
	});

	test("exhausting the attempts reports SERVER, and never sleeps after the last", async () => {
		// 400ms would mean a fourth attempt that never comes.
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				throw { status: 500, body: null, message: "HTTP 500" };
			},
		} as unknown as PipelineClient;
		const out = await postWithRetry(
			{ client, log: silent, sleep: r.sleep },
			chunk,
		);
		expect(calls).toBe(3);
		expect(r.delays).toEqual([100, 200]);
		expect(out).toMatchObject({ code: ExitCode.SERVER });
		expect((out as { error: string }).error).toMatch(/after 3 attempts/);
	});

	test("429 is retried like a 5xx", async () => {
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				if (calls < 2) {
					throw { status: 429, body: null, message: "HTTP 429" };
				}
				return { ok: true };
			},
		} as unknown as PipelineClient;
		await postWithRetry({ client, log: silent, sleep: r.sleep }, chunk);
		expect(calls).toBe(2);
	});

	test("a network failure with no status is retried", async () => {
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				throw new Error("ECONNRESET");
			},
		} as unknown as PipelineClient;
		const out = await postWithRetry(
			{ client, log: silent, sleep: r.sleep },
			chunk,
		);
		expect(calls).toBe(3);
		expect(out).toMatchObject({ code: ExitCode.SERVER });
	});

	test("a 4xx is refused immediately: replaying a rejected body cannot help", async () => {
		const r = recorder();
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				throw { status: 422, body: null, message: "HTTP 422 unprocessable" };
			},
		} as unknown as PipelineClient;
		const out = await postWithRetry(
			{ client, log: silent, sleep: r.sleep },
			chunk,
		);
		expect(calls).toBe(1);
		expect(r.delays).toEqual([]);
		expect(out).toMatchObject({ code: ExitCode.CONTRACT });
		expect((out as { error: string }).error).toMatch(/422/);
	});

	test("without an injected sleep it still backs off for real", async () => {
		// Guards against a default that silently skips the delay entirely.
		let calls = 0;
		const client = {
			async ingest() {
				calls++;
				if (calls < 2) {
					throw { status: 500, body: null, message: "HTTP 500" };
				}
				return { ok: true };
			},
		} as unknown as PipelineClient;
		const started = performance.now();
		await postWithRetry({ client, log: silent }, chunk);
		expect(performance.now() - started).toBeGreaterThanOrEqual(90);
	});
});
