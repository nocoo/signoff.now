import { z } from "zod";

export const collectionColorSchema = z.enum([
	"violet",
	"blue",
	"teal",
	"amber",
	"rose",
	"slate",
]);
export const collectionIconSchema = z.enum([
	"layers",
	"flask",
	"target",
	"flag",
	"rocket",
	"book",
]);
export const prCollectionWriteSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(1000),
		color: collectionColorSchema,
		icon: collectionIconSchema,
	})
	.strict();
export const prCollectionSchema = prCollectionWriteSchema.extend({
	id: z.string(),
	source: z.enum(["live", "sample"]),
	revision: z.number().int().positive(),
	createdAt: z.number(),
	updatedAt: z.number(),
	counts: z.object({
		total: z.number(),
		open: z.number(),
		draft: z.number(),
		merged: z.number(),
		closed: z.number(),
	}),
});
export const prCollectionsSchema = z.object({
	items: z.array(prCollectionSchema),
});
export const collectionMembershipsSchema = z.object({
	items: z.array(z.object({ pullId: z.string(), collectionId: z.string() })),
});
export const collectionMemberWriteSchema = z
	.object({
		revision: z.number().int().positive(),
		action: z.enum(["add", "remove"]),
		pullIds: z
			.array(z.string().min(1).max(512))
			.min(1)
			.max(200)
			.transform((ids) => [...new Set(ids)]),
	})
	.strict();
export type PrCollection = z.infer<typeof prCollectionSchema>;
export type PrCollectionWrite = z.infer<typeof prCollectionWriteSchema>;
