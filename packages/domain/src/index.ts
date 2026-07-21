/** @signoff/domain — DTO / constants / zod / path helpers / function type aliases. */

export {
	type Activity,
	activitySchema,
	META_MAX_BYTES,
} from "./activity.js";
export {
	ACTIVITY_TYPES,
	type ActivityType,
	DEFAULT_WEIGHTS,
} from "./constants.js";

export {
	INGEST_MAX_ACTIVITIES,
	INGEST_MAX_PAYLOAD_BYTES,
	INGEST_MAX_UNMATCHED,
	type IngestBody,
	ingestBodySchema,
	type UnmatchedIdentity,
	unmatchedIdentitySchema,
} from "./ingest.js";

export {
	cachePath,
	DATA_ROOTS,
	normalizedPath,
	rawPath,
} from "./paths.js";

export type {
	AggregateScores,
	BuildExternalRef,
	DayKey,
	MatchDeveloper,
	ScoreRow,
} from "./types.js";
