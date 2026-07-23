import {
	fixtureFileSchema,
	type IngestBody,
	ingestSuccessSchema,
	splitFixtureIntoChunks,
} from "@signoff/domain";
import {
	type FsLike,
	readBootstrapCache,
	writeBootstrapCache,
} from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";
import {
	isPipelineClientError,
	type PipelineClient,
} from "../pipeline/client.ts";

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function pullBootstrapCache(
	client: PipelineClient,
	fs: FsLike,
	dataDir: string,
	log: Logger,
): Promise<number | null> {
	try {
		const snap = await client.bootstrap();
		await writeBootstrapCache(fs, dataDir, snap);
		log.info(
			`settings pull ok: pipelineConfigVersion=${snap.settings.pipelineConfigVersion}`,
		);
		return null;
	} catch (e) {
		if (isPipelineClientError(e)) {
			log.error(`bootstrap failed: HTTP ${e.status}`);
			return e.status >= 500 ? ExitCode.SERVER : ExitCode.CONTRACT;
		}
		log.error(e instanceof Error ? e.message : "bootstrap pull failed");
		return ExitCode.SERVER;
	}
}

async function precheckCacheVersion(
	fs: FsLike,
	dataDir: string,
	fixtureVersion: number,
	log: Logger,
): Promise<number | null> {
	const cache = await readBootstrapCache(fs, dataDir);
	if (!cache) {
		log.error(
			"no bootstrap cache — run `signoff settings pull` or `ingest fixture --pull`",
		);
		return ExitCode.CONTRACT;
	}
	const cachedVer = cache.settings.pipelineConfigVersion;
	if (cachedVer !== fixtureVersion) {
		log.error(
			`fixture pipelineConfigVersion=${fixtureVersion} != cache=${cachedVer}; pull settings or fix fixture`,
		);
		return ExitCode.CONTRACT;
	}
	log.info(`cache version precheck ok (v${cachedVer})`);
	return null;
}

async function maybeCompleteRematch(
	client: PipelineClient,
	fixture: {
		runId: string;
		pipelineConfigVersion: number;
		runMeta: { mode: string };
	},
	completeRematch: boolean | undefined,
	log: Logger,
): Promise<number | null> {
	if (!completeRematch) {
		return null;
	}
	if (fixture.runMeta.mode !== "full_rematch") {
		log.info("--complete-rematch ignored (runMeta.mode is not full_rematch)");
		return null;
	}
	try {
		await client.recomputeComplete({
			runId: fixture.runId,
			pipelineConfigVersion: fixture.pipelineConfigVersion,
			ok: true,
		});
		log.info("recompute/complete ok — scores_stale cleared");
		return null;
	} catch (e) {
		if (isPipelineClientError(e)) {
			log.error(`recompute/complete HTTP ${e.status}: ${e.message}`);
			return e.status === 409 ? ExitCode.CONTRACT : ExitCode.RUNTIME;
		}
		log.error(e instanceof Error ? e.message : "recompute/complete failed");
		return ExitCode.SERVER;
	}
}

async function postChunk(
	client: PipelineClient,
	chunk: IngestBody,
	log: Logger,
): Promise<number | null> {
	let attempt = 0;
	for (;;) {
		attempt++;
		try {
			const res = await client.ingest(chunk);
			const ok = ingestSuccessSchema.safeParse(res);
			if (!ok.success) {
				log.error(`ingest 200 body failed schema: ${ok.error.message}`);
				return ExitCode.CONTRACT;
			}
			log.info(
				`chunk ${chunk.chunkIndex} ok upserted=${ok.data.activities.upserted} finalized=${ok.data.finalized}`,
			);
			return null;
		} catch (e) {
			if (isPipelineClientError(e)) {
				if (e.status === 409) {
					log.error(
						`409 version/chunk conflict: ${e.message}; pull settings and new runId`,
					);
					return ExitCode.CONTRACT;
				}
				if (e.status >= 400 && e.status < 500) {
					log.error(`ingest HTTP ${e.status}: ${e.message}`);
					return e.status === 422 ? ExitCode.CONTRACT : ExitCode.RUNTIME;
				}
				if (attempt >= MAX_RETRIES) {
					log.error(`ingest 5xx exhausted: ${e.message}`);
					return ExitCode.SERVER;
				}
				const backoff = 100 * 2 ** (attempt - 1);
				log.info(
					`retry chunk ${chunk.chunkIndex} attempt ${attempt} backoff=${backoff}ms`,
				);
				await sleep(backoff);
				continue;
			}
			if (attempt >= MAX_RETRIES) {
				log.error(e instanceof Error ? e.message : "ingest network failed");
				return ExitCode.SERVER;
			}
			const backoff = 100 * 2 ** (attempt - 1);
			log.info(
				`retry network chunk ${chunk.chunkIndex} attempt ${attempt} backoff=${backoff}ms`,
			);
			await sleep(backoff);
		}
	}
}

