import { describe, expect, test } from "bun:test";
import type { Manifest } from "@signoff/domain";
import type { FsLike } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { ingestNormalized, verifyIngestResponse } from "./ingest-normalized.ts";

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

function harness(m: Manifest, artifacts: Record<string, unknown>) {
	const files = new Map<string, string>([
		[MANIFEST_PATH, JSON.stringify(m)],
		...Object.entries(artifacts).map(
			([p, v]) => [p, JSON.stringify(v)] as [string, string],
		),
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

const base = (m: Manifest, artifacts: Record<string, unknown>) => {
	const h = harness(m, artifacts);
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
		const { h, opts } = base(manifest(), {
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
		const { h, opts } = base(m, {
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
		const { h, opts } = base(manifest({ commitEligible: false }), {
			[ART_A]: { activities: [activity(1)], unmatched: [] },
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.OK);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("an incomplete scope refuses to ingest at all", async () => {
		const { h, opts } = base(
			manifest({ status: "incomplete", errors: ["page gap"] }),
			{ [ART_A]: { activities: [activity(1)], unmatched: [] } },
		);
		expect(await ingestNormalized(opts)).toBe(ExitCode.CONTRACT);
		expect(h.files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("a file the manifest does not list is refused", async () => {
		const { opts } = base(manifest(), {
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
		const { opts } = base(manifest(), {
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
		const { h, opts } = base(manifest(), {
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
		const { h, opts } = base(manifest(), {
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
		const { h, opts } = base(manifest(), {
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

	test("an unreadable artifact is a runtime error", async () => {
		const { opts } = base(manifest(), {});
		expect(await ingestNormalized(opts)).toBe(ExitCode.RUNTIME);
	});

	test("an artifact violating the ingest contract is refused", async () => {
		const { opts } = base(manifest(), {
			[ART_A]: { activities: [{ type: "nonsense" }], unmatched: [] },
		});
		expect(await ingestNormalized(opts)).toBe(ExitCode.CONTRACT);
	});
});
