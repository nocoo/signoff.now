/**
 * Collection run manifest and cursor (07 §7).
 *
 * The manifest is what makes "advance the cursor only after everything landed"
 * expressible. A collect run can emit several artifacts; finalizing the first
 * says nothing about the rest, and the fixture files themselves carry no cursor
 * information (06 §6.2 froze that schema as `.strict()`). Binding
 * window → artifacts → watermark in one place is what prevents a partial
 * ingest from advancing past data that never landed.
 */

import { z } from "zod";

export const CURSOR_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;

/** Re-query this far before the cursor; ADO indexing is eventually consistent. */
export const DEFAULT_OVERLAP_SECONDS = 3600;
/** Stop the window short of now, for the same reason. */
export const DEFAULT_SAFETY_LAG_SECONDS = 300;

export const artifactSchema = z
	.object({
		path: z.string().min(1),
		runId: z.string().min(1),
		sha256: z.string().min(1),
		activityCount: z.number().int().nonnegative(),
		status: z.enum(["pending", "complete"]),
	})
	.strict();

export type Artifact = z.infer<typeof artifactSchema>;

export const scopeSchema = z
	.object({
		kind: z.enum(["repo", "project"]),
		id: z.string().min(1),
		field: z.string().min(1),
		/** The committed cursor at collection time; null when never collected. */
		baseCursor: z.string().nullable(),
		/** Lower bound actually queried (baseCursor - overlap, or --since). */
		from: z.string().nullable(),
		/** Upper bound captured BEFORE fetching (07 §7.2). */
		watermark: z.string().min(1),
		/** False when this run's window does not reach back to the cursor. */
		commitEligible: z.boolean(),
		status: z.enum(["pending", "complete", "incomplete"]),
		/** Why the scope is incomplete; blocks the cursor (07 §5). */
		errors: z.array(z.string()),
		artifacts: z.array(artifactSchema),
		/** Requires a recompute/complete call once every artifact lands. */
		fullRematch: z.boolean().optional(),
	})
	.strict();

export type Scope = z.infer<typeof scopeSchema>;

export const manifestSchema = z
	.object({
		schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
		collectRunId: z.string().min(1),
		startedAt: z.number().int().positive(),
		scopes: z.array(scopeSchema),
	})
	.strict();

export type Manifest = z.infer<typeof manifestSchema>;

export const cursorSchema = z
	.object({
		schemaVersion: z.literal(CURSOR_SCHEMA_VERSION),
		byRepo: z.record(
			z.string(),
			z
				.object({
					prsClosedThrough: z.string().min(1),
					lastCollectRunId: z.string().min(1).optional(),
				})
				.strict(),
		),
		byProject: z.record(
			z.string(),
			z
				.object({
					wiChangedThrough: z.string().min(1),
					lastCollectRunId: z.string().min(1).optional(),
				})
				.strict(),
		),
	})
	.strict();

export type Cursor = z.infer<typeof cursorSchema>;

export function emptyCursor(): Cursor {
	return { schemaVersion: CURSOR_SCHEMA_VERSION, byRepo: {}, byProject: {} };
}

/** The committed watermark for a scope, or null if it was never collected. */
export function readCursor(cursor: Cursor, scope: Pick<Scope, "kind" | "id">) {
	if (scope.kind === "repo") {
		return cursor.byRepo[scope.id]?.prsClosedThrough ?? null;
	}
	return cursor.byProject[scope.id]?.wiChangedThrough ?? null;
}

/**
 * May this run's watermark be committed?
 *
 * A run that starts AFTER the committed cursor leaves a hole: the operator
 * asked for `--since 2026-07-20` while the cursor sat at `2026-07-01`, and
 * moving the cursor to the new watermark would skip those three weeks forever
 * with nothing to show it happened (07 §7.1.1).
 */
export function isCommitEligible(
	baseCursor: string | null,
	from: string | null,
): boolean {
	if (baseCursor === null) {
		return true;
	}
	if (from === null) {
		// A full re-collection covers everything by definition.
		return true;
	}
	const fromMs = Date.parse(from);
	const baseMs = Date.parse(baseCursor);
	if (!Number.isFinite(fromMs) || !Number.isFinite(baseMs)) {
		return false;
	}
	return fromMs <= baseMs;
}

