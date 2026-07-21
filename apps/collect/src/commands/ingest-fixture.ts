import { ingestBodySchema } from "@signoff/domain";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";

/**
 * STUB (05): read fixture JSON, validate with ingestBodySchema, print summary.
 * Does NOT POST to Worker — 06 will wire real ingest.
 */
export async function ingestFixture(opts: {
	filePath: string;
	readFile: (path: string) => Promise<string>;
	log: Logger;
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

	const parsed = ingestBodySchema.safeParse(json);
	if (!parsed.success) {
		opts.log.error(`fixture failed ingestBodySchema: ${parsed.error.message}`);
		return ExitCode.CONTRACT;
	}

	const body = parsed.data;
	opts.log.info("ingest fixture STUB (will not POST — see docs/06)");
	opts.log.info(`runId=${body.runId} chunkIndex=${body.chunkIndex}`);
	opts.log.info(
		`pipelineConfigVersion=${body.pipelineConfigVersion} isFinalChunk=${body.isFinalChunk}`,
	);
	opts.log.info(
		`activities=${body.activities.length} unmatched=${body.unmatchedIdentities.length}`,
	);
	const preview = body.activities.slice(0, 3);
	for (const [i, a] of preview.entries()) {
		opts.log.info(`  [${i}] ${a.type} dev=${a.developerId} at=${a.occurredAt}`);
	}
	if (body.activities.length > 3) {
		opts.log.info(`  … and ${body.activities.length - 3} more`);
	}
	opts.log.info("exit 0 — no HTTP request sent");
	return ExitCode.OK;
}
