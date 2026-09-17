import { z } from "zod";
import { AdoError } from "../ado/client.ts";

export function parseRaw<T>(
	schema: { parse: (v: unknown) => T },
	raw: unknown,
	what: string,
): T {
	try {
		return schema.parse(raw);
	} catch (e) {
		const detail =
			e instanceof z.ZodError
				? e.issues
						.slice(0, 3)
						.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
						.join("; ")
				: e instanceof Error
					? e.message
					: "unknown";
		throw new AdoError("bad_response", `${what} failed schema — ${detail}`);
	}
}

export const adoRepositoriesSchema = z
	.object({
		value: z.array(
			z
				.object({
					id: z.string(),
					name: z.string(),
					project: z
						.object({
							id: z.string(),
							name: z.string(),
						})
						.loose(),
				})
				.loose(),
		),
	})
	.loose();
export type AdoRepositories = z.infer<typeof adoRepositoriesSchema>;

export const adoIdentitySchema = z
	.object({
		id: z.string(),
		displayName: z.string().default("Unknown"),
		uniqueName: z.string().optional(),
	})
	.loose();

export const adoReviewerSchema = z
	.object({
		id: z.string(),
		displayName: z.string().default("Unknown"),
		uniqueName: z.string().optional(),
		vote: z.number().default(0),
		isRequired: z.boolean().optional(),
		isContainer: z.boolean().optional(),
		hasDeclined: z.boolean().optional(),
		votedFor: z.array(z.unknown()).optional(),
	})
	.loose();
export type AdoReviewer = z.infer<typeof adoReviewerSchema>;

export const adoPullRequestSummarySchema = z
	.object({
		pullRequestId: z.number(),
		codeReviewId: z.number().optional(),
		status: z.string(),
		title: z.string().default(""),
		description: z.string().nullable().optional(),
		sourceRefName: z.string().default(""),
		targetRefName: z.string().default(""),
		mergeStatus: z.string().optional(),
		isDraft: z.boolean().optional(),
		creationDate: z.string().optional(),
		closedDate: z.string().nullable().optional(),
		createdBy: adoIdentitySchema.optional(),
		repository: z
			.object({
				id: z.string(),
				name: z.string(),
				project: z
					.object({
						id: z.string(),
						name: z.string(),
					})
					.loose()
					.optional(),
			})
			.loose(),
		lastMergeCommit: z
			.object({
				commitId: z.string(),
			})
			.loose()
			.nullable()
			.optional(),
		lastMergeSourceCommit: z
			.object({
				commitId: z.string(),
			})
			.loose()
			.nullable()
			.optional(),
		lastMergeTargetCommit: z
			.object({
				commitId: z.string(),
			})
			.loose()
			.nullable()
			.optional(),
		reviewers: z.array(adoReviewerSchema).optional(),
		labels: z
			.array(z.object({ id: z.string().optional(), name: z.string() }).loose())
			.optional(),
	})
	.loose();
export type AdoPullRequestSummary = z.infer<typeof adoPullRequestSummarySchema>;

export const adoPullRequestsSchema = z
	.object({
		value: z.array(adoPullRequestSummarySchema),
	})
	.loose();

export const adoPullRequestDetailSchema = adoPullRequestSummarySchema;

export const adoEvaluationSchema = z
	.object({
		evaluationId: z.string().optional(),
		status: z.string().optional(),
		startedDate: z.string().optional(),
		completedDate: z.string().nullable().optional(),
		configuration: z
			.object({
				id: z.number(),
				type: z
					.object({
						id: z.string().optional(),
						displayName: z.string().optional(),
					})
					.loose()
					.optional(),
				isBlocking: z.boolean().optional(),
				isEnabled: z.boolean().optional(),
				settings: z.record(z.string(), z.unknown()).optional(),
			})
			.loose(),
		context: z.record(z.string(), z.unknown()).nullable().optional(),
	})
	.loose();
export type AdoEvaluation = z.infer<typeof adoEvaluationSchema>;

export const adoEvaluationsSchema = z
	.object({
		value: z.array(adoEvaluationSchema),
	})
	.loose();

export const adoPolicyConfigurationsSchema = z
	.object({
		value: z.array(adoEvaluationSchema.shape.configuration),
	})
	.loose();

export const adoStatusSchema = z
	.object({
		id: z.number().optional(),
		state: z.string().optional(),
		description: z.string().nullable().optional(),
		iterationId: z.number().optional(),
		context: z
			.object({
				name: z.string().optional(),
				genre: z.string().optional(),
			})
			.loose()
			.optional(),
		targetUrl: z.string().nullable().optional(),
		creationDate: z.string().optional(),
		updatedDate: z.string().optional(),
		createdBy: adoIdentitySchema.optional(),
	})
	.loose();
export type AdoStatus = z.infer<typeof adoStatusSchema>;

export const adoStatusesSchema = z
	.object({
		value: z.array(adoStatusSchema),
	})
	.loose();

export const adoBuildSchema = z
	.object({
		id: z.number(),
		buildNumber: z.string().optional(),
		repository: z.object({ id: z.string() }).loose().optional(),
		status: z.string().optional(),
		result: z.string().nullable().optional(),
		definition: z
			.object({
				id: z.number(),
				name: z.string().optional(),
			})
			.loose()
			.optional(),
		sourceBranch: z.string().optional(),
		sourceVersion: z.string().optional(),
		startTime: z.string().nullable().optional(),
		finishTime: z.string().nullable().optional(),
		queueTime: z.string().nullable().optional(),
		_links: z
			.record(z.string(), z.object({ href: z.string() }).loose())
			.optional(),
	})
	.loose();
export type AdoBuild = z.infer<typeof adoBuildSchema>;

export const adoBuildsSchema = z
	.object({
		value: z.array(adoBuildSchema),
	})
	.loose();

export const adoTimelineRecordSchema = z
	.object({
		id: z.string(),
		identifier: z.string().optional(),
		parentId: z.string().nullable().optional(),
		type: z.string().optional(),
		name: z.string().default("Unknown"),
		state: z.string().optional(),
		result: z.string().nullable().optional(),
		order: z.number().optional(),
		startTime: z.string().nullable().optional(),
		finishTime: z.string().nullable().optional(),
		attempt: z.number().optional(),
		errorCount: z.number().optional(),
		warningCount: z.number().optional(),
	})
	.loose();
export type AdoTimelineRecord = z.infer<typeof adoTimelineRecordSchema>;

export const adoBuildTimelineSchema = z
	.object({
		records: z.array(adoTimelineRecordSchema).optional().default([]),
	})
	.loose();

export const adoThreadsSchema = z
	.object({
		value: z.array(
			z
				.object({
					id: z.number().optional(),
					status: z.string().optional(),
					comments: z
						.array(
							z
								.object({
									id: z.number().optional(),
									commentType: z.string().optional(),
									isDeleted: z.boolean().optional(),
									author: adoIdentitySchema.optional(),
									content: z.string().optional(),
									publishedDate: z.string().optional(),
								})
								.loose(),
						)
						.optional(),
				})
				.loose(),
		),
	})
	.loose();

export const adoIterationsSchema = z
	.object({
		value: z.array(
			z
				.object({
					id: z.number(),
					description: z.string().nullable().optional(),
					createdDate: z.string().optional(),
					updatedDate: z.string().optional(),
					author: adoIdentitySchema.optional(),
					changeTrackingId: z.number().optional(),
				})
				.loose(),
		),
	})
	.loose();

export const adoIterationChangesSchema = z
	.object({
		changeCounts: z.record(z.string(), z.number()).optional(),
	})
	.loose();
