/**
 * `signoff ingest normalized <file>` — send a collect artifact to D1 and, only
 * once the whole scope has landed, advance the cursor (07 §7.1.2, §7.5).
 *
 * The cursor commit is the reason this command exists separately from
 * `collect`. Collection cannot know whether data reached D1; ingest can, but
 * only for the artifact it just sent. A scope with three artifacts is not
 * covered until all three are `complete`, so the manifest — not this call — is
 * the source of truth about what may be committed.
 */

import {
	type Cursor,
	commitScope,
	cursorSchema,
	emptyCursor,
	findArtifactScope,
	type IngestBody,
	ingestSuccessSchema,
	isScopeCommittable,
	type Manifest,
	manifestSchema,
	markArtifactComplete,
	readCursor,
	splitFixtureIntoChunks,
} from "@signoff/domain";
import { sha256Hex } from "../ado/storage.ts";
import type { FsLike } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";
import {
	isPipelineClientError,
	type PipelineClient,
} from "../pipeline/client.ts";

export type IngestNormalizedOptions = {
	filePath: string;
	manifestPath: string;
	dataDir: string;
	fs: FsLike;
	writeJson: (path: string, value: unknown) => Promise<void>;
	client: PipelineClient;
	log: Logger;
	nowSeconds: number;
	pipelineConfigVersion: number;
};

/**
 * Verify the server did what we asked, field by field (07 §7.5).
 *
 * Checking only the response *shape* would let a mismatched run id or a
 * partially rejected chunk count as success, and the cursor would then advance
 * past data the server never stored.
 */
export function verifyIngestResponse(
	response: unknown,
	sent: IngestBody,
): string | null {
	const parsed = ingestSuccessSchema.safeParse(response);
	if (!parsed.success) {
		return `ingest 200 body failed schema: ${parsed.error.message}`;
	}
	const body = parsed.data;
	if (body.runId !== sent.runId) {
		return `response runId ${body.runId} does not match request ${sent.runId}`;
	}
	if (body.chunkIndex !== sent.chunkIndex) {
		return `response chunkIndex ${body.chunkIndex} does not match request ${sent.chunkIndex}`;
	}
	if (body.pipelineConfigVersion !== sent.pipelineConfigVersion) {
		return `response config version ${body.pipelineConfigVersion} does not match request ${sent.pipelineConfigVersion}`;
	}
	if (body.activities.rejected !== 0) {
		return `server rejected ${body.activities.rejected} activities`;
	}
	if (body.finalized !== sent.isFinalChunk) {
		return sent.isFinalChunk
			? "final chunk did not finalize the run"
			: "an intermediate chunk finalized the run";
	}
	return null;
}

async function readJson<T>(
	fs: FsLike,
	path: string,
	parse: (v: unknown) => T,
): Promise<T | null> {
	try {
		return parse(JSON.parse(await fs.readFile(path)));
	} catch {
		return null;
	}
}