/** A scope may commit only when it is whole. */
export function isScopeCommittable(scope: Scope): boolean {
	return (
		scope.status !== "incomplete" &&
		scope.commitEligible &&
		scope.errors.length === 0 &&
		scope.artifacts.length > 0 &&
		scope.artifacts.every((a) => a.status === "complete")
	);
}

/** Apply a committable scope's watermark. Returns the cursor unchanged if not. */
export function commitScope(
	cursor: Cursor,
	scope: Scope,
	collectRunId: string,
): Cursor {
	if (!isScopeCommittable(scope)) {
		return cursor;
	}
	if (scope.kind === "repo") {
		return {
			...cursor,
			byRepo: {
				...cursor.byRepo,
				[scope.id]: {
					prsClosedThrough: scope.watermark,
					lastCollectRunId: collectRunId,
				},
			},
		};
	}
	return {
		...cursor,
		byProject: {
			...cursor.byProject,
			[scope.id]: {
				wiChangedThrough: scope.watermark,
				lastCollectRunId: collectRunId,
			},
		},
	};
}

/**
 * Compute the window to query.
 *
 * `watermark` is passed in rather than read from a clock so the caller captures
 * it once, BEFORE fetching. Deriving it afterwards from the newest row seen
 * would silently skip anything written while pagination was in flight.
 */
export function planWindow(opts: {
	baseCursor: string | null;
	nowSeconds: number;
	since?: string | null;
	full?: boolean;
	overlapSeconds?: number;
	safetyLagSeconds?: number;
}): { from: string | null; watermark: string; commitEligible: boolean } {
	const lag = opts.safetyLagSeconds ?? DEFAULT_SAFETY_LAG_SECONDS;
	const overlap = opts.overlapSeconds ?? DEFAULT_OVERLAP_SECONDS;
	const watermark = new Date((opts.nowSeconds - lag) * 1000).toISOString();

	if (opts.full) {
		return { from: null, watermark, commitEligible: true };
	}

	if (opts.since) {
		return {
			from: opts.since,
			watermark,
			commitEligible: isCommitEligible(opts.baseCursor, opts.since),
		};
	}

	if (opts.baseCursor === null) {
		return { from: null, watermark, commitEligible: true };
	}

	const baseMs = Date.parse(opts.baseCursor);
	if (!Number.isFinite(baseMs)) {
		// A corrupt cursor must not be silently treated as "collect everything
		// from now on" — that would skip history without saying so.
		return { from: null, watermark, commitEligible: true };
	}
	const from = new Date(baseMs - overlap * 1000).toISOString();
	return { from, watermark, commitEligible: true };
}

/** Find the scope that owns an artifact path (07 §7.1.2). */
export function findArtifactScope(
	manifest: Manifest,
	path: string,
): { scope: Scope; artifact: Artifact } | null {
	for (const scope of manifest.scopes) {
		const artifact = scope.artifacts.find((a) => a.path === path);
		if (artifact) {
			return { scope, artifact };
		}
	}
	return null;
}

/** Mark one artifact complete, returning a new manifest. */
export function markArtifactComplete(
	manifest: Manifest,
	path: string,
): Manifest {
	return {
		...manifest,
		scopes: manifest.scopes.map((scope) => {
			if (!scope.artifacts.some((a) => a.path === path)) {
				return scope;
			}
			const artifacts = scope.artifacts.map((a) =>
				a.path === path ? { ...a, status: "complete" as const } : a,
			);
			const allDone = artifacts.every((a) => a.status === "complete");
			return {
				...scope,
				artifacts,
				status:
					scope.status === "incomplete"
						? scope.status
						: allDone
							? ("complete" as const)
							: scope.status,
			};
		}),
	};
}

/** Mark a scope incomplete. Incomplete scopes never advance the cursor. */
export function markScopeIncomplete(
	manifest: Manifest,
	scopeId: string,
	reason: string,
): Manifest {
	return {
		...manifest,
		scopes: manifest.scopes.map((s) =>
			s.id === scopeId
				? { ...s, status: "incomplete" as const, errors: [...s.errors, reason] }
				: s,
		),
	};
}
