/**
 * Zod schemas for raw Azure DevOps payloads (07 §5).
 *
 * Only the fields the transform actually reads are validated; everything else
 * passes through, so ADO adding a field never breaks collection. What IS
 * validated is validated strictly — a missing timestamp or identity is the
 * difference between a correct Activity and a fabricated one (01 §6.2).
 */

import { z } from "zod";

/** ISO 8601 instant as ADO returns it, e.g. 2026-07-26T21:48:35.6338351Z */
export const adoInstant = z
	.string()
	.min(1)
	.refine((s) => Number.isFinite(Date.parse(s)), {
		message: "not a parseable ISO 8601 instant",
	});

/**
 * An ADO identity. `uniqueName` is an email for humans and a
 * `vstfs:///…` descriptor for groups; `isContainer` marks the latter.
 * `id` is the stable GUID — external_ref uses it, never the email (02 §5.1).
 */
export const rawIdentitySchema = z
	.object({
		id: z.string().min(1).optional(),
		// Live payloads include identities with an empty uniqueName (deleted or
		// system accounts). Accept them here; the transform skips anything that
		// is not a matchable email (07 §6.4 rule 3).
		uniqueName: z.string().nullish(),
		displayName: z.string().nullish(),
		isContainer: z.boolean().nullish(),
	})
	.passthrough();

export type RawIdentity = z.infer<typeof rawIdentitySchema>;

export const rawPrSchema = z
	.object({
		pullRequestId: z.number().int().positive(),
		status: z.string().min(1),
		creationDate: adoInstant,
		closedDate: adoInstant.nullish(),
		mergeStatus: z.string().nullish(),
		isDraft: z.boolean().nullish(),
		lastMergeCommit: z
			.object({ commitId: z.string().min(1) })
			.passthrough()
			.optional(),
		createdBy: rawIdentitySchema,
		repository: z
			.object({
				id: z.string().uuid(),
				name: z.string().nullish(),
				project: z
					.object({ id: z.string().uuid(), name: z.string().nullish() })
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough();

export type RawPr = z.infer<typeof rawPrSchema>;

export const rawCommentSchema = z
	.object({
		id: z.number().int().nonnegative(),
		publishedDate: adoInstant.optional(),
		// Live payloads carry an explicit null here, not just an absent key.
		commentType: z.string().nullish(),
		author: rawIdentitySchema.optional(),
	})
	.passthrough();

/** `properties` values are `{ "$type": "System.String", "$value": … }`. */
const propValue = z
	.object({ $value: z.union([z.string(), z.number()]).optional() })
	.passthrough();

export const rawThreadSchema = z
	.object({
		id: z.number().int().positive(),
		publishedDate: adoInstant.optional(),
		comments: z.array(rawCommentSchema).optional(),
		properties: z.record(z.string(), propValue).nullish(),
	})
	.passthrough();

export type RawThread = z.infer<typeof rawThreadSchema>;

export const rawIterationSchema = z
	.object({
		id: z.number().int().positive(),
		createdDate: adoInstant.nullish(),
		updatedDate: adoInstant.nullish(),
		author: rawIdentitySchema.optional(),
	})
	.passthrough();

export type RawIteration = z.infer<typeof rawIterationSchema>;

/** A work item field diff carries `oldValue` / `newValue`; both may be absent. */
const fieldDiff = z
	.object({
		oldValue: z.unknown().optional(),
		newValue: z.unknown().optional(),
	})
	.passthrough();

export const rawWorkItemSchema = z
	.object({
		id: z.number().int().positive(),
		fields: z.record(z.string(), z.unknown()),
	})
	.passthrough();

export type RawWorkItem = z.infer<typeof rawWorkItemSchema>;

export const rawWiUpdateSchema = z
	.object({
		id: z.number().int().nonnegative().optional(),
		rev: z.number().int().positive(),
		revisedDate: adoInstant.nullish(),
		revisedBy: rawIdentitySchema.optional(),
		fields: z.record(z.string(), fieldDiff).optional(),
	})
	.passthrough();

export type RawWiUpdate = z.infer<typeof rawWiUpdateSchema>;

/** ADO list endpoints wrap results as `{ count, value: [...] }`. */
export function adoListSchema<T extends z.ZodTypeAny>(item: T) {
	return z
		.object({
			count: z.number().int().nonnegative().optional(),
			value: z.array(item),
		})
		.passthrough();
}

/** Envelope every raw file is written in (07 §4). */
export const rawEnvelopeSchema = z
	.object({
		schemaVersion: z.literal(1),
		fetchedAt: z.number().int().positive(),
		payload: z.unknown(),
	})
	.strict();

export type RawEnvelope = z.infer<typeof rawEnvelopeSchema>;
export const RAW_SCHEMA_VERSION = 1;

/**
 * Read a `properties` entry as a number.
 *
 * ADO reports these as `{"$type":"System.String","$value":"10"}` — the vote
 * result is a STRING even though it is numeric. Comparing it directly against
 * a number silently misclassifies: `"0" !== 0` is true, so a withdrawn vote
 * would be counted as a cast one (07 §6.2.1).
 */
export function propNumber(
	props: Record<string, { $value?: string | number }> | null | undefined,
	key: string,
): number | null {
	const raw = props?.[key]?.$value;
	if (raw === undefined || raw === null || raw === "") {
		return null;
	}
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isFinite(n) ? n : null;
}

/** Read a `properties` entry as a string (e.g. CodeReviewThreadType). */
export function propString(
	props: Record<string, { $value?: string | number }> | null | undefined,
	key: string,
): string | null {
	const raw = props?.[key]?.$value;
	return raw === undefined || raw === null ? null : String(raw);
}
