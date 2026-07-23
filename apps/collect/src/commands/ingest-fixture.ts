import {
	fixtureFileSchema,
	type IngestBody,
	ingestSuccessSchema,
	splitFixtureIntoChunks,
} from "@signoff/domain";
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

	for (const chunk of chunks) {
		const err = await postChunk(opts.client, chunk, opts.log);
		if (err !== null) {
			return err;
		}
	}

	if (opts.completeRematch && parsed.data.runMeta.mode === "full_rematch") {
		try {
			await opts.client.recomputeComplete({
				runId: parsed.data.runId,
				pipelineConfigVersion: parsed.data.pipelineConfigVersion,
				ok: true,
			});
			opts.log.info("recompute/complete ok — scores_stale cleared");
		} catch (e) {
			if (isPipelineClientError(e)) {
				opts.log.error(`recompute/complete HTTP ${e.status}: ${e.message}`);
				return e.status === 409 ? ExitCode.CONTRACT : ExitCode.RUNTIME;
			}
			opts.log.error(
				e instanceof Error ? e.message : "recompute/complete failed",
			);
			return ExitCode.SERVER;
		}
	} else if (
		opts.completeRematch &&
		parsed.data.runMeta.mode !== "full_rematch"
	) {
		opts.log.info(
			"--complete-rematch ignored (runMeta.mode is not full_rematch)",
		);
	}

	opts.log.info("ingest fixture complete");
	return ExitCode.OK;
}
