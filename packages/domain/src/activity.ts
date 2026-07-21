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

const activityBase = {
	occurredAt: z.number().int().positive(),
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
