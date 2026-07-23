import { z } from "zod";
import { activitySchema } from "./activity.js";

/** ULID (Crockford base32, 26 chars) or UUID v4. */
const RUN_ID_RE =
	/^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const unmatchedIdentitySchema = z
	.object({
		uniqueName: z.string().min(1),
		sampleOrg: z.string().optional(),
		sampleProject: z.string().optional(),
		sampleContext: z.string().optional(),
	})
	.strict();

export const ingestBodySchema = z
	.object({
		pipelineConfigVersion: z.number().int().positive(),
		runId: z.string().regex(RUN_ID_RE),
		chunkIndex: z.number().int().nonnegative(),
		isFinalChunk: z.boolean(),
		runMeta: z
			.object({
				startedAt: z.number().int().positive(),
				source: z.enum(["ado", "fixture"]),
				windowFrom: z.string().regex(DATE_RE),
				windowTo: z.string().regex(DATE_RE),
				mode: z.enum(["incremental", "full_rematch"]),
			})
			.strict(),
		// §5.2 hard caps (Paid plan only)
		activities: z.array(activitySchema).max(10),
		unmatchedIdentities: z.array(unmatchedIdentitySchema).max(10),
	})
	.strict();

export type IngestBody = z.infer<typeof ingestBodySchema>;
export type UnmatchedIdentity = z.infer<typeof unmatchedIdentitySchema>;

/** Max payload bytes for a single ingest request (§5.2). */
export const INGEST_MAX_PAYLOAD_BYTES = 512 * 1024;

/** Max activities / unmatched per chunk (§5.2). */
export const INGEST_MAX_ACTIVITIES = 10;
export const INGEST_MAX_UNMATCHED = 10;

/** File-level fixture (06 §6.2): may exceed per-chunk caps; CLI slices then re-validates. */
export const FIXTURE_FILE_MAX_ACTIVITIES = 5000;
export const FIXTURE_FILE_MAX_UNMATCHED = 5000;

export const fixtureFileSchema = z
	.object({
		pipelineConfigVersion: z.number().int().positive(),
		runId: z.string().regex(RUN_ID_RE),
		chunkIndex: z.literal(0),
		isFinalChunk: z.literal(true),
		runMeta: z
			.object({
				startedAt: z.number().int().positive(),
				source: z.enum(["ado", "fixture"]),
				windowFrom: z.string().regex(DATE_RE),
				windowTo: z.string().regex(DATE_RE),
				mode: z.enum(["incremental", "full_rematch"]),
			})
			.strict(),
		activities: z.array(activitySchema).max(FIXTURE_FILE_MAX_ACTIVITIES),
		unmatchedIdentities: z
			.array(unmatchedIdentitySchema)
			.max(FIXTURE_FILE_MAX_UNMATCHED),
	})
	.strict();

export type FixtureFile = z.infer<typeof fixtureFileSchema>;

/** Slice a fixture file into ingestBodySchema-valid chunks (size ≤ 10). */
export function splitFixtureIntoChunks(file: FixtureFile): IngestBody[] {
	const n = Math.max(
		1,
		Math.ceil(file.activities.length / INGEST_MAX_ACTIVITIES),
		Math.ceil(file.unmatchedIdentities.length / INGEST_MAX_UNMATCHED),
	);
	const chunks: IngestBody[] = [];
	for (let i = 0; i < n; i++) {
		const activities = file.activities.slice(
			i * INGEST_MAX_ACTIVITIES,
			(i + 1) * INGEST_MAX_ACTIVITIES,
		);
		const unmatchedIdentities = file.unmatchedIdentities.slice(
			i * INGEST_MAX_UNMATCHED,
			(i + 1) * INGEST_MAX_UNMATCHED,
		);
		const body: IngestBody = {
			pipelineConfigVersion: file.pipelineConfigVersion,
			runId: file.runId,
			chunkIndex: i,
			isFinalChunk: i === n - 1,
			runMeta: file.runMeta,
			activities,
			unmatchedIdentities,
		};
		// Body is constructed from already-validated fixture pieces; schema still enforced.
		chunks.push(ingestBodySchema.parse(body));
	}
	return chunks;
}

/** 05 success response shape for CLI 200 validation. */
export const ingestSuccessSchema = z
	.object({
		runId: z.string().min(1),
		chunkIndex: z.number().int().nonnegative(),
		pipelineConfigVersion: z.number().int().positive(),
		activities: z.object({
			received: z.number().int().nonnegative(),
			upserted: z.number().int().nonnegative(),
			rejected: z.number().int().nonnegative(),
		}),
		scores: z.object({
			affectedDevDays: z.number().int().nonnegative(),
			recomputed: z.number().int().nonnegative(),
		}),
		unmatched: z.object({
			upserted: z.number().int().nonnegative(),
		}),
		finalized: z.boolean(),
	})
	.strict();

export type IngestSuccess = z.infer<typeof ingestSuccessSchema>;
