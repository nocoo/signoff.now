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
	type Artifact,
	artifactSchema,
	CURSOR_SCHEMA_VERSION,
	type Cursor,
	commitScope,
	cursorSchema,
	DEFAULT_OVERLAP_SECONDS,
	DEFAULT_SAFETY_LAG_SECONDS,
	emptyCursor,
	findArtifactScope,
	isCommitEligible,
	isScopeCommittable,
	MANIFEST_SCHEMA_VERSION,
	type Manifest,
	manifestSchema,
	markArtifactComplete,
	markScopeIncomplete,
	missingRematchScopes,
	planWindow,
	readCursor,
	rematchUniverse,
	type Scope,
	scopeSchema,
} from "./manifest.js";
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
export {
	isClosingRevision,
	transformWorkItems,
	type WiTransformInput,
} from "./transform/wi.js";
export type {
	AggregateScores,
	BuildExternalRef,
	DayKey,
	MatchDeveloper,
	ScoreRow,
} from "./types.js";