export async function ingestNormalized(
	opts: IngestNormalizedOptions,
): Promise<number> {
	const manifest = await readJson<Manifest>(opts.fs, opts.manifestPath, (v) =>
		manifestSchema.parse(v),
	);
	if (!manifest) {
		opts.log.error(`cannot read manifest: ${opts.manifestPath}`);
		return ExitCode.CONTRACT;
	}

	// A file the run did not produce must never advance a cursor, so refuse
	// anything the manifest does not vouch for.
	const owned = findArtifactScope(manifest, opts.filePath);
	if (!owned) {
		opts.log.error(
			`${opts.filePath} is not listed in ${opts.manifestPath}; run \`signoff collect\` first`,
		);
		return ExitCode.CONTRACT;
	}
	const { scope, artifact } = owned;

	if (scope.status === "incomplete") {
		opts.log.error(
			`scope ${scope.kind}:${scope.id} is incomplete (${scope.errors[0]}); re-collect before ingesting`,
		);
		return ExitCode.CONTRACT;
	}

	let rawArtifact: string;
	try {
		rawArtifact = await opts.fs.readFile(opts.filePath);
	} catch {
		opts.log.error(`cannot read artifact: ${opts.filePath}`);
		return ExitCode.RUNTIME;
	}

	// The manifest vouches for specific BYTES, not just a path. Without this the
	// file could be edited after collection and the cursor would still advance,
	// certifying data that was never collected.
	if ((await sha256Hex(rawArtifact)) !== artifact.sha256) {
		opts.log.error(
			`${opts.filePath} does not match the digest recorded at collection; re-collect rather than ingest it`,
		);
		return ExitCode.CONTRACT;
	}

	let body: { activities: unknown[]; unmatched: unknown[] };
	try {
		body = JSON.parse(rawArtifact) as typeof body;
	} catch {
		opts.log.error(`artifact is not valid JSON: ${opts.filePath}`);
		return ExitCode.RUNTIME;
	}

	if (body.activities.length !== artifact.activityCount) {
		opts.log.error(
			`artifact has ${body.activities.length} activities but the manifest recorded ${artifact.activityCount}`,
		);
		return ExitCode.CONTRACT;
	}

	let chunks: IngestBody[];
	try {
		chunks = splitFixtureIntoChunks({
			pipelineConfigVersion: opts.pipelineConfigVersion,
			runId: artifact.runId,
			chunkIndex: 0,
			isFinalChunk: true,
			runMeta: {
				startedAt: manifest.startedAt,
				source: "ado",
				windowFrom: (scope.from ?? scope.watermark).slice(0, 10),
				windowTo: scope.watermark.slice(0, 10),
				mode: "incremental",
			},
			activities: body.activities,
			unmatchedIdentities: body.unmatched,
		} as never);
	} catch (e) {
		opts.log.error(
			e instanceof Error ? e.message : "artifact failed the ingest contract",
		);
		return ExitCode.CONTRACT;
	}

	for (const chunk of chunks) {
		let response: unknown;
		try {
			response = await opts.client.ingest(chunk);
		} catch (e) {
			if (isPipelineClientError(e)) {
				opts.log.error(`ingest HTTP ${e.status}: ${e.message}`);
				return e.status >= 500 ? ExitCode.SERVER : ExitCode.CONTRACT;
			}
			opts.log.error(e instanceof Error ? e.message : "ingest failed");
			return ExitCode.SERVER;
		}
		const problem = verifyIngestResponse(response, chunk);
		if (problem) {
			opts.log.error(problem);
			return ExitCode.CONTRACT;
		}
		opts.log.info(`chunk ${chunk.chunkIndex}/${chunks.length - 1} ok`);
	}

	// Manifest first: it is the record consulted on crash recovery, so the
	// cursor must never be ahead of it.
	const updated = markArtifactComplete(manifest, opts.filePath);
	await opts.writeJson(opts.manifestPath, updated);

	const after = findArtifactScope(updated, opts.filePath)?.scope;
	if (!after || !isScopeCommittable(after)) {
		const pending = after?.artifacts.filter(
			(a) => a.status !== "complete",
		).length;
		opts.log.info(
			after && !after.commitEligible
				? `artifact ingested; cursor NOT advanced because this run starts after the committed cursor`
				: `artifact ingested; ${pending ?? "some"} artifact(s) still pending, cursor NOT advanced`,
		);
		return ExitCode.OK;
	}

	const cursorPath = `${opts.dataDir}/meta/cursor.json`;
	const current =
		(await readJson<Cursor>(opts.fs, cursorPath, (v) =>
			cursorSchema.parse(v),
		)) ?? emptyCursor();
	const next = commitScope(current, after, manifest.collectRunId);
	if (next === current) {
		opts.log.info("cursor already at or ahead of this watermark; not moved");
		return ExitCode.OK;
	}
	await opts.writeJson(cursorPath, next);
	opts.log.info(
		`scope ${after.kind}:${after.id} complete; cursor → ${readCursor(next, after)}`,
	);
	return ExitCode.OK;
}