/**
 * 06: read fixture → fixtureFileSchema → chunk → real POST ingest.
 */
export async function ingestFixture(opts: {
	filePath: string;
	readFile: (path: string) => Promise<string>;
	log: Logger;
	client?: PipelineClient;
	/** When false, only validate + print (no HTTP). Default true if client provided. */
	send?: boolean;
	/** After successful full_rematch run, call recompute/complete to clear stale. */
	completeRematch?: boolean;
	/** Pull bootstrap before version precheck (06 §6.2 step 2). */
	pull?: boolean;
	/** Local data dir for bootstrap cache (required when send && !dry). */
	dataDir?: string;
	fs?: FsLike;
}): Promise<number> {
	let raw: string;
	try {
		raw = await opts.readFile(opts.filePath);
	} catch (e) {
		opts.log.error(
			e instanceof Error ? e.message : `cannot read ${opts.filePath}`,
		);
		return ExitCode.RUNTIME;
	}

	let json: unknown;
	try {
		json = JSON.parse(raw) as unknown;
	} catch {
		opts.log.error("fixture is not valid JSON");
		return ExitCode.CONTRACT;
	}

	const parsed = fixtureFileSchema.safeParse(json);
	if (!parsed.success) {
		opts.log.error(`fixture failed fixtureFileSchema: ${parsed.error.message}`);
		return ExitCode.CONTRACT;
	}

	let chunks: IngestBody[];
	try {
		chunks = splitFixtureIntoChunks(parsed.data);
	} catch (e) {
		opts.log.error(e instanceof Error ? e.message : String(e));
		return ExitCode.CONTRACT;
	}

	opts.log.info(
		`ingest fixture runId=${parsed.data.runId} chunks=${chunks.length} activities=${parsed.data.activities.length}`,
	);
	const preview = parsed.data.activities.slice(0, 3);
	for (const [i, a] of preview.entries()) {
		opts.log.info(`  [${i}] ${a.type} dev=${a.developerId} at=${a.occurredAt}`);
	}
	if (parsed.data.activities.length > 3) {
		opts.log.info(`  … and ${parsed.data.activities.length - 3} more`);
	}

	const shouldSend = opts.send ?? Boolean(opts.client);
	if (!shouldSend || !opts.client) {
		opts.log.info("dry validate only — no HTTP (pass client to POST)");
		return ExitCode.OK;
	}

	// 06: optional --pull then local cache pipelineConfigVersion must match fixture.
	if (opts.pull) {
		if (!opts.fs || !opts.dataDir) {
			opts.log.error("--pull requires local data dir");
			return ExitCode.RUNTIME;
		}
		const pullErr = await pullBootstrapCache(
			opts.client,
			opts.fs,
			opts.dataDir,
			opts.log,
		);
		if (pullErr !== null) {
			return pullErr;
		}
	}

	if (opts.fs && opts.dataDir) {
		const verErr = await precheckCacheVersion(
			opts.fs,
			opts.dataDir,
			parsed.data.pipelineConfigVersion,
			opts.log,
		);
		if (verErr !== null) {
			return verErr;
		}
	}

	for (const chunk of chunks) {
		const err = await postChunk(opts.client, chunk, opts.log);
		if (err !== null) {
			return err;
		}
	}

	const rematchErr = await maybeCompleteRematch(
		opts.client,
		parsed.data,
		opts.completeRematch,
		opts.log,
	);
	if (rematchErr !== null) {
		return rematchErr;
	}

	opts.log.info("ingest fixture complete");
	return ExitCode.OK;
}
