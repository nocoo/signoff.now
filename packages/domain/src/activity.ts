import { z } from "zod";

const prCore = z
	.object({
		prRepoGuid: z.string().uuid(),
		prId: z.number().int().positive(),
	})
	.strict();

const prVoteIds = z
	.object({
		prRepoGuid: z.string().uuid(),
		prId: z.number().int().positive(),
		voterIdentityId: z.string().min(1),
		threadId: z.number().int().positive(),
		commentId: z.number().int().nonnegative(),
	})
	.strict();

const prActiveIds = z
	.object({
		prRepoGuid: z.string().uuid(),
		prId: z.number().int().positive(),
		iterationId: z.number().int().positive(),
	})
	.strict();

const wiCore = z
	.object({
		projectGuid: z.string().uuid(),
		wiId: z.number().int().positive(),
	})
	.strict();

const wiUpdateIds = z
	.object({
		projectGuid: z.string().uuid(),
		wiId: z.number().int().positive(),
		revisionId: z.number().int().positive(),
	})
	.strict();

/** §5.2: meta serialized JSON ≤ 4 KiB per activity. */
export const META_MAX_BYTES = 4 * 1024;

const metaSchema = z
	.record(z.string(), z.unknown())
	.optional()
	.superRefine((val, ctx) => {
		if (val === undefined) {
			return;
		}
		const bytes = new TextEncoder().encode(JSON.stringify(val)).length;
		if (bytes > META_MAX_BYTES) {
			ctx.addIssue({
				code: "custom",
				message: `meta exceeds ${META_MAX_BYTES} bytes (got ${bytes})`,
			});
		}
	});

/**
 * Last epoch second inside year 9999 — the range SQLite's `date()` accepts.
 * `9999-12-31T23:59:59Z`.
 */
export const MAX_OCCURRED_AT = 253_402_300_799;

const activityBase = {
	// Bounded above, not merely positive. An unbounded epoch second yields day
	// keys outside SQLite's `date()` range (253402300800 → `10000-01-01`), and
	// the Dashboard's union guard then reads that as a corrupt entry and blanks
	// the window. Refusing it here says what is actually wrong: the timestamp.
	occurredAt: z
		.number()
		.int()
		.positive()
		.max(MAX_OCCURRED_AT, "occurredAt is beyond year 9999"),
	provider: z.literal("ado"),
	org: z.string().min(1),
	project: z.string().min(1),
	developerId: z.string().min(1),
	matchedUniqueName: z.string().min(1),
	meta: metaSchema,
} as const;

/** Discriminated union by `type`; rejects forbidden fields via .strict(). */
export const activitySchema = z.discriminatedUnion("type", [
	z
		.object({
			...activityBase,
			type: z.literal("pr.merged"),
			repoId: z.string().min(1),
			sourceIds: prCore,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("pr.closed"),
			repoId: z.string().min(1),
			sourceIds: prCore,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("pr.created"),
			repoId: z.string().min(1),
			sourceIds: prCore,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("pr.vote"),
			repoId: z.string().min(1),
			sourceIds: prVoteIds,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("pr.active"),
			repoId: z.string().min(1),
			sourceIds: prActiveIds,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("wi.created"),
			repoId: z.null(),
			sourceIds: wiCore,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("wi.closed"),
			repoId: z.null(),
			sourceIds: wiCore,
		})
		.strict(),
	z
		.object({
			...activityBase,
			type: z.literal("wi.updated"),
			repoId: z.null(),
			sourceIds: wiUpdateIds,
		})
		.strict(),
]);

export type Activity = z.infer<typeof activitySchema>;
