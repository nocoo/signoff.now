/** @signoff/domain — DTO / constants / zod / path helpers / domain functions. */

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
export { dayKey } from "./day-key.js";
export { buildExternalRef } from "./external-ref.js";
export { matchDeveloper } from "./identity.js";
export {
	FIXTURE_FILE_MAX_ACTIVITIES,
	FIXTURE_FILE_MAX_UNMATCHED,
	type FixtureFile,
	fixtureFileSchema,
	INGEST_MAX_ACTIVITIES,
	INGEST_MAX_PAYLOAD_BYTES,
	INGEST_MAX_UNMATCHED,
	type IngestBody,
	type IngestSuccess,
	ingestBodySchema,
	ingestSuccessSchema,
	splitFixtureIntoChunks,
	type UnmatchedIdentity,
	unmatchedIdentitySchema,
} from "./ingest.js";
export {
	cachePath,
	DATA_ROOTS,
	normalizedPath,
	rawPath,
} from "./paths.js";
export {
	adoInstant,
	adoListSchema,
	RAW_SCHEMA_VERSION,
	type RawEnvelope,
	type RawIdentity,
	type RawIteration,
	type RawPr,
	type RawThread,
	type RawWiUpdate,
	type RawWorkItem,
	rawEnvelopeSchema,
	rawIdentitySchema,
	rawIterationSchema,
	rawPrSchema,
	rawThreadSchema,
	rawWiUpdateSchema,
	rawWorkItemSchema,
} from "./raw.js";
export {
	type ActivityWithDayKey,
	aggregateScores,
} from "./score.js";
export {
	type PrTransformInput,
	resolveIdentity,
	type SkipReason,
	type TransformCommon,
	type TransformResult,
	toUnixSeconds,
	transformPullRequests,
	voteComment,
} from "./transform/pr.js";
export type {
	AggregateScores,
	BuildExternalRef,
	DayKey,
	MatchDeveloper,
	ScoreRow,
} from "./types.js";
