import { z } from "zod";

export const networkKindSchema = z.enum([
	"adoDiscovery",
	"adoDetails",
	"adoChecks",
	"jev",
]);
export type NetworkKind = z.infer<typeof networkKindSchema>;
export const networkEventSchema = z
	.object({
		id: z.uuid(),
		kind: networkKindSchema,
		at: z.number().int().nonnegative(),
	})
	.strict();
export type NetworkEvent = z.infer<typeof networkEventSchema>;
export const networkActivitySchema = z.object({
	asOf: z.number(),
	buckets: z.array(
		z.object({
			at: z.number(),
			adoDiscovery: z.number(),
			adoDetails: z.number(),
			adoChecks: z.number(),
			jev: z.number(),
		}),
	),
});
export type NetworkActivity = z.infer<typeof networkActivitySchema>;
