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
